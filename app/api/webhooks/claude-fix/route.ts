import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import type { PlatformErrorReportStatus } from "@/types/database";

export const runtime = "nodejs";

/**
 * Called by .github/workflows/claude-fix.yml (a deterministic step reading
 * Claude's structured_output, not Claude itself) once a run finishes —
 * whether it opened a PR or judged the report unsafe to auto-fix.
 * Auth: shared secret header, not a user session (no browser involved).
 */

const OUTCOME_TO_STATUS: Record<string, PlatformErrorReportStatus> = {
  pr_opened: "resolved",
  needs_attention: "needs_attention",
};

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function POST(request: Request) {
  const expected = process.env.CLAUDE_FIX_WEBHOOK_SECRET?.trim();
  if (!expected) {
    return NextResponse.json(
      { error: "webhook_not_configured" },
      { status: 503 },
    );
  }

  const provided = request.headers.get("x-webhook-secret")?.trim() ?? "";
  if (!provided || !timingSafeEqual(provided, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Coarse abuse guard — this is a fixed secret, but rotate-and-forget
  // beats an unbounded loop against the DB if the secret ever leaks.
  const limited = await consumeRateLimit("claude-fix-webhook", {
    limit: 60,
    windowMs: 60 * 60 * 1000,
  });
  if (!limited.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: {
    reportId?: unknown;
    outcome?: unknown;
    summary?: unknown;
    prUrl?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const reportId = typeof body.reportId === "string" ? body.reportId.trim() : "";
  const outcomeRaw = typeof body.outcome === "string" ? body.outcome.trim() : "";
  const summary =
    typeof body.summary === "string" ? body.summary.trim().slice(0, 2000) : "";
  const prUrl = typeof body.prUrl === "string" ? body.prUrl.trim().slice(0, 500) : "";

  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(reportId)) {
    return NextResponse.json({ error: "invalid_report_id" }, { status: 400 });
  }
  const status = OUTCOME_TO_STATUS[outcomeRaw];
  if (!status) {
    return NextResponse.json({ error: "invalid_outcome" }, { status: 400 });
  }
  if (!summary) {
    return NextResponse.json({ error: "missing_summary" }, { status: 400 });
  }

  const catalog = createServiceRoleClient();
  const { error } = await catalog
    .from("platform_error_reports")
    .update({
      status,
      autofix_summary: summary,
      ...(prUrl ? { autofix_pr_url: prUrl } : {}),
    })
    .eq("id", reportId);

  if (error) {
    console.error("[webhooks/claude-fix]", error);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  revalidatePath("/admin/system/error-reports");
  return NextResponse.json({ ok: true });
}
