/**
 * Person-title shop card → brand + wrong-section on enrich.
 * Run: npx tsx lib/admin/enrich-identity-correction.test.ts
 */
import { correctEnrichCardIdentity } from "./enrich-identity-correction";
import { inferNameFromDescription } from "@/lib/import-review/display-name";
import { routeCard } from "@/lib/import-review/entity-routing";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const flowerAd = `День св. Валентина уже через 3 дня! Заказывайте цветы только у самых лучших L'amour Toujours Flower Boutique

Источник:, дата: 2026-02-11T20:42:55+00:00

Telegram — в блоке «Контакты»`;

assert(
  inferNameFromDescription(flowerAd) === "L'amour Toujours Flower Boutique",
  `brand infer got ${JSON.stringify(inferNameFromDescription(flowerAd))}`,
);

const route = routeCard({
  text: flowerAd,
  personName: "Maksim Degtyar",
  businessName: null,
  hasContact: true,
});
assert(
  /retail_storefront_re/.test(route.reason),
  `expected retail storefront route, got ${route.reason}`,
);

const fixed = correctEnrichCardIdentity({
  kind: "professional",
  currentName: "Maksim Degtyar",
  headline: "услуга / специалист",
  description: flowerAd,
  routeText: flowerAd,
  phone: "+19493516824",
  email: "lamourtoujoursflowers@gmail.com",
  website: "https://www.lamourtoujoursflowers.com",
  instagramUrl: "https://www.instagram.com/lamour_toujours_flowers",
  addressLine: null,
});

assert(
  fixed.displayName === "L'amour Toujours Flower Boutique",
  `rename got ${JSON.stringify(fixed.displayName)}`,
);
assert(
  fixed.sectionMismatch === "businesses",
  `section mismatch got ${JSON.stringify(fixed.sectionMismatch)} reasons=${fixed.reasons.join(",")}`,
);
assert(
  fixed.reasons.includes("person_title→brand"),
  `reasons ${fixed.reasons.join(",")}`,
);

const fixedBiz = correctEnrichCardIdentity({
  kind: "business",
  currentName: "Maksim Degtyar",
  description: flowerAd,
  routeText: flowerAd,
  phone: "+19493516824",
  website: "https://www.lamourtoujoursflowers.com",
});
assert(
  fixedBiz.displayName === "L'amour Toujours Flower Boutique",
  "business person→brand name",
);
assert(
  fixedBiz.suggestedSlug === "lamour-toujours-flower-boutique",
  `suggestedSlug got ${fixedBiz.suggestedSlug}`,
);

// Ordinary specialist must not be pushed to businesses.
const pro = correctEnrichCardIdentity({
  kind: "professional",
  currentName: "Анна Петрова",
  headline: "репетитор английского",
  description: "Репетитор английского языка. Готовлю к экзаменам.",
  routeText: "Репетитор английского языка. Готовлю к экзаменам.",
  phone: "+19495551212",
  email: "anna@gmail.com",
  website: null,
  instagramUrl: null,
});
assert(!pro.displayName, "tutor keeps person name");
assert(!pro.sectionMismatch, "tutor stays specialist");

// HTML crumb must never replace a firm name; junk title may become firm brand.
const keepFirm = correctEnrichCardIdentity({
  kind: "business",
  currentName: "Avagyan Law",
  description:
    'Авагян Юридическая фирма предоставляет услуги. display" src="data:image/png;base64,AAA"',
  routeText:
    'Avagyan Law — иммиграционные адвокаты. display" src="data:image/png;base64,AAA"',
});
assert(
  !keepFirm.displayName,
  `Avagyan Law must stay, got ${JSON.stringify(keepFirm.displayName)}`,
);

const fixJunk = correctEnrichCardIdentity({
  kind: "business",
  currentName: "src=",
  description:
    "Avagyan Law Firm provides immigration and injury legal services in California.",
  routeText:
    "Avagyan Law Firm provides immigration and injury legal services in California.",
});
assert(
  fixJunk.displayName === "Avagyan Law Firm",
  `junk src= → firm, got ${JSON.stringify(fixJunk.displayName)}`,
);

console.log("OK: enrich-identity-correction flower boutique");
