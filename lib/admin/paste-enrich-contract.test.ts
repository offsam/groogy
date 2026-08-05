/**
 * Paste-enrich contracts — name on live cards + Google Maps paste.
 * Run: npx tsx lib/admin/paste-enrich-contract.test.ts
 * CI: .github/workflows/ci.yml
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildPasteEnrichPreview,
  extractFacebookRecommendFromText,
  extractGoogleRatingFromText,
  extractServicesFromText,
  extractUsStreetAddresses,
  extractWebsitesFromText,
  pasteAddressPreviewAction,
  pasteEnrichFillEmptyPatch,
  preferWebsiteStreet,
  streetIdentity,
} from "./paste-enrich";
import {
  extractPasteEnrichName,
  parsePasteEnrichTextWithName,
} from "./paste-enrich-name";
import {
  inferNameFromDescription,
  isPersonLikeImportName,
} from "../import-review/display-name";
import {
  pickPrimaryWebsiteFromList,
  pickYelpUrlFromList,
} from "../business/presence";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const GOOGLE_MAPS_PASTE = `European Delights - Gourmet Foods
4.7
(100)
Gourmet grocery store


Overview
Products
Reviews
Photos
Website
Directions
Save
Share
Call
Bakery · Pharmacy · Accepts SNAP/EBT
Friday	10 AM–7 PM
Saturday	10 AM–7 PM
Sunday	10 AM–7 PM
Monday	10 AM–7 PM
Tuesday	10 AM–7 PM
Wednesday	10 AM–7 PM
Thursday	10 AM–7 PM
Suggest new hours
10613 Lawson River Ave, Fountain Valley, CA 92708
Map of European Delights - Gourmet Foods
4.7
·
100 Reviews
(949) 531-1494`;

const name = extractPasteEnrichName(GOOGLE_MAPS_PASTE);
assert(
  name === "European Delights - Gourmet Foods",
  `expected Google title, got ${JSON.stringify(name)}`,
);

const extracted = parsePasteEnrichTextWithName(GOOGLE_MAPS_PASTE);
assert(
  extracted.name === "European Delights - Gourmet Foods",
  "parsePasteEnrichTextWithName must set name",
);
assert(extracted.phone[0] === "+19495311494", "phone from Google paste");
assert(extracted.city === "Fountain Valley", "city from Google paste");
assert(extracted.addressLine === "10613 Lawson River Ave", "street");
assert(extracted.postalCode === "92708", "zip");
assert(extracted.openingHours != null, "hours from Google paste");

// Suite / Ste after street type (Google Maps often: «100 Laguna Rd ste 210, City, CA ZIP»)
const suitePaste = `Affordable Dentist Dr. Rhoudenko
4.7
(183)
Emergency dental service
Overview
Reviews
Photos
Website
Directions
Save
Share
Call
Services: Teeth whitening, Invisaligns Clear Aligners, Dentistry for children, Crowns and bridges, White esthetic fillings, Dentures, Partial dentures, Free orthodontist consultation, Professional teeth cleaning, Night guard, Extractions, Wisdom teeth and Surgery, Clear Aligners, Invisaligns, General repairs & maintenance, New set of dentures, and Implants
100 Laguna Rd ste 210, Fullerton, CA 92835
Map of Affordable Dentist Dr. Rhoudenko
4.7
·
183 Reviews`;
const suite = parsePasteEnrichTextWithName(suitePaste);
assert(
  suite.name === "Affordable Dentist Dr. Rhoudenko",
  `Maps title with Dr. expected, got ${JSON.stringify(suite.name)}`,
);
assert(
  suite.addressLine?.toLowerCase().includes("laguna") &&
    suite.addressLine?.toLowerCase().includes("ste"),
  `suite street expected, got ${JSON.stringify(suite.addressLine)}`,
);
assert(suite.city === "Fullerton", "Fullerton from suite paste");
assert(suite.postalCode === "92835", "92835 from suite paste");
assert(suite.googleRating === 4.7 && suite.googleReviewsCount === 183, "rating");
assert(
  suite.services.includes("Teeth whitening") &&
    suite.services.includes("Implants") &&
    suite.services.length >= 10,
  `Services: list expected, got ${JSON.stringify(suite.services)}`,
);
const suitePreview = buildPasteEnrichPreview({}, suite, false);
assert(
  suitePreview.find((r) => r.key === "services")?.action === "add",
  "preview adds Google Services list",
);
assert(
  suitePreview.find((r) => r.key === "name")?.value ===
    "Affordable Dentist Dr. Rhoudenko",
  "preview name is Maps title, not category",
);

// RU Google Maps dump: «Услуги:» + chrome / hours / address — NOT offers.
const tigranMapsDump = `Tigran trucking inc
4.8
(12)
Услуги: Мастерская по ремонту грузовиков·, О нас, Поблизости, Отправить на телефон, 3237 Bordentown Ave, Parlin, NJ 08859, Понедельник, 8:00–19:00, Вторник, Среда, Четверг, Пятница, Суббота, Закрыто, Воскресенье, Предложить новые часы работы
Body shop!!! Кузовной ремонт`;
const tigranParsed = parsePasteEnrichTextWithName(tigranMapsDump);
assert(
  tigranParsed.services.length === 0,
  `Maps chrome must not become services, got ${JSON.stringify(tigranParsed.services)}`,
);
assert(
  extractServicesFromText("Услуги\nМастерская по ремонту грузовиков").length === 0,
  "bare Услуги + category chip is not a service list",
);

// YouTube channel → contact (not ignored / not website).
const ytPaste = `Ссылки
YouTube
youtube.com/@tigrantrucking
Telegram
t.me/tigrantrucking`;
const ytParsed = parsePasteEnrichTextWithName(ytPaste);
assert(
  ytParsed.youtube === "https://www.youtube.com/@tigrantrucking",
  `YouTube channel expected, got ${JSON.stringify(ytParsed.youtube)}`,
);
assert(
  ytParsed.telegram === "tigrantrucking",
  `Telegram handle expected, got ${JSON.stringify(ytParsed.telegram)}`,
);
assert(
  ytParsed.name == null || !/^(ссылки|links|youtube|telegram)$/i.test(ytParsed.name),
  `section label must not become name, got ${JSON.stringify(ytParsed.name)}`,
);
assert(
  !(ytParsed.website ?? []).some((u) => /youtube\.com/i.test(u)),
  "YouTube must not be stored as website",
);
const ytPreview = buildPasteEnrichPreview({}, ytParsed, false);
assert(
  ytPreview.find((r) => r.key === "youtube")?.action === "add",
  "preview offers YouTube add",
);

// Labor rate table (glued OCR) → priced services, not fake name/description.
const ratesPaste =
  "Service Rates & PricingThe shop operates under an explicit tier-based labor structure:Service TypeRate (Per Hour)Mechanical Labor$90Electrical Labor$100Steel Welding$110Aluminum Welding$130";
const rates = parsePasteEnrichTextWithName(ratesPaste);
assert(rates.name == null, `rate table must not become name, got ${JSON.stringify(rates.name)}`);
assert(rates.description == null, "rate table must not become description");
assert(
  rates.pricedServices.length === 4 &&
    rates.pricedServices.some((p) => p.title === "Mechanical Labor" && p.priceAmount === 90) &&
    rates.pricedServices.some((p) => p.title === "Aluminum Welding" && p.priceAmount === 130),
  `priced labor rates expected, got ${JSON.stringify(rates.pricedServices)}`,
);
assert(
  buildPasteEnrichPreview({}, rates, false).find((r) => r.key === "services")?.action ===
    "add",
  "preview adds priced services",
);

const commaSuite = parsePasteEnrichTextWithName(
  "Clinic\n100 Laguna Rd, Suite 210, Fullerton, CA 92835",
);
assert(
  commaSuite.addressLine?.toLowerCase().includes("suite") &&
    commaSuite.city === "Fullerton",
  `comma Suite address expected, got ${JSON.stringify(commaSuite.addressLine)} / ${commaSuite.city}`,
);

// Google Maps: Pkwy / Parkway + suite range (Dance Code Ballroom Studio paste)
const pkwyPaste = `Dance Code Ballroom Studio
5.0
(9)
Dance school
Overview
Reviews
About
Directions
Save
Share
23572 Moulton Pkwy Ste 102-104, Laguna Woods, CA 92637
Open · Closes 10 PM
dancecodeballroom.com
(949) 878-6463`;
const pkwy = parsePasteEnrichTextWithName(pkwyPaste);
assert(
  pkwy.addressLine?.toLowerCase().includes("moulton") &&
    pkwy.addressLine?.toLowerCase().includes("pkwy"),
  `Pkwy street expected, got ${JSON.stringify(pkwy.addressLine)}`,
);
assert(
  pkwy.addressLine?.includes("102-104") ||
    pkwy.addressLine?.toLowerCase().includes("ste"),
  `suite range expected in address, got ${JSON.stringify(pkwy.addressLine)}`,
);
assert(pkwy.city === "Laguna Woods", `Laguna Woods expected, got ${JSON.stringify(pkwy.city)}`);
assert(pkwy.postalCode === "92637", "92637 from Pkwy paste");
assert(pkwy.phone[0] === "+19498786463", "phone from Dance Code paste");
assert(
  pkwy.name === "Dance Code Ballroom Studio",
  `Maps title expected, got ${JSON.stringify(pkwy.name)}`,
);

const ratingPaste = `European Delights - Gourmet Foods
4.7
(100)
Gourmet grocery store
10613 Lawson River Ave, Fountain Valley, CA 92708
(949) 531-1494`;
const g = extractGoogleRatingFromText(ratingPaste);
assert(g?.rating === 4.7 && g?.reviewsCount === 100, "Google 4.7 (100) from Maps paste");
const rated = parsePasteEnrichTextWithName(ratingPaste);
assert(rated.googleRating === 4.7, "extracted.googleRating");
assert(rated.googleReviewsCount === 100, "extracted.googleReviewsCount");
const ratingPreview = buildPasteEnrichPreview({}, rated, false);
assert(
  ratingPreview.find((r) => r.key === "googleRating")?.action === "add",
  "preview adds Google rating when empty",
);
assert(
  buildPasteEnrichPreview({ googleRating: 4.7 }, rated, false).find(
    (r) => r.key === "googleRating",
  )?.action === "skip",
  "fill-empty skips existing Google rating",
);

// RU Maps: «отзывов» must parse (JS `\b` is ASCII-only and used to break here).
const ruRatingSameLine = extractGoogleRatingFromText("4.7 (100) отзывов");
assert(
  ruRatingSameLine?.rating === 4.7 && ruRatingSameLine?.reviewsCount === 100,
  `RU same-line отзывов expected 4.7/100, got ${JSON.stringify(ruRatingSameLine)}`,
);
const ruRatingDot = extractGoogleRatingFromText("4.7 · 258 отзывов");
assert(
  ruRatingDot?.rating === 4.7 && ruRatingDot?.reviewsCount === 258,
  `RU · отзывов expected 4.7/258, got ${JSON.stringify(ruRatingDot)}`,
);
const ruRatingNewline = extractGoogleRatingFromText("4.5\n258 отзывов Google");
assert(
  ruRatingNewline?.rating === 4.5 && ruRatingNewline?.reviewsCount === 258,
  `RU newline отзывов expected 4.5/258, got ${JSON.stringify(ruRatingNewline)}`,
);
const ruGlued = extractGoogleRatingFromText("4.5258 отзывов Google");
assert(
  ruGlued?.rating === 4.5 && ruGlued?.reviewsCount === 258,
  `glued 4.5258 отзывов → 4.5/258, got ${JSON.stringify(ruGlued)}`,
);
const lazyRuMaps = `Lazy Tigers Truck Center
4.5
(258)
·
258 отзывов Google
Автосервис
Адрес
411 Whitehead Ave #6, South River, NJ 08882
Телефон
(929) 549-8206`;
const lazyRu = parsePasteEnrichTextWithName(lazyRuMaps);
assert(
  lazyRu.googleRating === 4.5 && lazyRu.googleReviewsCount === 258,
  `Lazy Tigers RU Maps rating expected 4.5/258, got ${lazyRu.googleRating}/${lazyRu.googleReviewsCount}`,
);
assert(
  lazyRu.menuItems.length === 0,
  `Maps must not become menu, got ${JSON.stringify(lazyRu.menuItems)}`,
);
assert(
  buildPasteEnrichPreview(
    { googleRating: null, googleReviewsCount: 0, phone: "+19293273738" },
    lazyRu,
    false,
  ).find((r) => r.key === "googleRating")?.action === "add",
  "preview adds Google when card rating empty",
);

const yelpPaste = `Affordable Dentist Dr. Polina Rhoudenko General Dentistry
 Yelp 4.1 (7 reviews)
 Claimed
General Dentistry, Cosmetic Dentists, Pediatric Dentists
Open 8:00 AM - 2:00 PM`;
const yelpRated = parsePasteEnrichTextWithName(yelpPaste);
assert(yelpRated.yelpRating === 4.1, `yelpRating expected 4.1, got ${yelpRated.yelpRating}`);
assert(yelpRated.yelpReviewsCount === 7, `yelpReviews expected 7, got ${yelpRated.yelpReviewsCount}`);
assert(
  yelpRated.googleRating == null,
  `Yelp stars must not become googleRating, got ${yelpRated.googleRating}`,
);
assert(
  buildPasteEnrichPreview({}, yelpRated, false).find((r) => r.key === "yelpRating")
    ?.action === "add",
  "preview adds Yelp rating",
);

const trustpilotPaste = `Start CDL Training
https://www.trustpilot.com/review/startcdl.com
Trustpilot 3.7 (1 review)
CDL school in Orange County`;
const tpRated = parsePasteEnrichTextWithName(trustpilotPaste);
assert(
  tpRated.trustpilot === "https://www.trustpilot.com/review/startcdl.com",
  `trustpilot url expected, got ${tpRated.trustpilot}`,
);
assert(
  tpRated.trustpilotRating === 3.7,
  `trustpilotRating expected 3.7, got ${tpRated.trustpilotRating}`,
);
assert(
  tpRated.trustpilotReviewsCount === 1,
  `trustpilotReviews expected 1, got ${tpRated.trustpilotReviewsCount}`,
);
assert(
  tpRated.googleRating == null,
  `Trustpilot stars must not become googleRating, got ${tpRated.googleRating}`,
);
assert(
  buildPasteEnrichPreview({}, tpRated, false).find(
    (r) => r.key === "trustpilotRating",
  )?.action === "add",
  "preview adds Trustpilot rating",
);

// Google Maps mobile dump: stars + parenthesized thousands with comma.
const mapsThousands = `Start CDL
4.9
(1,724)
Driving school

Overview
Reviews
About
835 Industrial Hwy #1, Cinnaminson, NJ 08077
Closed · Opens 9 AM Tue
startcdl.com
(856) 409-7484`;
const mapsThousandsRated = parsePasteEnrichTextWithName(mapsThousands);
assert(
  mapsThousandsRated.googleRating === 4.9,
  `maps thousands googleRating expected 4.9, got ${mapsThousandsRated.googleRating}`,
);
assert(
  mapsThousandsRated.googleReviewsCount === 1724,
  `maps thousands count expected 1724, got ${mapsThousandsRated.googleReviewsCount}`,
);

// Multi-location shop page — street «4695» must NOT become Google 4.0 (695).
const flowerLocations = `L'amour Toujours Flower Boutique

4695 MacArthur Ct 11th Floor, Newport Beach, CA, 92660(link opens in a new window)

(949) 351-6824

lamourtoujoursflowers@gmail.com
L'amour Toujours Flower Boutique - Las Vegas Location
Pick-Up Only:

2300 W Sahara Ave, Las Vegas, NV, 89102(link opens in a new window)

(702) 518-6225
L'amour Toujours Flower Boutique

15052 Red Hill Ave, Tustin, CA, 92780(link opens in a new window)
Hours

Monday
9 AM - 8 PM
Tuesday
9 AM - 8 PM`;
assert(
  extractGoogleRatingFromText(flowerLocations) == null,
  `street 4695 must not be Google rating, got ${JSON.stringify(extractGoogleRatingFromText(flowerLocations))}`,
);
assert(
  parsePasteEnrichTextWithName(flowerLocations).googleRating == null,
  "flower locations paste has no Google rating",
);

// Website / Maps paste street replaces telegram party glue on the card.
assert(
  preferWebsiteStreet("237 Ocean Ave", "4695 MacArthur Ct 11th Floor"),
  "MacArthur should prefer over Ocean Ave",
);
const glueExisting = {
  addressLine: "237 Ocean Ave",
  city: "Laguna Beach",
  postalCode: "92651",
};
const flowerExtracted = parsePasteEnrichTextWithName(flowerLocations);
assert(
  flowerExtracted.addressLine?.includes("MacArthur") ||
    flowerExtracted.addressLine?.includes("Sahara") ||
    flowerExtracted.addressLine?.includes("Red Hill"),
  `expected a shop street, got ${JSON.stringify(flowerExtracted.addressLine)}`,
);
const replaced = pasteEnrichFillEmptyPatch(glueExisting, flowerExtracted, null);
assert(
  typeof replaced.addressLine === "string" &&
    streetIdentity(String(replaced.addressLine)) !==
      streetIdentity("237 Ocean Ave"),
  `paste must replace Ocean Ave, got ${JSON.stringify(replaced.addressLine)}`,
);
assert(
  buildPasteEnrichPreview(glueExisting, flowerExtracted, false).find(
    (r) => r.key === "address",
  )?.action === "replace",
  "preview shows address as replace over glue",
);

// Confirmed replace keys write; empty list keeps glue.
const replacedConfirmed = pasteEnrichFillEmptyPatch(
  glueExisting,
  flowerExtracted,
  null,
  { applyReplaceKeys: ["address"] },
);
assert(
  typeof replacedConfirmed.addressLine === "string" &&
    streetIdentity(String(replacedConfirmed.addressLine)) !==
      streetIdentity("237 Ocean Ave"),
  `confirmed replace must write street, got ${JSON.stringify(replacedConfirmed.addressLine)}`,
);
const keptGlue = pasteEnrichFillEmptyPatch(
  glueExisting,
  flowerExtracted,
  null,
  { applyReplaceKeys: [] },
);
assert(
  keptGlue.addressLine === undefined,
  `empty replace keys must keep glue, got ${JSON.stringify(keptGlue.addressLine)}`,
);

const previewEmpty = buildPasteEnrichPreview({}, extracted, false);
const nameRow = previewEmpty.find((r) => r.key === "name");
assert(nameRow?.action === "add", "empty card → add name");
assert(
  nameRow?.value === "European Delights - Gourmet Foods",
  "preview shows company name",
);

const previewSkip = buildPasteEnrichPreview(
  { name: "Already Named Deli" },
  extracted,
  false,
);
assert(
  previewSkip.find((r) => r.key === "name")?.action === "skip",
  "fill-empty: existing name is skipped",
);

const patch = pasteEnrichFillEmptyPatch({}, extracted, null);
assert(
  patch.name === "European Delights - Gourmet Foods",
  "fill-empty patch includes name",
);
const patchSkip = pasteEnrichFillEmptyPatch(
  { name: "Already Named Deli" },
  extracted,
  null,
);
assert(patchSkip.name === undefined, "does not overwrite existing name");

// Live business + professional must use WithName (not Normalized-only).
const actionsSrc = readFileSync(
  join(process.cwd(), "lib/admin/paste-enrich-actions.ts"),
  "utf8",
);
assert(
  !actionsSrc.includes("Only the import queue may take a name"),
  "live cards must not skip name extraction",
);
assert(
  /const extracted = parsePasteEnrichTextWithName\(text\)/.test(actionsSrc),
  "applyPasteEnrichAction must always parse with name",
);
assert(
  actionsSrc.includes("patch.name = logical.name") ||
    actionsSrc.includes("patch.display_name = logical.name"),
  "liveDbPatch must write name / display_name",
);

const buttonSrc = readFileSync(
  join(process.cwd(), "components/admin/AdminPasteEnrichButton.tsx"),
  "utf8",
);
assert(
  buttonSrc.includes("parsePasteEnrichTextWithName(combined)"),
  "UI preview must parse with name for all kinds",
);
assert(
  !buttonSrc.includes('kind === "import_review"'),
  "UI must not gate name parse on import_review only",
);

const cherryAd = `🍒 Червона вишня Склянка вже в European Delights!
Друзі, привезли свіжу вишню!
📍 European Delights
Працюємо щодня: 10-7`;
assert(
  isPersonLikeImportName("Татьяна Морщук") === true,
  "sender name is person-like",
);
assert(
  isPersonLikeImportName("European Delights") === false,
  "European Delights is a brand, not a person",
);
assert(
  inferNameFromDescription(cherryAd) === "European Delights",
  "enrich must pull European Delights from ad copy",
);

const yelpUrl =
  "https://www.yelp.com/biz/european-delights-gourmet-foods-fountain-valley?osq=European+Delights";
const yelpExtracted = parsePasteEnrichTextWithName(yelpUrl);
assert(
  yelpExtracted.yelp ===
    "https://www.yelp.com/biz/european-delights-gourmet-foods-fountain-valley",
  "Yelp biz URL must extract to yelp, not website",
);
assert(
  yelpExtracted.website.length === 0,
  "Yelp must not be classified as website",
);
const yelpPreviewAdd = buildPasteEnrichPreview(
  { website: "https://eurodeli.us" },
  yelpExtracted,
  false,
);
assert(
  yelpPreviewAdd.find((r) => r.key === "yelp")?.action === "add",
  "Yelp adds even when website already filled",
);
assert(
  !yelpPreviewAdd.some((r) => r.key === "website"),
  "must not show website skip for a Yelp-only paste",
);
const yelpPatch = pasteEnrichFillEmptyPatch(
  { website: "https://eurodeli.us" },
  yelpExtracted,
  null,
);
assert(
  yelpPatch.yelp ===
    "https://www.yelp.com/biz/european-delights-gourmet-foods-fountain-valley",
  "fill-empty writes yelp",
);
assert(yelpPatch.website === undefined, "does not overwrite website with Yelp");

const mixed = [
  "https://www.yelp.com/biz/european-delights-gourmet-foods-fountain-valley?osq=x",
  "https://eurodeli.us",
];
assert(
  pickPrimaryWebsiteFromList(mixed) === "https://eurodeli.us",
  "shared picker skips Yelp for website",
);
assert(
  pickYelpUrlFromList(mixed) ===
    "https://www.yelp.com/biz/european-delights-gourmet-foods-fountain-valley",
  "shared picker extracts Yelp",
);

// —— County Road / multiline address + name skip + geo gate ——
const countyMultiline = `1800 County Road 42 EAST
Burnsville, MN 55337`;
const countyHits = extractUsStreetAddresses(countyMultiline);
assert(
  countyHits[0]?.addressLine?.toLowerCase().includes("county road") &&
    countyHits[0]?.city === "Burnsville" &&
    countyHits[0]?.state === "MN" &&
    countyHits[0]?.postalCode === "55337",
  `County Road multiline expected, got ${JSON.stringify(countyHits[0])}`,
);
const countyOneLine = extractUsStreetAddresses(
  "1800 County Road 42 E, Burnsville, MN 55337",
);
assert(
  countyOneLine[0]?.addressLine?.toLowerCase().includes("county road"),
  `County Road one-line expected, got ${JSON.stringify(countyOneLine[0])}`,
);
const mainNl = extractUsStreetAddresses(`123 Main Street
Burnsville, MN 55337`);
assert(
  mainNl[0]?.addressLine === "123 Main Street" &&
    mainNl[0]?.city === "Burnsville",
  `Main Street newline expected, got ${JSON.stringify(mainNl[0])}`,
);

const countyParsed = parsePasteEnrichTextWithName(countyMultiline);
assert(
  countyParsed.addressLine?.toLowerCase().includes("county road"),
  "parse finds County Road address",
);
assert(
  countyParsed.name == null,
  `address-only paste must not become name, got ${JSON.stringify(countyParsed.name)}`,
);
assert(
  extractPasteEnrichName(countyMultiline) == null,
  "extractPasteEnrichName skips street lines",
);

assert(
  pasteAddressPreviewAction({
    existingEmpty: true,
    streetsDiffer: true,
    pastedPins: true,
    cardPins: false,
  }) === "add",
  "empty card + pasted pins → add",
);
assert(
  pasteAddressPreviewAction({
    existingEmpty: true,
    streetsDiffer: false,
    pastedPins: false,
    cardPins: false,
  }) === "skip",
  "empty card + dead paste → skip",
);
assert(
  pasteAddressPreviewAction({
    existingEmpty: false,
    streetsDiffer: false,
    pastedPins: true,
    cardPins: false,
  }) === "replace",
  "card no pin + pasted pins → replace even if similar",
);
assert(
  pasteAddressPreviewAction({
    existingEmpty: false,
    streetsDiffer: true,
    pastedPins: false,
    cardPins: false,
  }) === "skip",
  "dead paste must not propose replace",
);
assert(
  pasteAddressPreviewAction({
    existingEmpty: false,
    streetsDiffer: false,
    pastedPins: true,
    cardPins: true,
  }) === "skip",
  "both pin + same street → skip",
);
assert(
  pasteAddressPreviewAction({
    existingEmpty: false,
    streetsDiffer: true,
    pastedPins: true,
    cardPins: true,
  }) === "replace",
  "both pin + different street → replace",
);

// Explicit «обновить» must write address even when street identity matches
// (card had text but no pin — geo gate offered replace).
const sameStreetExisting = {
  addressLine: "1800 County Road 42 EAST",
  city: "Burnsville",
  state: "MN",
  postalCode: "55337",
};
const sameStreetPatch = pasteEnrichFillEmptyPatch(
  sameStreetExisting,
  countyParsed,
  null,
  { applyReplaceKeys: ["address"] },
);
assert(
  typeof sameStreetPatch.addressLine === "string" &&
    String(sameStreetPatch.addressLine).toLowerCase().includes("county road"),
  `checked replace must write same-identity street for pin refresh, got ${JSON.stringify(sameStreetPatch)}`,
);
const sameStreetBlocked = pasteEnrichFillEmptyPatch(
  sameStreetExisting,
  countyParsed,
  null,
  { applyReplaceKeys: [] },
);
assert(
  sameStreetBlocked.addressLine === undefined,
  "without checkbox, same-identity street must not rewrite",
);

const geoPreview = buildPasteEnrichPreview(
  {
    addressLine: "1800 County Rd 42",
    city: "Burnsville",
    state: "MN",
    postalCode: "55337",
  },
  countyParsed,
  false,
  { pastedPins: true, cardPins: false },
);
assert(
  geoPreview.find((r) => r.key === "address")?.action === "replace",
  "geo gate: no card pin → address replace",
);
assert(
  /пина нет|найдётся/i.test(
    geoPreview.find((r) => r.key === "address")?.hint || "",
  ),
  "geo gate hint mentions pin",
);
const deadPreview = buildPasteEnrichPreview(
  { addressLine: "1 Fake St", city: "X", state: "MN" },
  countyParsed,
  false,
  { pastedPins: false, cardPins: false },
);
assert(
  deadPreview.find((r) => r.key === "address")?.action === "skip",
  "geo gate: dead paste → skip address",
);

// —— Facebook «100% recommend (24 Reviews)» ——
const fbPaste = `Bilingual (Russian-English) program, preschool, monthly thematic events, Montessori inspired, fresh daily cooked food, Kindergarten Readiness!

Page · Preschool · Child Care Service

1800 County Rd 42 E, Burnsville, MN, United States, Minnesota

(952) 297-7226

sunflowerbunrsvillemn@gmail.com

sunflowerdaycare.us

Open now

100% recommend (24 Reviews)`;
const fbRec = extractFacebookRecommendFromText(fbPaste);
assert(
  fbRec?.recommendPct === 100 && fbRec?.reviewsCount === 24,
  `FB recommend expected 100/24, got ${JSON.stringify(fbRec)}`,
);
const fbParsed = parsePasteEnrichTextWithName(fbPaste);
assert(
  fbParsed.facebookRecommendPct === 100 &&
    fbParsed.facebookReviewsCount === 24,
  `parsed FB recommend expected 100/24, got ${fbParsed.facebookRecommendPct}/${fbParsed.facebookReviewsCount}`,
);
assert(
  fbParsed.googleRating == null,
  "FB recommend must not become Google rating",
);
const fbPreview = buildPasteEnrichPreview({}, fbParsed, false);
assert(
  fbPreview.find((r) => r.key === "facebookRecommend")?.action === "add",
  "empty card → add Facebook recommend",
);
assert(
  extractFacebookRecommendFromText("4.7\n(100)\nReviews") == null,
  "Google Maps rating must not parse as Facebook recommend",
);
assert(
  extractFacebookRecommendFromText("100% рекомендуют (12 отзывов)")
    ?.recommendPct === 100 &&
    extractFacebookRecommendFromText("100% рекомендуют (12 отзывов)")
      ?.reviewsCount === 12,
  "RU Facebook recommend phrase",
);

// Bare .us hosts (Maps paste often omits https://).
assert(
  extractWebsitesFromText("temeculavalleyhomes.us").some((u) =>
    /temeculavalleyhomes\.us/i.test(u),
  ),
  "bare .us website must extract",
);
assert(
  extractWebsitesFromText("sunflowerdaycare.us\n(952) 297-7226").some((u) =>
    /sunflowerdaycare\.us/i.test(u),
  ),
  "sunflowerdaycare.us bare host",
);
const realtorMaps = parsePasteEnrichTextWithName(`George Khazanovskiy - Temecula Valley Realtor. Bilingual in Russian and Ukrainian languages.
5.0
(16)
Real estate agent

Overview
Reviews
About
Directions
Save
Nearby
Send to phone
Share

30777 Rancho California Rd, Temecula, CA 92592

Open 24 hours
temeculavalleyhomes.us
(619) 277-2766
GV4G+RG Temecula, California`);
assert(
  realtorMaps.website.some((u) => /temeculavalleyhomes\.us/i.test(u)),
  `realtor Maps paste website, got ${JSON.stringify(realtorMaps.website)}`,
);
assert(
  realtorMaps.googleRating === 5 && realtorMaps.googleReviewsCount === 16,
  `realtor Maps rating expected 5/16, got ${realtorMaps.googleRating}/${realtorMaps.googleReviewsCount}`,
);
assert(
  String(realtorMaps.phone ?? "").includes("6192772766") ||
    (Array.isArray(realtorMaps.phone) &&
      realtorMaps.phone.some((p) => String(p).includes("6192772766"))),
  `realtor phone expected, got ${JSON.stringify(realtorMaps.phone)}`,
);

// Professional paste: ratings fill-empty the same as businesses (own columns).
const proExistingEmpty = {
  googleRating: null as number | null,
  googleReviewsCount: 0,
  yelpRating: null as number | null,
  yelpReviewsCount: 0,
};
const proMapsPaste = parsePasteEnrichTextWithName(
  "4.8\n(42)\nReviews\nYelp 4.2 (11 reviews)",
);
const proPreview = buildPasteEnrichPreview(proExistingEmpty, proMapsPaste, false);
assert(
  proPreview.find((r) => r.key === "googleRating")?.action === "add" &&
    proPreview.find((r) => r.key === "yelpRating")?.action === "add",
  "professional empty card → add Google + Yelp ratings",
);
const proFilled = pasteEnrichFillEmptyPatch(
  proExistingEmpty,
  proMapsPaste,
  null,
);
assert(
  proFilled.googleRating === 4.8 &&
    proFilled.googleReviewsCount === 42 &&
    proFilled.yelpRating === 4.2 &&
    proFilled.yelpReviewsCount === 11,
  `professional fill-empty ratings expected 4.8/42 + 4.2/11, got ${JSON.stringify(proFilled)}`,
);

console.log("OK: paste-enrich name + Google Maps + Yelp + County Road + Facebook recommend contract");
