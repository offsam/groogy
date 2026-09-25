import { NextResponse } from "next/server";
import { verifyReporterToken } from "@/lib/team-agent/control/reporter-auth";
import { observeProject } from "@/lib/team-agent/control/live";
import { getTeamAgentProductionStore } from "@/lib/team-agent/telegram/runtime-store";

export const runtime = "nodejs";

/**
 * Manual or future scheduled reconciliation.
 * Reads integrations. Does not call a chat model and does not deploy.
 */
export async function POST(request: Request) {
  if (!verifyReporterToken(request.headers.get("authorization"), process.env.TEAM_AGENT_RECONCILE_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const store = getTeamAgentProductionStore();
    const [tasks, members] = await Promise.all([store.listTasks(), store.listActiveMembers()]);
    const snapshot = await observeProject(process.env, {
      tasks: tasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        branchName: task.branch_name,
        assignedMemberId: task.assigned_member_id,
        scopePaths: task.scope_paths,
      })),
      members: members.map((member) => ({ id: member.id, displayName: member.display_name })),
    });
    return NextResponse.json({
      ok: true,
      takenAt: snapshot.takenAt,
      connections: snapshot.connections.map((item) => ({
        provider: item.provider,
        status: item.status,
        lastSuccessfulSync: item.lastSuccessfulSync,
        lastError: item.lastError,
      })),
      openIssues: snapshot.issues.length,
    });
  } catch {
    return NextResponse.json({ error: "reconcile_failed" }, { status: 500 });
  }
}
