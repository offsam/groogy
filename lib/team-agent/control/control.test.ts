/**
 * Project control center. No paid API calls.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { detectPathConflicts } from "../conflicts";
import { acceptGithubWebhook } from "./github-webhook";
import { applyGithubDelivery, emptyGitEventState } from "./events";
import { observeProject } from "./live";
import { parseLocalReport } from "./local-report";
import { compareMigrationNames } from "./migrations";
import { reconcileProject } from "./reconcile";
import { deliverySentence, formatProjectAnswer } from "./report";
import { verifyGithubSignature } from "./signature";
import { verifyReporterToken } from "./reporter-auth";
import type { ObservedInputs, ProjectIssue, ProjectSnapshot } from "./types";

const NOW = "2026-09-25T18:00:00.000Z";
const OLD = "2026-09-24T18:00:00.000Z";
const MAIN = "aaa111aaa111aaa111aaa111aaa111aaa111aaa1";
const PROFILE = "bbb222bbb222bbb222bbb222bbb222bbb222bbb2";
const OLD_PROD = "ccc333ccc333ccc333ccc333ccc333ccc333ccc3";

function base(overrides: Partial<ObservedInputs> = {}): ObservedInputs {
  return {
    now: NOW,
    staleAfterMs: 60 * 60 * 1000,
    github: {
      status: "connected",
      checkedAt: NOW,
      error: null,
      value: {
        repo: "offsam/groogy",
        defaultBranch: "main",
        mainSha: MAIN,
        branches: [
          { name: "main", sha: MAIN, ahead: 0, behind: 0, updatedAt: NOW, author: null },
          { name: "feature/user-profile", sha: PROFILE, ahead: 2, behind: 0, updatedAt: NOW, author: "nikitos" },
        ],
        pulls: [],
      },
    },
    vercel: {
      status: "connected",
      checkedAt: NOW,
      error: null,
      value: {
        production: {
          id: "dpl_prod",
          environment: "production",
          status: "READY",
          url: "https://www.kroogy.com",
          branch: "main",
          sha: OLD_PROD,
          createdAt: OLD,
          readyAt: OLD,
          error: null,
        },
        previews: [],
      },
    },
    supabase: {
      status: "not_configured",
      checkedAt: null,
      localFiles: [],
      applied: [],
      pending: [],
      unknownRemote: [],
      repairFiles: [],
      error: null,
    },
    localReports: [],
    openrouter: { status: "connected", checkedAt: NOW, error: null, value: { model: "deepseek/deepseek-v4-flash" } },
    telegram: { status: "connected", checkedAt: NOW, error: null, value: { webhookUrl: "https://preview.example/hook" } },
    tasks: [],
    members: [
      { id: "sam", displayName: "Сэм" },
      { id: "nikitos", displayName: "Никитос" },
      { id: "zheka", displayName: "Жека" },
    ],
    ...overrides,
  };
}

function partnerSnapshot(productionSha = OLD_PROD): ProjectSnapshot {
  const input = base();
  input.vercel.value.production = {
    ...input.vercel.value.production!,
    sha: productionSha,
    status: "READY",
  };
  input.github.value.pulls = [
    {
      number: 18,
      title: "Личный кабинет",
      author: "nikitos",
      headRef: "feature/user-profile",
      headSha: PROFILE,
      baseRef: "main",
      draft: false,
      mergeable: true,
      merged: true,
      mergedAt: NOW,
      files: ["app/profile/page.tsx", "package.json"],
      checks: "success",
      url: "https://github.com/offsam/groogy/pull/18",
      updatedAt: NOW,
    },
  ];
  input.vercel.value.previews = [
    {
      id: "dpl_preview",
      environment: "preview",
      status: "READY",
      url: "https://groogy-preview.vercel.app",
      branch: "feature/user-profile",
      sha: PROFILE,
      createdAt: NOW,
      readyAt: NOW,
      error: null,
    },
  ];
  input.tasks = [
    {
      id: "task-agent",
      title: "Team Agent",
      status: "in_progress",
      branchName: "team-agent/telegram-webhook-v1",
      assignedMemberId: "sam",
      scopePaths: ["lib/team-agent"],
    },
    {
      id: "task-profile",
      title: "Личный кабинет",
      status: "review",
      branchName: "feature/user-profile",
      assignedMemberId: "nikitos",
      scopePaths: ["app/profile"],
    },
    {
      id: "task-search",
      title: "Поиск",
      status: "in_progress",
      branchName: "feature/search",
      assignedMemberId: "zheka",
      scopePaths: ["app/search"],
    },
  ];
  input.localReports = [
    {
      taskId: "task-agent",
      memberId: "sam",
      branch: "team-agent/telegram-webhook-v1",
      baseSha: MAIN,
      headSha: "ddd444",
      dirty: true,
      changedPaths: ["lib/team-agent/control/report.ts"],
      reportedAt: NOW,
    },
    {
      taskId: "task-search",
      memberId: "zheka",
      branch: "feature/search",
      baseSha: MAIN,
      headSha: null,
      dirty: true,
      changedPaths: ["package.json"],
      reportedAt: NOW,
    },
  ];
  input.github.value.branches.push({
    name: "feature/search",
    sha: "eee555",
    ahead: 1,
    behind: 0,
    updatedAt: NOW,
    author: "zheka",
  });
  return reconcileProject(input);
}

async function main(): Promise<void> {
  const state = emptyGitEventState();
  const seen = new Set<string>();
  const first = applyGithubDelivery(state, pushDelivery("delivery-1", "feature/user-profile", PROFILE), seen);
  assert.equal(first.duplicate, false);
  assert.equal(first.state.branches[0]?.sha, PROFILE);
  const second = applyGithubDelivery(first.state, pushDelivery("delivery-1", "feature/user-profile", "fff666"), seen);
  assert.equal(second.duplicate, true);
  assert.equal(second.state.branches[0]?.sha, PROFILE);

  const merged = partnerSnapshot();
  const profile = merged.tasks.find((task) => task.title === "Личный кабинет");
  assert.ok(profile);
  assert.equal(profile.delivery, "merged");
  assert.equal(profile.productionMatches, false);
  assert.equal(profile.sha, PROFILE);
  assert.match(deliverySentence(profile), /объединён с main, но ещё не опубликован в production/);
  const paths = detectPathConflicts(profile.paths, ["package.json"]);
  assert.notEqual(paths.severity, "none");
  assert.match(formatProjectAnswer("issues", merged), /package\.json/);

  const published = partnerSnapshot(PROFILE);
  const live = published.tasks.find((task) => task.title === "Личный кабинет");
  assert.equal(live?.delivery, "production_deployed");
  assert.match(deliverySentence(live!), /опубликован в production/);

  const pushed = reconcileProject(base({
    tasks: [{
      id: "t1",
      title: "Ветка",
      status: "in_progress",
      branchName: "feature/user-profile",
      assignedMemberId: "nikitos",
      scopePaths: [],
    }],
  }));
  assert.equal(pushed.tasks[0]?.delivery, "pushed");
  assert.match(deliverySentence(pushed.tasks[0]!), /не означает/);
  assert.notEqual(pushed.productionSha, PROFILE);

  const failedPreview = reconcileProject(base({
    vercel: {
      status: "connected",
      checkedAt: NOW,
      error: null,
      value: {
        production: null,
        previews: [{
          id: "dpl_bad",
          environment: "preview",
          status: "ERROR",
          url: null,
          branch: "feature/user-profile",
          sha: PROFILE,
          createdAt: NOW,
          readyAt: null,
          error: "build failed",
        }],
      },
    },
    tasks: [{
      id: "t1",
      title: "Личный кабинет",
      status: "in_progress",
      branchName: "feature/user-profile",
      assignedMemberId: "nikitos",
      scopePaths: [],
    }],
  }));
  assert.notEqual(failedPreview.tasks[0]?.delivery, "production_deployed");
  assert.match(formatProjectAnswer("preview", failedPreview), /не прошла|ERROR|ошибк/i);

  const dirty = reconcileProject(base({
    github: { ...base().github, status: "not_configured", value: { ...base().github.value, branches: [], pulls: [] } },
    localReports: [{
      taskId: "t1",
      memberId: "sam",
      branch: "feature/local",
      baseSha: MAIN,
      headSha: null,
      dirty: true,
      changedPaths: ["lib/team-agent/control/live.ts"],
      reportedAt: NOW,
    }],
    tasks: [{ id: "t1", title: "Team Agent", status: "in_progress", branchName: "feature/local", assignedMemberId: "sam", scopePaths: [] }],
  }));
  assert.equal(dirty.tasks[0]?.local, "dirty");
  assert.match(formatProjectAnswer("unpushed", dirty), /незакоммиченные/);

  const unknown = reconcileProject(base({
    tasks: [{ id: "t1", title: "Поиск", status: "approved", branchName: null, assignedMemberId: "zheka", scopePaths: [] }],
  }));
  assert.equal(unknown.tasks[0]?.local, "unknown");
  assert.match(formatProjectAnswer("people", unknown), /неизвестно/);
  assert.doesNotMatch(formatProjectAnswer("people", unknown), /чистое/);

  const stale = reconcileProject(base({
    localReports: [{
      taskId: "t1",
      memberId: "sam",
      branch: "feature/user-profile",
      baseSha: null,
      headSha: PROFILE,
      dirty: false,
      changedPaths: [],
      reportedAt: OLD,
    }],
    tasks: [{ id: "t1", title: "Team Agent", status: "in_progress", branchName: "feature/user-profile", assignedMemberId: "sam", scopePaths: [] }],
  }));
  assert.equal(stale.tasks[0]?.local, "stale");
  assert.match(formatProjectAnswer("people", stale), /устарел/);

  const migrations = compareMigrationNames(
    ["20260917160000_team_agent_foundation_v1.sql", "20260999000000_repair_notes.sql"],
    ["20260917160000", "20260101000000"],
  );
  assert.deepEqual(migrations.pending, ["20260999000000"]);
  assert.deepEqual(migrations.unknownRemote, ["20260101000000"]);
  assert.equal(migrations.repairFiles.length, 1);
  const drift = reconcileProject(base({
    supabase: {
      status: "connected",
      checkedAt: NOW,
      localFiles: ["20260917160000_team_agent_foundation_v1.sql"],
      applied: ["20260101000000"],
      pending: migrations.pending,
      unknownRemote: ["20260101000000"],
      repairFiles: migrations.repairFiles,
      error: null,
    },
  }));
  assert.ok(drift.issues.some((issue) => issue.key.startsWith("migration-unknown:")));
  assert.match(formatProjectAnswer("migrations", drift), /репозитории нет/);

  const secret = "webhook-test-secret";
  const body = JSON.stringify({ ref: "refs/heads/feature/user-profile", after: PROFILE, repository: { full_name: "offsam/groogy" } });
  const signature = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(verifyGithubSignature(body, signature, secret), true);
  assert.equal(verifyGithubSignature(body, "sha256=00", secret), false);
  const accepted = acceptGithubWebhook({
    rawBody: body,
    signature,
    secret,
    event: "push",
    deliveryId: "d-1",
    allowRepo: "offsam/groogy",
    seen: new Set(),
    state: emptyGitEventState(),
  });
  assert.equal(accepted.ok, true);
  if (accepted.ok) assert.equal(accepted.state.branches[0]?.sha, PROFILE);
  const forged = acceptGithubWebhook({
    rawBody: body,
    signature: "sha256=dead",
    secret,
    event: "push",
    deliveryId: "d-2",
    allowRepo: "offsam/groogy",
    seen: new Set(),
    state: emptyGitEventState(),
  });
  assert.equal(forged.ok, false);

  const failedCi = applyGithubDelivery(emptyGitEventState(), {
    deliveryId: "check-1",
    event: "check_run",
    repo: "offsam/groogy",
    payload: { check_run: { name: "test", conclusion: "failure", head_sha: PROFILE, html_url: "https://github.com/offsam/groogy/runs/1" } },
  }, new Set());
  const withPr = {
    ...failedCi.state,
    pulls: [{
      number: 18,
      title: "Личный кабинет",
      author: null,
      headRef: "feature/user-profile",
      headSha: PROFILE,
      baseRef: "main",
      draft: false,
      mergeable: true,
      merged: false,
      mergedAt: null,
      files: ["app/profile/page.tsx"],
      checks: "failure" as const,
      url: "https://github.com/offsam/groogy/pull/18",
      updatedAt: NOW,
    }],
  };
  const ciInput = base();
  ciInput.github.value.pulls = withPr.pulls;
  const ci = reconcileProject(ciInput);
  assert.ok(ci.issues.some((issue) => issue.key === "ci-failed:18"));

  const missing = reconcileProject(base({
    github: { ...base().github, status: "not_configured", error: null, checkedAt: null, value: { repo: null, defaultBranch: null, mainSha: null, branches: [], pulls: [] } },
    tasks: [{ id: "t1", title: "Поиск", status: "in_progress", branchName: "feature/search", assignedMemberId: "zheka", scopePaths: [] }],
  }));
  assert.equal(missing.issues.some((issue) => issue.key.startsWith("branch-missing")), false);
  assert.match(formatProjectAnswer("branches", missing), /не подключено|не выдумываю/);

  const calls: string[] = [];
  const quiet = await observeProject(
    { OPENROUTER_API_KEY: "sk-test-should-not-leak", GITHUB_TEAM_AGENT_TOKEN: "", VERCEL_TEAM_AGENT_TOKEN: "" } as unknown as NodeJS.ProcessEnv,
    {
      now: NOW,
      cwd: "/tmp/does-not-matter-team-agent",
      fetchImpl: async (url) => {
        calls.push(url);
        return { ok: true, status: 200, json: async () => ({ data: { limit: 1 } }) };
      },
    },
  );
  assert.equal(calls.some((url) => url.includes("chat/completions")), false);
  assert.equal(JSON.stringify(quiet).includes("sk-test-should-not-leak"), false);
  assert.equal(quiet.connections.find((item) => item.provider === "github")?.status, "not_configured");

  const local = parseLocalReport({
    branch: "feature/search",
    dirty: true,
    changedPaths: ["app/search/page.tsx"],
    headSha: "abc1234",
    diff: "secret",
  }, "zheka", NOW);
  assert.equal(local.ok, false);
  const safe = parseLocalReport({
    branch: "feature/search",
    dirty: true,
    changedPaths: ["app/search/page.tsx"],
    headSha: "abc1234",
  }, "zheka", NOW);
  assert.equal(safe.ok, true);

  const previous: ProjectIssue[] = [{
    key: "ci-failed:18",
    severity: "blocking",
    source: "ci",
    component: "PR #18",
    evidence: "fail",
    detectedAt: OLD,
    lastSeenAt: OLD,
    status: "open",
    nextAction: "fix",
  }];
  const recovered = reconcileProject(base(), previous);
  assert.equal(recovered.issues.some((issue) => issue.key === "ci-failed:18"), false);

  assert.equal(verifyReporterToken("Bearer no", null), false);
  assert.match(formatProjectAnswer("full", merged), /Проверено/);
  assert.match(formatProjectAnswer("production", merged), new RegExp(OLD_PROD.slice(0, 8)));
  console.log("team-agent control: ok");
}

function pushDelivery(id: string, branch: string, sha: string) {
  return {
    deliveryId: id,
    event: "push",
    repo: "offsam/groogy",
    payload: { ref: `refs/heads/${branch}`, after: sha, repository: { full_name: "offsam/groogy" } },
  };
}

void main();
