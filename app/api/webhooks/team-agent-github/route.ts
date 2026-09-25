import { NextResponse } from "next/server";
import { acceptGithubWebhook } from "@/lib/team-agent/control/github-webhook";
import { emptyGitEventState } from "@/lib/team-agent/control/events";
import { tryCreateServiceRoleClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const seen = new Set<string>();

/**
 * GitHub events update the sync log only.
 * They do not call the model and they do not change GitHub settings.
 */
export async function POST(request: Request) {
  const secret = process.env.GITHUB_TEAM_AGENT_WEBHOOK_SECRET ?? null;
  if (!secret?.trim() || !process.env.GITHUB_TEAM_AGENT_REPO?.trim()) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const rawBody = await request.text();
  const result = acceptGithubWebhook({
    rawBody,
    signature: request.headers.get("x-hub-signature-256"),
    secret,
    event: request.headers.get("x-github-event"),
    deliveryId: request.headers.get("x-github-delivery"),
    allowRepo: process.env.GITHUB_TEAM_AGENT_REPO?.trim() ?? null,
    seen,
    state: emptyGitEventState(),
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  const sha = result.state.branches[0]?.sha ?? result.state.pulls[0]?.headSha ?? null;
  const persisted = await recordDelivery(result.summary, request.headers.get("x-github-delivery") ?? "", sha);
  return NextResponse.json({ ok: true, duplicate: result.duplicate || persisted.duplicate, persisted: persisted.saved });
}

async function recordDelivery(
  summary: string,
  deliveryId: string,
  sha: string | null,
): Promise<{ saved: boolean; duplicate: boolean }> {
  const client = tryCreateServiceRoleClient();
  if (!client || !deliveryId) return { saved: false, duplicate: false };
  const loose = client as unknown as {
    from: (table: string) => {
      insert: (row: Record<string, unknown>) => Promise<{ error: { code?: string } | null }>;
    };
  };
  const { error } = await loose.from("team_agent_sync_events").insert({
    provider: "github",
    delivery_id: deliveryId,
    event_name: summary.slice(0, 120),
    repository: process.env.GITHUB_TEAM_AGENT_REPO ?? null,
    commit_sha: sha,
    summary: summary.slice(0, 500),
  });
  if (!error) return { saved: true, duplicate: false };
  if (error.code === "23505") return { saved: true, duplicate: true };
  return { saved: false, duplicate: false };
}
