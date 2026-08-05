/**
 * Person-title → brand-from-copy (Telegram sender vs store name).
 * Run: npx tsx lib/import-review/display-name-contract.test.ts
 * CI: .github/workflows/ci.yml
 */
import {
  inferNameFromDescription,
  isJunkImportTitle,
  isPersonLikeImportName,
  repeatedBrandFromText,
} from "./display-name";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(isPersonLikeImportName("Татьяна Морщук"), "sender is person-like");
assert(
  !isPersonLikeImportName("European Delights"),
  "European Delights must not look like a person",
);
assert(
  !isPersonLikeImportName("MoonHalal Cafe"),
  "Cafe token is brand, not person",
);

const cherryAd = `🍒 Червона вишня Склянка вже в European Delights!
Друзі, привезли свіжу, солодку вишню!
📍 European Delights
Працюємо щодня: 10-7
Не відкладайте — сезон короткий!`;

assert(
  repeatedBrandFromText(cherryAd) === "European Delights",
  "repeated brand from pin + «в …»",
);
assert(
  inferNameFromDescription(cherryAd) === "European Delights",
  "inferNameFromDescription must return European Delights",
);

const googleLine = `European Delights - Gourmet Foods
4.7
(100)
Gourmet grocery store
10613 Lawson River Ave, Fountain Valley, CA 92708`;
assert(
  inferNameFromDescription(googleLine)?.includes("European") ||
    inferNameFromDescription(googleLine) === "European Delights",
  "Google-style paste still yields European Delights family",
);

const flowerAd = `День св. Валентина уже через 3 дня! Заказывайте цветы только у самых лучших L'amour Toujours Flower Boutique`;
assert(
  inferNameFromDescription(flowerAd) === "L'amour Toujours Flower Boutique",
  "Flower Boutique brand from Valentine ad",
);

assert(isJunkImportTitle("src="), "HTML src= crumb is junk title");
assert(
  isJunkImportTitle("data:image/png;base64,iVBORw0KGgo"),
  "data URI is junk title",
);
assert(
  !isPersonLikeImportName("Avagyan Law"),
  "Law firm name must not look like a person",
);
assert(
  !isPersonLikeImportName("Avagyan Law Firm"),
  "Law Firm brand must not look like a person",
);
const junkShort = `display" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAY`;
assert(
  inferNameFromDescription(junkShort) == null,
  `HTML dump must not become a name, got ${JSON.stringify(inferNameFromDescription(junkShort))}`,
);
assert(
  inferNameFromDescription(
    "Авагян Юридическая фирма предоставляет профессиональные юридические услуги в Калифорнии.",
  )?.includes("Авагян") ||
    inferNameFromDescription(
      "Avagyan Law Firm provides immigration and injury legal services in California.",
    ) === "Avagyan Law Firm",
  "Avagyan firm bio must infer a brand",
);

console.log("OK: display-name person→brand contract");
