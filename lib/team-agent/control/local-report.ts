import type { LocalWorkReport } from "./types";

const SAFE_PATH = /^[A-Za-z0-9_./-]{1,240}$/;

export function parseLocalReport(body: unknown, memberId: string, now: string): { ok: true; report: LocalWorkReport } | { ok: false; error: string } {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  if (!record) return { ok: false, error: "invalid_body" };
  if ("diff" in record || "content" in record || "patch" in record || "env" in record) {
    return { ok: false, error: "contents_not_accepted" };
  }
  const branch = typeof record.branch === "string" ? record.branch.trim() : "";
  if (!branch || branch.length > 200) return { ok: false, error: "branch_required" };
  const paths = Array.isArray(record.changedPaths) ? record.changedPaths : [];
  if (paths.length > 200) return { ok: false, error: "too_many_paths" };
  const changedPaths: string[] = [];
  for (const path of paths) {
    if (typeof path !== "string" || !SAFE_PATH.test(path) || path.includes("..") || path.includes(".env")) {
      return { ok: false, error: "unsafe_path" };
    }
    changedPaths.push(path);
  }
  const taskId = typeof record.taskId === "string" && record.taskId.trim() ? record.taskId.trim() : null;
  return {
    ok: true,
    report: {
      taskId,
      memberId,
      branch,
      baseSha: sha(record.baseSha),
      headSha: sha(record.headSha),
      dirty: record.dirty === true,
      changedPaths,
      reportedAt: now,
    },
  };
}

function sha(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return /^[0-9a-f]{7,64}$/i.test(text) ? text : null;
}
