/**
 * Ad intent classifier + offers gate signals.
 * Run: npx tsx lib/admin/ad-block-classifier.test.ts
 */
import {
  classifyAdIntent,
  eventBlocksFromText,
  isEventAdText,
  isVacancyAdText,
  serviceEligibleAdBlocks,
} from "./ad-block-classifier";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const vacancy = `Требуется мастер маникюра в салон.
Опыт от 1 года. Пишите в личку.`;
assert(isVacancyAdText(vacancy), "vacancy detected");
assert(classifyAdIntent(vacancy) === "vacancy", "intent vacancy");

const party = `Друзья! Не пропустите самую жаркую вечеринку этой зимы! 7го Февраля в 237 Ocean Ave, Laguna Beach! Будем играть только самые любимые наши хиты! Здесь будут все!`;
assert(isEventAdText(party), "party with date is event");
assert(classifyAdIntent(party) === "event", "intent event");
assert(eventBlocksFromText(party).length === 1, "event block extracted");

const opening = `Уже в это воскресенье, 26 июля в 12:00 PM, состоится официальное открытие Vasilki Café Bakery в Laguna Niguel!`;
assert(isEventAdText(opening), "grand opening with date is event");
assert(classifyAdIntent(opening) === "event", "intent opening event");
assert(
  serviceEligibleAdBlocks([opening]).length === 0,
  "opening excluded from services",
);

const flowerService = `Букеты на заказ
Розы — $80
Тюльпаны — от $45`;
assert(classifyAdIntent(flowerService) === "service", "price list is service");
assert(!isEventAdText(flowerService), "flower price list is not an event");
assert(!isVacancyAdText(flowerService), "flower price list is not a vacancy");

const promo = `АКЦИЯ! Скидка 20% на все букеты до конца недели.`;
assert(classifyAdIntent(promo) === "promotion", "promo intent");

const mixed = `${party}

${flowerService}`;
const blocks = eventBlocksFromText(mixed);
assert(blocks.length >= 1, "mixed: event block found");
assert(
  blocks.every((b) => isEventAdText(b)),
  "mixed: only event paragraphs in eventBlocks",
);
assert(
  !isEventAdText(flowerService),
  "service paragraph alone is not event — offersFromAdTexts keeps it",
);

assert(
  serviceEligibleAdBlocks([vacancy]).length === 0,
  "vacancy blocks excluded from services",
);
assert(
  serviceEligibleAdBlocks([party]).length === 0,
  "event blocks excluded from services",
);
assert(
  serviceEligibleAdBlocks([flowerService]).length >= 1,
  "service blocks eligible",
);
assert(
  serviceEligibleAdBlocks([mixed]).some((b) => /роз|тюльпан|\$80/i.test(b)),
  "mixed: service paragraph stays eligible",
);
assert(
  !serviceEligibleAdBlocks([mixed]).some((b) => /вечеринк/i.test(b)),
  "mixed: party paragraph not eligible for services",
);

console.log("OK: ad-block-classifier vacancy/event/service/promo");
