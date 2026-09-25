/**
 * Read-only observation. Missing credentials stay not_configured.
 * This module does not call OpenRouter chat completions.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { compareMigrationNames } from "./migrations";
import { reconcileProject } from "./reconcile";
import type {
  CheckState,
  ConnectionStatus,
  DeploymentState,
  DeploymentStatus,
  GithubBranchState,
  LocalWorkReport,
  ObservedInputs,
  ProjectSnapshot,
  PullRequestState,
  SourceState,
} from "./types";

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text?: () => Promise<string> }>;

const STALE_MS = 6 * 60 * 60 * 1000;
let cache: { at: number; snapshot: ProjectSnapshot } | null = null;

export function cachedProjectSnapshot(maxAgeMs = 10 * 60 * 1000): ProjectSnapshot | null {
  if (!cache) return null;
  if (Date.now() - cache.at > maxAgeMs) return null;
  return cache.snapshot;
}

export function rememberProjectSnapshot(snapshot: ProjectSnapshot): void {
  cache = { at: Date.now(), snapshot };
}

export async function observeProject(
  env: NodeJS.ProcessEnv,
  options?: {
    fetchImpl?: FetchLike;
    now?: string;
    cwd?: string;
    reports?: LocalWorkReport[];
    tasks?: ObservedInputs["tasks"];
    members?: ObservedInputs["members"];
  },
): Promise<ProjectSnapshot> {
  const fetchImpl = options?.fetchImpl ?? defaultFetch;
  const now = options?.now ?? new Date().toISOString();
  const github = await readGithub(env, fetchImpl);
  const vercel = await readVercel(env, fetchImpl);
  const supabase = await readSupabase(env, fetchImpl, options?.cwd ?? process.cwd());
  const openrouter = await readOpenRouter(env, fetchImpl);
  const telegram = await readTelegram(env, fetchImpl);
  const input: ObservedInputs = {
    now,
    staleAfterMs: STALE_MS,
    github,
    vercel,
    supabase,
    localReports: options?.reports ?? [],
    openrouter,
    telegram,
    tasks: options?.tasks ?? [],
    members: options?.members ?? [],
  };
  const snapshot = reconcileProject(input);
  rememberProjectSnapshot(snapshot);
  return snapshot;
}

async function readGithub(env: NodeJS.ProcessEnv, fetchImpl: FetchLike): Promise<ObservedInputs["github"]> {
  const token = env.GITHUB_TEAM_AGENT_TOKEN?.trim() ?? "";
  const repo = env.GITHUB_TEAM_AGENT_REPO?.trim() ?? "";
  if (!token || !repo) return emptySource({ repo: null, defaultBranch: null, mainSha: null, branches: [], pulls: [] }, "not_configured");
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "user-agent": "Kroogy-Team-Agent",
    "x-github-api-version": "2022-11-28",
  };
  const root = await fetchImpl(`https://api.github.com/repos/${repo}`, { headers });
  if (root.status === 401 || root.status === 403) {
    return failedSource({ repo, defaultBranch: null, mainSha: null, branches: [], pulls: [] }, "authorization_failed", "GitHub отказал в доступе");
  }
  if (!root.ok) {
    return failedSource({ repo, defaultBranch: null, mainSha: null, branches: [], pulls: [] }, "temporarily_unavailable", `GitHub HTTP ${root.status}`);
  }
  const body = asRecord(await root.json());
  const defaultBranch = text(body.default_branch);
  const main = defaultBranch
    ? await fetchImpl(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(defaultBranch)}`, { headers })
    : null;
  const mainSha = main?.ok ? text(asRecord(await main.json()).sha) : null;
  const branchRows = await jsonArray(await fetchImpl(`https://api.github.com/repos/${repo}/branches?per_page=20`, { headers }));
  const pullRows = await jsonArray(await fetchImpl(`https://api.github.com/repos/${repo}/pulls?state=all&per_page=15`, { headers }));
  const mappedBranches: GithubBranchState[] = [];
  for (const row of branchRows.slice(0, 20)) {
    const record = asRecord(row);
    const name = text(record.name);
    const sha = text(asRecord(record.commit).sha);
    if (!name || !sha) continue;
    mappedBranches.push({ name, sha, ahead: null, behind: null, updatedAt: null, author: null });
  }
  const pulls: PullRequestState[] = [];
  for (const row of pullRows.slice(0, 10)) {
    const record = asRecord(row);
    const number = typeof record.number === "number" ? record.number : null;
    const head = asRecord(record.head);
    const headRef = text(head.ref);
    const headSha = text(head.sha);
    if (!number || !headRef || !headSha) continue;
    const filesResponse = await fetchImpl(`https://api.github.com/repos/${repo}/pulls/${number}/files?per_page=30`, { headers });
    const files = (await jsonArray(filesResponse))
      .map((file) => text(asRecord(file).filename))
      .filter((file): file is string => Boolean(file));
    const statusResponse = await fetchImpl(`https://api.github.com/repos/${repo}/commits/${headSha}/status`, { headers });
    const checks = statusResponse.ok ? mapChecks(text(asRecord(await statusResponse.json()).state)) : "unknown";
    pulls.push({
      number,
      title: text(record.title) ?? "",
      author: text(asRecord(record.user).login),
      headRef,
      headSha,
      baseRef: text(asRecord(record.base).ref) ?? defaultBranch ?? "main",
      draft: record.draft === true,
      mergeable: typeof record.mergeable === "boolean" ? record.mergeable : null,
      merged: Boolean(text(record.merged_at)),
      mergedAt: text(record.merged_at),
      files,
      checks,
      url: text(record.html_url) ?? "",
      updatedAt: text(record.updated_at),
    });
  }
  return connectedSource({
    repo,
    defaultBranch,
    mainSha,
    branches: mappedBranches,
    pulls,
  });
}

async function readVercel(env: NodeJS.ProcessEnv, fetchImpl: FetchLike): Promise<ObservedInputs["vercel"]> {
  const token = env.VERCEL_TEAM_AGENT_TOKEN?.trim() ?? "";
  const projectId = env.VERCEL_PROJECT_ID?.trim() || env.VERCEL_TEAM_AGENT_PROJECT_ID?.trim() || "";
  if (!token || !projectId) return emptySource({ production: null, previews: [] }, "not_configured");
  const team = env.VERCEL_TEAM_ID?.trim();
  const query = new URLSearchParams({ projectId, limit: "20" });
  if (team) query.set("teamId", team);
  const response = await fetchImpl(`https://api.vercel.com/v6/deployments?${query.toString()}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (response.status === 401 || response.status === 403) {
    return failedSource({ production: null, previews: [] }, "authorization_failed", "Vercel отказал в доступе");
  }
  if (!response.ok) return failedSource({ production: null, previews: [] }, "temporarily_unavailable", `Vercel HTTP ${response.status}`);
  const deployments = asRecord(await response.json()).deployments;
  const rows = Array.isArray(deployments) ? deployments.map(mapDeployment) : [];
  const production = rows.find((row) => row.environment === "production") ?? null;
  const previews = rows.filter((row) => row.environment === "preview");
  return connectedSource({ production, previews });
}

export function mapDeployment(value: unknown): DeploymentState {
  const row = asRecord(value);
  const meta = asRecord(row.meta);
  const target = text(row.target);
  const readyState = text(row.readyState);
  return {
    id: text(row.uid) ?? text(row.id) ?? "unknown",
    environment: target === "production" ? "production" : "preview",
    status: deploymentStatus(readyState),
    url: text(row.url) ? `https://${text(row.url)}` : null,
    branch: text(meta.githubCommitRef),
    sha: text(meta.githubCommitSha),
    createdAt: numberDate(row.created),
    readyAt: numberDate(row.ready),
    error: text(row.errorMessage),
  };
}

async function readSupabase(env: NodeJS.ProcessEnv, fetchImpl: FetchLike, cwd: string): Promise<ObservedInputs["supabase"]> {
  const localFiles = await localMigrationFiles(cwd);
  const token = env.SUPABASE_ACCESS_TOKEN?.trim() ?? "";
  const ref = env.SUPABASE_PROJECT_REF?.trim() ?? "";
  if (!token || !ref) {
    return {
      status: "not_configured",
      checkedAt: null,
      localFiles,
      applied: [],
      pending: [],
      unknownRemote: [],
      repairFiles: localFiles.filter((file) => file.toLowerCase().includes("repair")),
      error: null,
    };
  }
  const response = await fetchImpl(`https://api.supabase.com/v1/projects/${ref}/database/migrations`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (response.status === 401 || response.status === 403) {
    return {
      status: "authorization_failed",
      checkedAt: new Date().toISOString(),
      localFiles,
      applied: [],
      pending: [],
      unknownRemote: [],
      repairFiles: [],
      error: "Supabase отказал в доступе к истории миграций",
    };
  }
  if (!response.ok) {
    return {
      status: "temporarily_unavailable",
      checkedAt: new Date().toISOString(),
      localFiles,
      applied: [],
      pending: [],
      unknownRemote: [],
      repairFiles: [],
      error: `Supabase HTTP ${response.status}`,
    };
  }
  const applied = (await jsonArray(response))
    .map((row) => text(asRecord(row).version) ?? text(row))
    .filter((version): version is string => Boolean(version));
  const compared = compareMigrationNames(localFiles, applied);
  return {
    status: "connected",
    checkedAt: new Date().toISOString(),
    localFiles,
    applied,
    pending: compared.pending,
    unknownRemote: compared.unknownRemote,
    repairFiles: compared.repairFiles,
    error: null,
  };
}

async function readOpenRouter(env: NodeJS.ProcessEnv, fetchImpl: FetchLike): Promise<SourceState<{ model: string | null }>> {
  const key = env.OPENROUTER_API_KEY?.trim() ?? "";
  if (!key) return emptySource({ model: env.TEAM_AGENT_MODEL?.trim() || null }, "not_configured");
  const response = await fetchImpl("https://openrouter.ai/api/v1/key", { headers: { authorization: `Bearer ${key}` } });
  if (response.status === 402) return failedSource({ model: env.TEAM_AGENT_MODEL?.trim() || null }, "authorization_failed", "OpenRouter billing");
  if (response.status === 401 || response.status === 403) {
    return failedSource({ model: null }, "authorization_failed", "OpenRouter отказал в доступе");
  }
  if (!response.ok) return failedSource({ model: null }, "temporarily_unavailable", `OpenRouter HTTP ${response.status}`);
  return connectedSource({ model: env.TEAM_AGENT_MODEL?.trim() || null });
}

async function readTelegram(env: NodeJS.ProcessEnv, fetchImpl: FetchLike): Promise<SourceState<{ webhookUrl: string | null }>> {
  const token = env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  if (!token) return emptySource({ webhookUrl: null }, "not_configured");
  const response = await fetchImpl(`https://api.telegram.org/bot${token}/getWebhookInfo`);
  if (!response.ok) return failedSource({ webhookUrl: null }, "temporarily_unavailable", `Telegram HTTP ${response.status}`);
  const result = asRecord(asRecord(await response.json()).result);
  const error = text(result.last_error_message);
  return {
    status: "connected",
    checkedAt: new Date().toISOString(),
    error: error ? `Webhook: ${error}` : null,
    value: { webhookUrl: text(result.url) },
  };
}

async function localMigrationFiles(cwd: string): Promise<string[]> {
  try {
    const names = await readdir(join(cwd, "supabase", "migrations"));
    return names.filter((name) => name.endsWith(".sql")).sort();
  } catch {
    return [];
  }
}

function mapChecks(state: string | null): CheckState {
  if (state === "success") return "success";
  if (state === "failure" || state === "error") return "failure";
  if (state === "pending") return "pending";
  return "unknown";
}

function deploymentStatus(value: string | null): DeploymentStatus {
  if (value === "READY" || value === "BUILDING" || value === "ERROR" || value === "CANCELED" || value === "QUEUED") {
    return value;
  }
  return "UNKNOWN";
}

async function jsonArray(response: { json: () => Promise<unknown> }): Promise<unknown[]> {
  try {
    const body = await response.json();
    return Array.isArray(body) ? body : [];
  } catch {
    return [];
  }
}

function emptySource<T>(value: T, status: ConnectionStatus): SourceState<T> {
  return { status, checkedAt: null, error: null, value };
}

function connectedSource<T>(value: T): SourceState<T> {
  return { status: "connected", checkedAt: new Date().toISOString(), error: null, value };
}

function failedSource<T>(value: T, status: ConnectionStatus, error: string): SourceState<T> {
  return { status, checkedAt: new Date().toISOString(), error, value };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberDate(value: unknown): string | null {
  return typeof value === "number" ? new Date(value).toISOString() : null;
}

async function defaultFetch(url: string, init?: { headers?: Record<string, string> }) {
  const response = await fetch(url, { headers: init?.headers });
  const body = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    json: async () => (body ? JSON.parse(body) : {}),
    text: async () => body,
  };
}
