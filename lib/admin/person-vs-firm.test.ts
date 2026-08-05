/**
 * Person vs firm heuristic for employee attach.
 * Run: npx tsx lib/admin/person-vs-firm.test.ts
 */
import {
  classifyEntityName,
  employerRoleFromName,
  suggestEmployeeAttach,
} from "./person-vs-firm";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  classifyEntityName("Shestopalko Law PLLC") === "firm",
  "Shestopalko Law PLLC is firm",
);
assert(
  classifyEntityName("Natalie Melnik, CPA") === "person",
  "Natalie Melnik, CPA is person",
);

const s = suggestEmployeeAttach(
  { id: "firm", name: "Shestopalko Law PLLC", kind: "business" },
  { id: "person", name: "Natalie Melnik, CPA", kind: "business" },
);
assert(s?.firmId === "firm" && s?.personId === "person", "attach suggestion");
assert(s?.confidence === "high", "high confidence");

assert(
  suggestEmployeeAttach(
    { id: "a", name: "Alpha Law PLLC", kind: "business" },
    { id: "b", name: "Beta Clinic LLC", kind: "business" },
  ) === null,
  "two firms → no attach",
);

assert(employerRoleFromName("Natalie Melnik, CPA") === "CPA", "CPA role");

console.log("person-vs-firm.test.ts: ok");
