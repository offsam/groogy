/**
 * Deterministic file-scope conflict detection for Team Agent tasks.
 */

import type { ConflictSeverity, PathConflict, TaskConflictReport } from "./types";

/** Real critical paths / patterns in this repository. */
export const CRITICAL_PATH_PATTERNS: readonly string[] = [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "next.config.ts",
  "next.config.js",
  "middleware.ts",
  "middleware.js",
  "types/database.ts",
  ".env.example",
  "supabase/migrations",
  "docs/architecture",
  "docs/navigation",
  "docs/context/PROJECT_CONTEXT_V1.md",
  "lib/supabase",
] as const;

export function normalizeScopePath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "")
    .replace(/\*\*$/, "")
    .replace(/\/\*$/, "")
    .replace(/\*$/, "");
}

export function isCriticalPath(path: string): boolean {
  const n = normalizeScopePath(path).toLowerCase();
  return CRITICAL_PATH_PATTERNS.some((p) => {
    const crit = p.toLowerCase();
    return n === crit || n.startsWith(`${crit}/`) || crit.startsWith(`${n}/`);
  });
}

/**
 * Does declared scope A cover the same filesystem area as B?
 * Supports simple directory prefixes (lib/reviews covers lib/reviews/actions.ts).
 */
export function pathsOverlap(a: string, b: string): boolean {
  const na = normalizeScopePath(a).toLowerCase();
  const nb = normalizeScopePath(b).toLowerCase();
  if (!na || !nb) return false;
  if (na === nb) return true;
  return na.startsWith(`${nb}/`) || nb.startsWith(`${na}/`);
}

function severityForPair(a: string, b: string): ConflictSeverity {
  if (!pathsOverlap(a, b)) return "none";
  const na = normalizeScopePath(a);
  const nb = normalizeScopePath(b);
  if (na.toLowerCase() === nb.toLowerCase()) {
    return isCriticalPath(na) ? "high" : "high";
  }
  // Directory vs file / shared tree
  if (isCriticalPath(na) || isCriticalPath(nb)) return "high";
  // Broad trees (e.g. supabase/migrations/** vs supabase/migrations/**)
  if (
    na.toLowerCase().includes("supabase/migrations") &&
    nb.toLowerCase().includes("supabase/migrations")
  ) {
    return "high";
  }
  return "possible";
}

export function detectPathConflicts(
  pathsA: string[],
  pathsB: string[],
): TaskConflictReport {
  const overlaps: PathConflict[] = [];
  let worst: ConflictSeverity = "none";

  for (const a of pathsA) {
    for (const b of pathsB) {
      const severity = severityForPair(a, b);
      if (severity === "none") continue;
      overlaps.push({
        severity,
        pathA: normalizeScopePath(a),
        pathB: normalizeScopePath(b),
        reason:
          severity === "high"
            ? "exact or critical-path overlap"
            : "prefix / directory overlap",
      });
      if (severity === "high" || (severity === "possible" && worst === "none")) {
        worst = severity;
      }
      if (severity === "high") worst = "high";
    }
  }

  return { severity: worst, overlaps };
}

export function detectTaskScopeConflicts(
  taskA: { id?: string; scope_paths: string[] },
  taskB: { id?: string; scope_paths: string[] },
): TaskConflictReport {
  return detectPathConflicts(taskA.scope_paths, taskB.scope_paths);
}
