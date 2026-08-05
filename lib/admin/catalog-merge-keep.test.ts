/**
 * Catalog merge keep/drop by fill richness.
 * Run: npx tsx lib/admin/catalog-merge-keep.test.ts
 */
import { preferKeepSelfByFill } from "./catalog-merge-keep";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  preferKeepSelfByFill({
    selfKind: "business",
    candidateKind: "professional",
    selfFill: 3,
    candidateFill: 8,
  }) === false,
  "richer professional must beat poorer business",
);

assert(
  preferKeepSelfByFill({
    selfKind: "professional",
    candidateKind: "business",
    selfFill: 8,
    candidateFill: 3,
  }) === true,
  "richer professional keeps itself",
);

assert(
  preferKeepSelfByFill({
    selfKind: "business",
    candidateKind: "professional",
    selfFill: 5,
    candidateFill: 5,
  }) === false,
  "tie → prefer professional (drop business self)",
);

assert(
  preferKeepSelfByFill({
    selfKind: "professional",
    candidateKind: "business",
    selfFill: 5,
    candidateFill: 5,
  }) === true,
  "tie → keep professional self",
);

assert(
  preferKeepSelfByFill({
    selfKind: "business",
    candidateKind: "business",
    selfFill: 4,
    candidateFill: 4,
  }) === true,
  "same-type tie → keep self",
);

console.log("OK: catalog-merge-keep preferKeepSelfByFill");
