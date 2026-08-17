import "server-only";

import { spawn } from "node:child_process";
import path from "node:path";
import { pythonSpawnEnv, resolvePythonBin } from "@/lib/admin/resolve-python";

export type PublishedEnrichKind =
  | "business"
  | "professional"
  | "event"
  | "service"
  | "job"
  | "transfer"
  | "marketplace"
  | "lechu"
  | "church";

export type PublishedEnrichQueueTarget = {
  source: "import_review" | "recommendation";
  id: string;
};

const SCRIPT_BY_KIND: Record<PublishedEnrichKind, string> = {
  business: "enrich_published_businesses.py",
  professional: "enrich_professionals_card_first.py",
  event: "enrich_published_events.py",
  service: "enrich_published_listings.py",
  job: "enrich_published_listings.py",
  transfer: "enrich_published_listings.py",
  marketplace: "enrich_published_listings.py",
  lechu: "enrich_published_listings.py",
  church: "enrich_published_churches.py",
};

/** Spawn published-entity enrich CLI for one id/slug.
 *  Published cards default to dry-run (admin reviews then Save).
 *  Queue cards still apply fill-empty immediately.
 */
export function spawnPublishedEnrich(input: {
  kind: PublishedEnrichKind;
  slug?: string;
  id?: string;
  /** Queue card: same crawl as published, writes back to queue row. */
  queue?: PublishedEnrichQueueTarget;
  /**
   * `dry-run` — compute patch, do not PATCH the entity (admin checklist).
   * `apply` — write fill-empty during the crawl (queue / legacy).
   */
  mode?: "dry-run" | "apply";
}): {
  child: ReturnType<typeof spawn>;
  script: string;
} {
  const root = process.cwd();
  const mode = input.mode ?? (input.queue ? "apply" : "dry-run");
  const modeFlag = mode === "apply" ? "--apply" : "--dry-run";

  if (input.queue) {
    const script = path.join(
      root,
      "scripts",
      "business-enrich",
      "enrich_queue_card.py",
    );
    const args = [script, "--apply", "--ndjson", "--kind", input.kind];
    if (input.queue.source === "recommendation") {
      args.push("--recommendation-id", input.queue.id);
    } else {
      args.push("--import-review-id", input.queue.id);
    }
    const child = spawn(resolvePythonBin(root), args, {
      cwd: root,
      env: pythonSpawnEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { child, script };
  }

  const scriptName = SCRIPT_BY_KIND[input.kind];
  const script = path.join(root, "scripts", "business-enrich", scriptName);

  const args = [script, modeFlag, "--ndjson"];
  if (
    input.kind === "service" ||
    input.kind === "job" ||
    input.kind === "transfer" ||
    input.kind === "marketplace" ||
    input.kind === "lechu"
  ) {
    args.push("--kind", input.kind);
  }

  const id = (input.id || "").trim();
  const slug = (input.slug || "").trim();

  if (id) {
    args.push("--id", id);
  } else if (slug) {
    args.push("--slug", slug);
  } else {
    throw new Error("enrich requires id or slug");
  }

  const child = spawn(resolvePythonBin(root), args, {
    cwd: root,
    env: pythonSpawnEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { child, script };
}
