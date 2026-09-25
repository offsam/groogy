/**
 * Applies one GitHub webhook onto normalized git state.
 * Duplicate deliveries are ignored. This never calls a model.
 */

import type { CheckState, GithubBranchState, PullRequestState } from "./types";

export type GitEventState = {
  branches: GithubBranchState[];
  pulls: PullRequestState[];
  checks: Array<{ sha: string; name: string; conclusion: CheckState; url: string | null }>;
};

export type GithubDelivery = {
  deliveryId: string;
  event: string;
  repo: string;
  payload: Record<string, unknown>;
};

export function emptyGitEventState(): GitEventState {
  return { branches: [], pulls: [], checks: [] };
}

export function applyGithubDelivery(
  state: GitEventState,
  delivery: GithubDelivery,
  seen: Set<string>,
): { state: GitEventState; duplicate: boolean } {
  if (!delivery.deliveryId || seen.has(delivery.deliveryId)) {
    return { state, duplicate: true };
  }
  seen.add(delivery.deliveryId);
  const next = clone(state);
  const payload = delivery.payload;
  if (delivery.event === "push") {
    const ref = text(payload.ref);
    const sha = text(payload.after);
    const name = ref?.replace(/^refs\/heads\//, "") ?? null;
    if (name && sha && sha !== "0000000000000000000000000000000000000000") {
      const current = next.branches.find((branch) => branch.name === name);
      if (current) current.sha = sha;
      else {
        next.branches.push({
          name,
          sha,
          ahead: null,
          behind: null,
          updatedAt: null,
          author: null,
        });
      }
    }
    if (name && sha === "0000000000000000000000000000000000000000") {
      next.branches = next.branches.filter((branch) => branch.name !== name);
    }
  }
  if (delivery.event === "pull_request") {
    const pr = asRecord(payload.pull_request);
    const number = typeof pr.number === "number" ? pr.number : null;
    const head = asRecord(pr.head);
    if (number && text(head.ref) && text(head.sha)) {
      const row = pullFrom(pr);
      const index = next.pulls.findIndex((item) => item.number === number);
      if (index >= 0) next.pulls[index] = { ...next.pulls[index], ...row };
      else next.pulls.push(row);
    }
  }
  if (delivery.event === "check_run" || delivery.event === "check_suite" || delivery.event === "workflow_run") {
    const check = asRecord(payload.check_run ?? payload.workflow_run ?? payload.check_suite);
    const sha = text(check.head_sha) ?? text(asRecord(check.head_commit).id);
    const name = text(check.name) ?? text(asRecord(check.workflow).name) ?? delivery.event;
    const conclusion = mapConclusion(text(check.conclusion) ?? text(check.status));
    if (sha) {
      next.checks.push({
        sha,
        name,
        conclusion,
        url: text(check.html_url),
      });
      for (const pull of next.pulls) {
        if (pull.headSha === sha && conclusion !== "unknown") pull.checks = conclusion;
      }
    }
  }
  return { state: next, duplicate: false };
}

function pullFrom(pr: Record<string, unknown>): PullRequestState {
  const head = asRecord(pr.head);
  const base = asRecord(pr.base);
  const user = asRecord(pr.user);
  return {
    number: typeof pr.number === "number" ? pr.number : 0,
    title: text(pr.title) ?? "",
    author: text(user.login),
    headRef: text(head.ref) ?? "",
    headSha: text(head.sha) ?? "",
    baseRef: text(base.ref) ?? "",
    draft: pr.draft === true,
    mergeable: typeof pr.mergeable === "boolean" ? pr.mergeable : null,
    merged: pr.merged === true || text(pr.state) === "closed" && Boolean(pr.merged_at),
    mergedAt: text(pr.merged_at),
    files: [],
    checks: "unknown",
    url: text(pr.html_url) ?? "",
    updatedAt: text(pr.updated_at),
  };
}

function mapConclusion(value: string | null): CheckState {
  if (value === "success" || value === "completed") return "success";
  if (value === "failure" || value === "cancelled" || value === "timed_out") return "failure";
  if (value === "pending" || value === "queued" || value === "in_progress") return "pending";
  return "unknown";
}

function clone(state: GitEventState): GitEventState {
  return {
    branches: state.branches.map((row) => ({ ...row })),
    pulls: state.pulls.map((row) => ({ ...row, files: [...row.files] })),
    checks: state.checks.map((row) => ({ ...row })),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
