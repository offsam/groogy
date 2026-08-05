/**
 * Menu parser contract — Vasilki-style sections + prices.
 * Run: npx tsx lib/business-offers/parse-menu-text.test.ts
 */
import {
  looksLikeMenuDocument,
  looksLikeMenuSection,
  parseMenuFromText,
} from "./parse-menu-text";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(looksLikeMenuSection("BREAKFAST"), "BREAKFAST is section");
assert(looksLikeMenuSection("SALADS"), "SALADS is section");
assert(looksLikeMenuSection("COFFEE HOT/ICED"), "COFFEE is section");
assert(
  looksLikeMenuSection("TRADITIONAL HOMEMADE FAVORITES"),
  "TRADITIONAL is section",
);
assert(!looksLikeMenuSection("Oatmeal with Fresh Fruit $11.99"), "priced line not section");

const breakfast = `BREAKFAST
Oatmeal with Fresh Fruit $11.99
Breakfast Sandwich $12.99
Two-Egg Breakfast - Served with toast $11.99

TRADITIONAL HOMEMADE FAVORITES
Borscht
Traditional beet soup with beef & pork
$16.79
Stuffed Cabbage Rolls
Choice of beef or chicken
$16.79
Blini (Crepes)
Choice of farmer's cheese, chicken, or beef
$16.79
Syrniki
Traditional farmer's cheese pancakes, served with sour cream and jam
$16.29
Draniki
Crispy potato pancakes
$16.89`;

const b = parseMenuFromText(breakfast);
assert(b.length >= 7, `expected >=7 breakfast/traditional items, got ${b.length}`);
assert(
  b.some((i) => /oatmeal/i.test(i.title) && i.priceAmount === 11.99),
  "oatmeal 11.99",
);
assert(
  b.some(
    (i) =>
      /borscht/i.test(i.title) &&
      i.priceAmount === 16.79 &&
      /beet/i.test(i.description || ""),
  ),
  "borscht with description",
);
assert(
  b.filter((i) => /breakfast/i.test(i.section || "")).length >= 2,
  "breakfast section assigned",
);
assert(
  b.some((i) => /traditional|homemade|favorites/i.test(i.section || "")),
  "traditional section assigned",
);

const salads = `SALADS
Olivier: Traditional potato salad with eggs, pickles, peas, and mayo $15.99
Shuba: Traditional layered beet salad with herring $16.99
Vinaigrette: Traditional beet salad with vegetables and pickles $13.89

COFFEE HOT/ICED
Espresso $3.50
Americano $4.00
Latte $5.50
Flat White $5.25

DRINKS
Kvass $2.59
Kompot $2.59
Mors $2.59`;

const s = parseMenuFromText(salads);
assert(s.some((i) => /olivier/i.test(i.title) && i.priceAmount === 15.99), "olivier");
assert(s.some((i) => /espresso/i.test(i.title) && i.priceAmount === 3.5), "espresso");
assert(s.filter((i) => /drink/i.test(i.section || "")).length >= 2, "drinks section");
assert(looksLikeMenuDocument(breakfast), "breakfast blob is menu doc");
assert(looksLikeMenuDocument(salads), "salads blob is menu doc");
assert(!looksLikeMenuDocument("Маникюр — $50\nПедикюр — $60"), "salon prices not menu");

// RU Google Maps dump must NEVER become a food menu (Адрес / Телефон as dishes).
const lazyMaps = `Lazy Tigers Truck Center
4.5
(258)
·
258 отзывов Google
Автосервис
Адрес
411 Whitehead Ave #6, South River, NJ 08882
Телефон
(929) 549-8206
Часы работы
Понедельник 8:00–18:00
Вторник 8:00–18:00
Подтверждено этим бизнесом 3 недели назад
Предложить новые часы работы
Услуги
Развал-схождение, Кузовные работы`;
assert(
  !looksLikeMenuDocument(lazyMaps),
  "Maps chrome must not look like a menu document",
);
assert(
  !looksLikeMenuSection("Lazy Tigers Truck Center"),
  "brand Title Case is not a menu section",
);
const mapsItems = parseMenuFromText(lazyMaps);
assert(
  !mapsItems.some((i) => /^(адрес|телефон|часы)/i.test(i.title)),
  `Maps field labels must not become dishes, got ${JSON.stringify(mapsItems.map((i) => i.title))}`,
);

console.log("OK: parse-menu-text Vasilki fixtures");
