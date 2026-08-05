/**
 * Professional sphere taxonomy — no business «Рестораны» on pros.
 * Run: npx tsx lib/professional/categories-contract.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROFESSIONAL_CATEGORY_SLUGS } from "./categories";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  (PROFESSIONAL_CATEGORY_SLUGS as readonly string[]).includes("home_food"),
  "home_food (Готовим) must be a pro sphere",
);
assert(
  !(PROFESSIONAL_CATEGORY_SLUGS as readonly string[]).includes("restaurants"),
  "business restaurants must not be a pro sphere",
);

const queries = readFileSync(
  join(process.cwd(), "lib/supabase/queries.ts"),
  "utf8",
);
assert(
  queries.includes("getProfessionalCategories") &&
    queries.includes("[...PROFESSIONAL_CATEGORY_SLUGS]"),
  "getProfessionalCategories must filter to PROFESSIONAL_CATEGORY_SLUGS only",
);
assert(
  !/domain\.eq\.professional,domain\.eq\.business/.test(queries),
  "must not load all business categories for professionals",
);

const reclass = readFileSync(
  join(process.cwd(), "lib/admin/reclassify-actions.ts"),
  "utf8",
);
assert(
  reclass.includes("PROFESSIONAL_CATEGORY_SLUGS") &&
    reclass.includes("Категория не из сфер специалистов"),
  "admin category set must reject non-pro spheres",
);

console.log("OK: professional categories contract");
