import { NextResponse } from "next/server";
import { parseLocalReport } from "@/lib/team-agent/control/local-report";
import { verifyReporterToken } from "@/lib/team-agent/control/reporter-auth";
import { getTeamAgentProductionStore } from "@/lib/team-agent/telegram/runtime-store";
import { tryCreateServiceRoleClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

/** Accepts a path-level local progress report. File contents are rejected. */
export async function POST(request: Request) {
  if (!verifyReporterToken(request.headers.get("authorization"), process.env.TEAM_AGENT_REPORTER_TOKEN)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const memberId = typeof (body as { memberId?: unknown })?.memberId === "string"
    ? (body as { memberId: string }).memberId
    : "";
  let known = false;
  try {
    const members = await getTeamAgentProductionStore().listActiveMembers();
    known = members.some((member) => member.id === memberId);
  } catch {
    return NextResponse.json({ error: "store_unavailable" }, { status: 503 });
  }
  if (!known) return NextResponse.json({ error: "unknown_member" }, { status: 403 });
  const parsed = parseLocalReport(body, memberId, new Date().toISOString());
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const saved = await saveReport(parsed.report);
  return NextResponse.json({
    ok: true,
    persisted: saved,
    local: parsed.report.dirty ? "dirty" : "clean",
  });
}

async function saveReport(report: {
  memberId: string;
  taskId: string | null;
  branch: string;
  baseSha: string | null;
  headSha: string | null;
  dirty: boolean;
  changedPaths: string[];
  reportedAt: string;
}): Promise<boolean> {
  const client = tryCreateServiceRoleClient();
  if (!client) return false;
  const loose = client as unknown as {
    from: (table: string) => {
      insert: (row: Record<string, unknown>) => Promise<{ error: { code?: string } | null }>;
    };
  };
  const { error } = await loose.from("team_agent_local_reports").insert({
    member_id: report.memberId,
    task_id: report.taskId,
    branch_name: report.branch,
    base_sha: report.baseSha,
    head_sha: report.headSha,
    dirty: report.dirty,
    changed_paths: report.changedPaths,
    reported_at: report.reportedAt,
  });
  return !error;
}
