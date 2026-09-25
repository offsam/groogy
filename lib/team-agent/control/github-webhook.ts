import type { GitEventState, GithubDelivery } from "./events";
import { applyGithubDelivery } from "./events";
import { verifyGithubSignature } from "./signature";

export type GithubWebhookInput = {
  rawBody: string;
  signature: string | null;
  secret: string | null;
  event: string | null;
  deliveryId: string | null;
  allowRepo: string | null;
  seen: Set<string>;
  state: GitEventState;
};

export type GithubWebhookResult =
  | { ok: false; status: 401 | 400 | 403; error: "bad_signature" | "invalid_json" | "repo_not_allowed" }
  | { ok: true; duplicate: boolean; state: GitEventState; summary: string };

/** Validates and applies one GitHub delivery. Does not call a model or write to GitHub. */
export function acceptGithubWebhook(input: GithubWebhookInput): GithubWebhookResult {
  if (!verifyGithubSignature(input.rawBody, input.signature, input.secret)) {
    return { ok: false, status: 401, error: "bad_signature" };
  }
  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(input.rawBody) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, status: 400, error: "invalid_json" };
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    return { ok: false, status: 400, error: "invalid_json" };
  }
  const repo = repoName(payload);
  if (!input.allowRepo || !repo || repo !== input.allowRepo) {
    return { ok: false, status: 403, error: "repo_not_allowed" };
  }
  const delivery: GithubDelivery = {
    deliveryId: input.deliveryId?.trim() || "",
    event: input.event?.trim() || "unknown",
    repo,
    payload,
  };
  if (!delivery.deliveryId) return { ok: false, status: 400, error: "invalid_json" };
  const applied = applyGithubDelivery(input.state, delivery, input.seen);
  return {
    ok: true,
    duplicate: applied.duplicate,
    state: applied.state,
    summary: `${delivery.event} ${repo}`,
  };
}

function repoName(payload: Record<string, unknown>): string | null {
  const repository = payload.repository;
  if (!repository || typeof repository !== "object") return null;
  const name = (repository as { full_name?: unknown }).full_name;
  return typeof name === "string" ? name : null;
}
