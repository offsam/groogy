/**
 * Move approved businesses with empty / junk / non-offer copy → status=pending (admin review).
 * Keep if there is any real service/offer text.
 *
 * Usage:
 *   node scripts/business-enrich/move_empty_to_pending.mjs
 *   node scripts/business-enrich/move_empty_to_pending.mjs --apply
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const apply = process.argv.includes("--apply");

const env = Object.fromEntries(
  readFileSync(resolve(root, ".env.local"), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")];
    }),
);

const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/** Text that looks like they provide a service / product / business. */
const SERVICE_RE =
  /предлагаю|оказываю|услуги|услуга|запись|записывайтесь|принимаю|принимаем|делаю|делаем|работаю|работаем|мастер|специалист|маникюр|педикюр|брови|ресниц|парикмахер|стрижк|окрашив|визаж|макияж|косметолог|массаж|психолог|репетитор|няня|сиделка|тренер|йога|pilates|фотограф|съ[её]мк|репортаж|headshot|клининг|уборк|сантехник|электрик|ремонт|хендимен|handyman|риелтор|риэлтор|realtor|юрист|адвокат|бухгалтер|налог|страхов|переводчик|нотариус|иммиграц|салон|студия|кафе|ресторан|магазин|клиника|школа|academy|salon|studio|clinic|restaurant|\bcafe\b|\bllc\b|\binc\b|\bcorp\b|tutor|nanny|massage|\bnail\b|\blash\b|\bhair\b|cleaning|repair|attorney|lawyer|accountant|insurance|coach|therapy|аренда квартир|сдам|сдаю|leasing|broker|credit|лицензи|\$\d+|прайс|price|\/hr|за сеанс|открыт|доставка|BBQ|пекарн|пеку|выпечк|пасх|кулич|паск|химчист|детейл|detail|стоматолог|врач|доктор|детск|эвакуатор|towing|bakery|daycare|нотариаль|апостиль|uscis|\bvisa\b|\bdmv\b|cdl|bookkeep|автосервис|автомойк|шиномонтаж|барбер|barber|tattoo|тату|пирсинг|флорист|florist|кондитер|\bcake\b|торты|свадьб|wedding|\bevent\b|мероприят|логистик|переезд|moving|грузоперевоз|такси|\btaxi\b|доставк|курсы|курс[иы]|обучен|lesson|\bclass\b|сертификат|certified|licensed|аниматор|ученик|заняти|урок|экскурси|хинкали|хачапур|натуральн\w*\s+м[её]д|пчелин\w*\s+м[её]д|\bм[её]д\b|барабан|ключ(и|ей)? для машин|car audio|шумоизол|индивидуальн|набор ученик|набираем студент|веду набор|приглашаю на|разговорн\w*\s+програм|английск|англійськ|скинуть \d|скинути|схуднен|похуден|нутрициол|коуч|коучинг|пол(ы|ам)|плитк|маляр|покраск|landscape|ландшафт|garden|садов|цветы|букет|pizza|пицц|суши|роллы|шаурм|grill|стейк|winery|винодельн|\bspa\b|сауна|баня|фитнес|\bgym\b|кроссфит|stretch|лазер|эпиляц|перманент|татуаж|piercing|автозвук|custom automotive|interior design|\bcamp\b|лагерь|elementary|middle school|preschool|детсад|ясли|обработк\w*\s+стоп|ванночк|крем маска|бетонн|ирригац|дренаж|брусчатк|подпорн|заборы|благоустройств|pet boarding|boarding|передержк|аукцион|манхейм|автомобили с аукцион|создание сайт|сайт\w*\+?ии|научу играть|без зубрежки|козье молоко|куриные яйца|свежие огурц|kenworth|трейлер|финансирован|от\s*\d+\s*\$?\s*\/?\s*месяц|все включено|преподаватель|фортепиано|обучать|консультац|с человека в день|рыбалк|тур:/i;

/** Strong non-offers — always move even if a keyword accidentally matches. */
const STRONG_NOT_OFFER_RE =
  /ищем жиль[её]|ищут дом|ищу дом|возьму в аренду|на подселение|отдам кот|ищут добрых|продам\s+(новые\s+)?iphone|мошенник|не делайте через|рекомендую отличного|мы были в|сюда ходим|сыну нравится|archived duplicate|permanently closed|нужен хэлпер|helper position|\bhiring\b|ищут гибрид|ищем дом в рент|друзьям? пополнение|спасибо за кулич|все были в восторге|мое?му сыну здесь|наблюдается уже|ни разу не лечили|постоянно попадаются|не знаю,? где они|ищут небольшой дом|ищут комнату|две девушки ищут/i;

function cleanCopy(b) {
  let s = [b.short_description, b.description].filter(Boolean).join("\n");
  s = s
    .replace(/---FACEBOOK_SOURCE---[\s\S]*/gi, " ")
    .replace(/Источник:\s*Telegram[^\n]*/gi, " ")
    .replace(/Контакты:\s*[^\n]*/gi, " ")
    .replace(/Telegram ID:\s*\d+/gi, " ")
    .replace(/дата:\s*\S+/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/www\.\S+/gi, " ")
    .replace(/instagram\.com\/\S+/gi, " ")
    .replace(/t\.me\/\S+/gi, " ")
    .replace(/@[\w.]+/g, " ")
    .replace(/#[\wа-яё]+/gi, " ")
    .replace(/\b\d{3}[-.\s()]?\d{3}[-.\s]?\d{4}\b/g, " ")
    .replace(/\b\+?1?\s*\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, " ")
    .replace(/\b\d{10,}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s;
}

function letterCount(t) {
  return t.replace(/[^\p{L}\p{N}]/gu, "").length;
}

function shouldMoveToReview(b) {
  const name = (b.name || "").trim();
  const raw = [b.short_description, b.description].filter(Boolean).join("\n").trim();
  const text = cleanCopy(b);
  const letters = letterCount(text);
  const blob = `${name}\n${text}`;

  // Closed / archived / want-ads / reviews of others — always review
  if (STRONG_NOT_OFFER_RE.test(blob) || /permanently closed|archived duplicate/i.test(raw)) {
    return { move: true, reason: "not_a_service_offer" };
  }

  // Truly empty after cleaning — even if name has "salon"
  if (!raw || raw.length < 8 || letters < 12) {
    if (/https?:\/\/|instagram\.com|t\.me\/|@\w+/i.test(raw) && letters < 20) {
      return { move: true, reason: "only_links_or_handles" };
    }
    return { move: true, reason: "empty_or_tiny_copy" };
  }

  if (SERVICE_RE.test(blob)) {
    return { move: false, reason: "has_service_signal" };
  }

  // Readable chatter but no service signal → admin review
  if (letters < 40) {
    return { move: true, reason: "too_thin_no_service" };
  }

  return { move: true, reason: "no_service_signal" };
}

const { data: biz, error: loadErr } = await c
  .from("businesses")
  .select("id,name,slug,short_description,description,status")
  .eq("status", "approved");

if (loadErr) {
  console.error(loadErr);
  process.exit(1);
}

const move = [];
const keep = [];
for (const b of biz || []) {
  const r = shouldMoveToReview(b);
  const item = {
    id: b.id,
    name: b.name,
    slug: b.slug,
    reason: r.reason,
    preview: cleanCopy(b).slice(0, 140) || "(empty)",
  };
  if (r.move) move.push(item);
  else keep.push(item);
}

const byReason = {};
for (const m of move) byReason[m.reason] = (byReason[m.reason] || 0) + 1;

console.log(
  JSON.stringify(
    {
      approved: biz?.length,
      move: move.length,
      keep: keep.length,
      byReason,
      mode: apply ? "APPLY" : "DRY_RUN",
    },
    null,
    2,
  ),
);

console.log("\nMOVE sample:");
for (const x of move.slice(0, 40)) {
  console.log(`• [${x.reason}] ${x.name} | ${x.preview}`);
}
console.log("\nKEEP sample:");
for (const x of keep.slice(0, 25)) {
  console.log(`• [${x.reason}] ${x.name}`);
}

mkdirSync(resolve(__dirname, "data/move_plan"), { recursive: true });
const outPath = resolve(__dirname, "data/move_plan/pending_empty_latest.json");
writeFileSync(
  outPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      applied: apply,
      counts: { move: move.length, keep: keep.length, byReason },
      move,
      keep,
    },
    null,
    2,
  ),
);
console.log("\nwrote", outPath);

if (!apply) {
  console.log("\nDry-run only. Re-run with --apply to set status=pending.");
  process.exit(0);
}

let ok = 0;
let err = 0;
const batchId = `pending_empty_${new Date().toISOString().replace(/[:.]/g, "-")}`;
for (let i = 0; i < move.length; i += 50) {
  const chunk = move.slice(i, i + 50);
  const ids = chunk.map((x) => x.id);
  const { error } = await c.from("businesses").update({ status: "pending" }).in("id", ids);
  if (error) {
    console.error("chunk error", error.message);
    err += chunk.length;
  } else {
    ok += chunk.length;
  }
}

writeFileSync(
  resolve(__dirname, `data/move_plan/${batchId}.json`),
  JSON.stringify({ batchId, appliedAt: new Date().toISOString(), ids: move.map((m) => m.id), move }, null, 2),
);

const { count: approved } = await c
  .from("businesses")
  .select("id", { count: "exact", head: true })
  .eq("status", "approved");
const { count: pending } = await c
  .from("businesses")
  .select("id", { count: "exact", head: true })
  .eq("status", "pending");

console.log({ batchId, applied_pending: ok, errors: err, approved_now: approved, pending_now: pending });
