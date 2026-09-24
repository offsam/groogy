/**
 * Repository context providers — no arbitrary shell from Telegram text.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { RepositoryContext } from "./types";

export interface RepositoryContextProvider {
  getContext(): RepositoryContext;
}

const IMPORTANT_DIRS = [
  "app",
  "lib",
  "components",
  "supabase/migrations",
  "docs/architecture",
  "docs/navigation",
  "docs/team-agent",
  "scripts",
  "types",
] as const;

const ARCH_DOCS = [
  "docs/navigation/AI_AGENT_START_HERE.md",
  "docs/context/PROJECT_CONTEXT_V1.md",
  "docs/architecture/domain/CORE_DOMAIN_ARCHITECTURE_V1.md",
  "docs/architecture/runtime/PLATFORM_LIFECYCLE_V1.md",
  "docs/architecture/entity-model-v1/ARCHITECTURE_FREEZE_V1.md",
  "docs/team-agent/TEAM_AGENT_ARCHITECTURE_V1.md",
] as const;

export class MockRepositoryContextProvider implements RepositoryContextProvider {
  constructor(private readonly override?: Partial<RepositoryContext>) {}

  getContext(): RepositoryContext {
    return {
      provider: "mock",
      repositoryName: "Russian business AI",
      currentBranch: "main",
      recentCommits: [
        {
          sha: "deadbeef",
          message: "mock commit",
          date: "2026-09-17T00:00:00.000Z",
        },
      ],
      gitStatus: "clean (mock)",
      changedFiles: [],
      importantDirectories: [...IMPORTANT_DIRS],
      architectureDocPaths: [...ARCH_DOCS],
      notes: ["Mock provider — no shell executed."],
      ...this.override,
    };
  }
}

/**
 * Local git introspection via fixed allowlisted argv only.
 * Never interpolates user/Telegram text into a shell command.
 */
export class LocalRepositoryContextProvider implements RepositoryContextProvider {
  constructor(private readonly cwd: string = process.cwd()) {}

  getContext(): RepositoryContext {
    const notes: string[] = [];
    let currentBranch: string | null = null;
    let recentCommits: RepositoryContext["recentCommits"] = [];
    let gitStatus: string | null = null;
    let changedFiles: string[] = [];
    let repositoryName: string | null = null;

    try {
      repositoryName =
        safeGit(this.cwd, ["rev-parse", "--show-toplevel"])
          ?.split("/")
          .pop() ?? null;
      currentBranch = safeGit(this.cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
      gitStatus = safeGit(this.cwd, ["status", "--porcelain"]) || "(clean)";
      changedFiles = (gitStatus === "(clean)" ? [] : gitStatus.split("\n"))
        .map((line) => line.slice(3).trim())
        .filter(Boolean);
      const log = safeGit(this.cwd, [
        "log",
        "-5",
        "--pretty=format:%H|%s|%cI",
      ]);
      if (log) {
        recentCommits = log.split("\n").filter(Boolean).map((line) => {
          const [sha, message, date] = line.split("|");
          return { sha: sha ?? "", message: message ?? "", date: date ?? "" };
        });
      }
    } catch (err) {
      notes.push(
        `Local git unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
      return {
        provider: "unavailable",
        repositoryName,
        currentBranch,
        recentCommits,
        gitStatus,
        changedFiles,
        importantDirectories: existingDirs(this.cwd),
        architectureDocPaths: existingDocs(this.cwd),
        notes,
      };
    }

    return {
      provider: "local",
      repositoryName,
      currentBranch,
      recentCommits,
      gitStatus,
      changedFiles,
      importantDirectories: existingDirs(this.cwd),
      architectureDocPaths: existingDocs(this.cwd),
      notes,
    };
  }
}

/** Documented next step — not implemented in V1. */
export class GitHubRepositoryContextProvider implements RepositoryContextProvider {
  getContext(): RepositoryContext {
    return {
      provider: "unavailable",
      repositoryName: null,
      currentBranch: null,
      recentCommits: [],
      gitStatus: null,
      changedFiles: [],
      importantDirectories: [...IMPORTANT_DIRS],
      architectureDocPaths: [...ARCH_DOCS],
      notes: [
        "GitHubRepositoryContextProvider is a documented next step — not implemented in V1.",
      ],
    };
  }
}

function safeGit(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }
}

function existingDirs(cwd: string): string[] {
  return IMPORTANT_DIRS.filter((d) => existsSync(join(cwd, d)));
}

function existingDocs(cwd: string): string[] {
  return ARCH_DOCS.filter((d) => existsSync(join(cwd, d)));
}
