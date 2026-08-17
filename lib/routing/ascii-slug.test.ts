/**
 * Run: npx tsx lib/routing/ascii-slug.test.ts
 */
import {
  asciiSlug,
  catalogCardSlug,
  hasCyrillic,
  nextAvailableSlug,
  slugFromWebsiteHost,
  slugHasSourceNoise,
} from "./ascii-slug";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(hasCyrillic("иммиграционный-переводчик"), "cyrillic detect");
assert(!hasCyrillic("translatorpro"), "latin is clean");

assert(
  asciiSlug("иммиграционный-переводчик-михаил-богомольный") ===
    "immigration-translator-mihail-bogomolnyi",
  `name slug got ${asciiSlug("иммиграционный-переводчик-михаил-богомольный")}`,
);

assert(
  slugFromWebsiteHost("https://www.translatorpro.org/") === "translatorpro",
  `host got ${slugFromWebsiteHost("https://www.translatorpro.org/")}`,
);
assert(slugFromWebsiteHost("https://www.facebook.com/foo") === null, "skip fb");
assert(slugFromWebsiteHost("https://svoi.us/companies/abc") === null, "skip directory host");

assert(
  catalogCardSlug({
    name: "Svoi American Business Standard",
    website: "https://svoi.us/companies/abc",
  }) === "american-business-standard",
  `directory source must not be in slug, got ${catalogCardSlug({
    name: "Svoi American Business Standard",
    website: "https://svoi.us/companies/abc",
  })}`,
);
assert(
  catalogCardSlug({
    name: "American Business Standard",
    currentSlug: "svoi-american-business-standard",
  }) === "american-business-standard",
  "strip svoi- prefix from existing slug fallback",
);

assert(
  catalogCardSlug({
    name: "Иммиграционный переводчик Михаил Богомольный",
    website: "https://www.translatorpro.org/",
  }) === "translatorpro",
  "prefer distinctive website host",
);

assert(
  catalogCardSlug({
    name: "Салон красоты Анна",
    website: null,
  }) === "salon-krasoty-anna",
  `salon slug got ${catalogCardSlug({ name: "Салон красоты Анна" })}`,
);

assert(slugHasSourceNoise("svoi-american-business-standard"), "svoi prefix is noise");
assert(!slugHasSourceNoise("american-business-standard"), "clean slug");

const taken = new Set(["translatorpro"]);
assert(
  nextAvailableSlug("translatorpro", taken) === "translatorpro-2",
  "unique suffix",
);

console.log("ascii-slug ok");
