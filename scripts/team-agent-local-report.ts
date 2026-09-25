/**
 * Sends branch and path names from this machine. Does not send file contents or secrets.
 */
import { execFileSync } from "node:child_process";

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", cwd: process.cwd() }).trim();
}

function pathsFromStatus(status: string): string[] {
  return status
    .split("\n")
    .map((line) => line.slice(3).split(" -> ").pop()?.trim() ?? "")
    .filter((path) => path && !path.includes(".env") && !path.includes(".."));
}

async function main(): Promise<void> {
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const head = git(["rev-parse", "HEAD"]);
  let base = "";
  try {
    base = git(["merge-base", "HEAD", "origin/main"]);
  } catch {
    base = "";
  }
  const status = git(["status", "--porcelain"]);
  const changedPaths = status ? pathsFromStatus(status) : [];
  const dirty = changedPaths.length > 0;
  const report = { branch, headSha: head, baseSha: base || null, dirty, changedPaths };
  console.log(JSON.stringify({ local: dirty ? "dirty" : "clean", branch, headSha: head, files: changedPaths.length }, null, 2));

  const url = process.env.TEAM_AGENT_REPORTER_URL?.trim();
  const token = process.env.TEAM_AGENT_REPORTER_TOKEN?.trim();
  const memberId = process.env.TEAM_AGENT_REPORTER_MEMBER_ID?.trim();
  if (!url || !token || !memberId) {
    console.log("Отчёт только напечатан. Для отправки нужны TEAM_AGENT_REPORTER_URL, TEAM_AGENT_REPORTER_TOKEN и TEAM_AGENT_REPORTER_MEMBER_ID.");
    return;
  }
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ ...report, memberId, taskId: process.env.TEAM_AGENT_TASK_ID?.trim() || null }),
  });
  const body = await response.json().catch(() => ({}));
  console.log(JSON.stringify({ http: response.status, persisted: Boolean((body as { persisted?: boolean }).persisted) }));
}

void main();
