import "server-only";

import { spawn } from "node:child_process";
import path from "node:path";

export type PublishedEnrichKind =
  | "business"
  | "professional"
  | "event"
  | "service"
  | "job"
  | "transfer"
  | "marketplace"
  | "lechu";

const SCRIPT_BY_KIND: Record<PublishedEnrichKind, string> = {
  business: "enrich_published_businesses.py",
  professional: "enrich_professionals_card_first.py",
  event: "enrich_published_events.py",
  service: "enrich_published_listings.py",
  job: "enrich_published_listings.py",
  transfer: "enrich_published_listings.py",
  marketplace: "enrich_published_listings.py",
  lechu: "enrich_published_listings.py",
};

/** Spawn published-entity enrich CLI for one id/slug (apply). Prefer id. */
export function spawnPublishedEnrich(input: {
  kind: PublishedEnrichKind;
  slug?: string;
  id?: string;
}): {
  child: ReturnType<typeof spawn>;
  script: string;
} {
  const root = process.cwd();
  const scriptName = SCRIPT_BY_KIND[input.kind];
  const script = path.join(root, "scripts", "business-enrich", scriptName);

  const args = [script, "--apply", "--ndjson"];
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

  const child = spawn("python3", args, {
    cwd: root,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { child, script };
}
