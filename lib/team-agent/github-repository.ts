/**
 * Read-only GitHub context for Team Agent.
 * Never sends the token to the model. Never writes to GitHub.
 */

import type { RepositoryContext } from "./types";
import { IMPORTANT_REPOSITORY_PATHS } from "./repository-paths";

export type GitHubFetch = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export type GitHubRepositoryOptions = {
  token: string;
  repo: string;
  fetchImpl?: GitHubFetch;
};

const REPO_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function githubConfigFromEnv(env: NodeJS.ProcessEnv): {
  token: string;
  repo: string;
} | null {
  const token = (env.GITHUB_TEAM_AGENT_TOKEN ?? "").trim();
  const repo = (env.GITHUB_TEAM_AGENT_REPO ?? "").trim();
  if (!token || !REPO_NAME.test(repo)) return null;
  return { token, repo };
}

export class GitHubRepositoryContextProvider {
  constructor(private readonly options: GitHubRepositoryOptions) {}

  async getContext(): Promise<RepositoryContext> {
    const { token, repo } = this.options;
    if (!token || !REPO_NAME.test(repo)) return unavailable("GitHub: не подключён.");
    const fetchImpl = this.options.fetchImpl ?? defaultFetch;
    const headers = {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "user-agent": "Kroogy-Team-Agent",
      "x-github-api-version": "2022-11-28",
    };
    try {
      const root = await getJson(fetchImpl, `https://api.github.com/repos/${repo}`, headers);
      if (!root.ok) {
        return unavailable(
          root.status === 401 || root.status === 403
            ? "GitHub: доступ отклонён."
            : "GitHub: временно недоступен.",
        );
      }
      const body = asRecord(root.json);
      const defaultBranch = asString(body.default_branch);
      const [branches, commits, pulls] = await Promise.all([
        getJson(fetchImpl, `https://api.github.com/repos/${repo}/branches?per_page=20`, headers),
        getJson(
          fetchImpl,
          `https://api.github.com/repos/${repo}/commits?per_page=5${defaultBranch ? `&sha=${encodeURIComponent(defaultBranch)}` : ""}`,
          headers,
        ),
        getJson(fetchImpl, `https://api.github.com/repos/${repo}/pulls?state=open&per_page=10`, headers),
      ]);
      const branchNames = Array.isArray(branches.json)
        ? branches.json.map((row) => asString(asRecord(row).name)).filter((name): name is string => Boolean(name))
        : [];
      const recentCommits = Array.isArray(commits.json)
        ? commits.json.slice(0, 5).map((row) => {
            const record = asRecord(row);
            const commit = asRecord(record.commit);
            const author = asRecord(commit.committer);
            return {
              sha: asString(record.sha) ?? "",
              message: (asString(commit.message) ?? "").split("\n")[0] ?? "",
              date: asString(author.date) ?? "",
            };
          })
        : [];
      const openPullRequests = Array.isArray(pulls.json) ? pulls.json.slice(0, 8) : [];
      const pullFiles: string[] = [];
      const pullNotes: string[] = [];
      for (const pull of openPullRequests) {
        const record = asRecord(pull);
        const number = typeof record.number === "number" ? record.number : null;
        const title = asString(record.title) ?? "";
        const head = asString(asRecord(record.head).ref) ?? "";
        if (!number) continue;
        const files = await getJson(
          fetchImpl,
          `https://api.github.com/repos/${repo}/pulls/${number}/files?per_page=20`,
          headers,
        );
        const names = Array.isArray(files.json)
          ? files.json.map((row) => asString(asRecord(row).filename)).filter((name): name is string => Boolean(name))
          : [];
        pullFiles.push(...names);
        const sha = asString(asRecord(record.head).sha);
        let checks = "unknown";
        if (sha) {
          const status = await getJson(
            fetchImpl,
            `https://api.github.com/repos/${repo}/commits/${sha}/status`,
            headers,
          );
          checks = asString(asRecord(status.json).state) ?? "unknown";
        }
        pullNotes.push(`PR #${number} ${title} ветка ${head} проверки ${checks} файлы ${names.join(", ") || "нет"}`);
      }
      return {
        provider: "github",
        repositoryName: repo,
        currentBranch: defaultBranch,
        recentCommits,
        gitStatus: null,
        changedFiles: [...new Set(pullFiles)].slice(0, 40),
        importantDirectories: [...IMPORTANT_REPOSITORY_PATHS.directories],
        architectureDocPaths: [...IMPORTANT_REPOSITORY_PATHS.docs],
        notes: [
          "GitHub: подключён, только чтение.",
          `Ветки: ${branchNames.join(", ") || "нет"}`,
          ...pullNotes,
        ],
        github: {
          configured: true,
          defaultBranch,
          branches: branchNames,
          openPullRequests: openPullRequests.map((pull) => {
            const record = asRecord(pull);
            return {
              number: typeof record.number === "number" ? record.number : 0,
              title: asString(record.title) ?? "",
              head: asString(asRecord(record.head).ref) ?? "",
            };
          }),
        },
      };
    } catch {
      return unavailable("GitHub: временно недоступен.");
    }
  }
}

export function unavailableRepository(note: string): RepositoryContext {
  return unavailable(note);
}

function unavailable(note: string): RepositoryContext {
  return {
    provider: "unavailable",
    repositoryName: null,
    currentBranch: null,
    recentCommits: [],
    gitStatus: null,
    changedFiles: [],
    importantDirectories: [...IMPORTANT_REPOSITORY_PATHS.directories],
    architectureDocPaths: [...IMPORTANT_REPOSITORY_PATHS.docs],
    notes: [note],
    github: null,
  };
}

async function getJson(
  fetchImpl: GitHubFetch,
  url: string,
  headers: Record<string, string>,
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const res = await fetchImpl(url, { headers });
  const json = res.ok ? await res.json() : null;
  return { ok: res.ok, status: res.status, json };
}

function defaultFetch(url: string, init?: { headers?: Record<string, string> }) {
  return fetch(url, { headers: init?.headers });
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
