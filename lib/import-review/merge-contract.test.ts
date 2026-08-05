/**
 * Contract tests for catalog merge target pick (R15) + public status (R16).
 * Run: npx tsx lib/import-review/merge-contract.test.ts
 */
import {
  catalogMergeTargetScore,
  compareCatalogMergeTargets,
  isPubliclyListedStatus,
  pickBestCatalogMergeTarget,
  duplicateMatchListRank,
  type CatalogMergeCandidate,
} from "./merge-contract";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const archivedBiz: CatalogMergeCandidate = {
  kind: "business",
  id: "biz-arch",
  title: "Оксана Куриленко",
  slug: "business-4156194812-172158",
  status: "archived",
  phone: "+14156194812",
};

const approvedPro: CatalogMergeCandidate = {
  kind: "professional",
  id: "pro-live",
  title: "Оксана Куриленко",
  slug: "business-4156194812-172158",
  status: "approved",
  phone: "+14156194812",
};

const pendingBiz: CatalogMergeCandidate = {
  kind: "business",
  id: "biz-pend",
  title: "Оксана",
  slug: "oxana-pending",
  status: "pending",
  phone: "+14156194812",
};

assert(
  catalogMergeTargetScore("approved", "+1") >
    catalogMergeTargetScore("archived", "+1"),
  "approved must beat archived",
);

assert(
  pickBestCatalogMergeTarget([archivedBiz, approvedPro])?.id === "pro-live",
  "merge-all must pick approved professional over archived business",
);

assert(
  pickBestCatalogMergeTarget([archivedBiz, pendingBiz])?.id === "biz-pend",
  "pending beats archived",
);

assert(
  compareCatalogMergeTargets(approvedPro, archivedBiz) < 0,
  "approved professional sorts before archived business",
);

assert(isPubliclyListedStatus("approved") === true, "approved is public");
assert(isPubliclyListedStatus("pending") === false, "pending is not public");
assert(isPubliclyListedStatus("archived") === false, "archived is not public");

assert(
  duplicateMatchListRank({ kind: "business", status: "approved" }) <
    duplicateMatchListRank({ kind: "business", status: "archived" }),
  "list: approved before archived",
);

console.log("OK: merge-contract R15/R16");
