/**
 * Short synthesized pitch for professional listing cards.
 * Builds a presentation line from offer signals — does NOT quote the raw post.
 *
 * Examples:
 *   «Массаж от $50»
 *   «Помогу сбросить лишний вес»
 *   «Домашний детский сад»
 *   «Фотосъёмка беременности и newborn от $100»
 */

import { serviceTitleForDisplay } from "@/lib/professional/service-title-ru";

export type ProfessionalCardBlurbInput = {
  headline?: string | null;
  shortDescription?: string | null;
  description?: string | null;
  /** Precomputed pitch from enrichment / LLM — preferred when set. */
  cardSummary?: string | null;
  servicePreviewTitles?: string[] | null;
  categoryName?: string | null;
  categorySlug?: string | null;
  maxChars?: number;
};

type Facet = {
  /** Priority — higher wins when composing. */
  weight: number;
  /** Short Russian fragment, e.g. «маникюр», «домашний детский сад». */
  label: string;
};

const STUB_RE =
  /^(?:услуга\s*\/\s*специалист|специалист|услуга|событие|авто\s*\/\s*страхование|ремонт\s*\/\s*стройка|маркетинг|кейтеринг\s*\/\s*цветы)$/i;

/** Facet detectors: pattern in blob → synthesized label (not a quote). */
const FACETS: Array<{ re: RegExp; label: string; weight: number }> = [
  // Childcare
  {
    re: /домашн\p{L}*\s+детск\p{L}*\s+сад|свой\s+садик|learning\s*lab|детск\p{L}*\s+сад|preschool|kids\s*club/iu,
    label: "домашний детский сад",
    weight: 10,
  },
  { re: /\bняня\b|babysit|присмотр.?за.?реб/i, label: "няня", weight: 8 },
  { re: /сиделка|caregiver/i, label: "сиделка", weight: 8 },

  // Beauty
  {
    re: /маникюр|гель-?лак|russian\s*manicure|\bnails?\b/i,
    label: "маникюр",
    weight: 9,
  },
  { re: /педикюр|обработка.?стоп/i, label: "педикюр", weight: 8 },
  {
    re: /ресниц|lash|ламинир.?ресниц/i,
    label: "ресницы",
    weight: 8,
  },
  { re: /бров(и|ей|ями)|brow/i, label: "брови", weight: 7 },
  {
    re: /парикмахер|стрижк|окрашив|кератин|\bhair\b|барбер|barber/i,
    label: "парикмахер",
    weight: 8,
  },
  {
    re: /косметолог|чистка.?лиц|филлер|ботул|эстетист|skincare/i,
    label: "косметология",
    weight: 8,
  },
  { re: /шугаринг|восков|депиляц/i, label: "депиляция", weight: 7 },

  // Massage / wellness
  { re: /массаж|\bspa\b|лимфодренаж/i, label: "массаж", weight: 9 },

  // Fitness / health intent
  {
    re: /сброс\p{L}*\s+(?:лишн\p{L}*\s+)?вес|похуд|избав\p{L}*\s+от\s+вес|weight\s*loss/iu,
    label: "помогу сбросить лишний вес",
    weight: 11,
  },
  {
    re: /онлайн.?тренер|персональн\p{L}*\s+трен|фитнес.?тренер|personal\s*train/iu,
    label: "персональный тренер",
    weight: 9,
  },
  { re: /диетолог|план.?питани|нутрициол/i, label: "питание и диетология", weight: 8 },
  { re: /йог[аиуе]|\byoga\b/i, label: "йога", weight: 8 },
  { re: /пилатес|pilates/i, label: "пилатес", weight: 8 },
  { re: /уроки.?плаван|\bswimming\b/i, label: "уроки плавания", weight: 8 },

  // Photo
  {
    re: /беременн|newborn|ньюборн/i,
    label: "фотосъёмка беременности и newborn",
    weight: 11,
  },
  {
    re: /семейн\p{L}*\s+съ[её]мк|family\s*photo/iu,
    label: "семейная фотосъёмка",
    weight: 9,
  },
  { re: /фотограф|хедшот|headshot|съ[её]мк/i, label: "фотосъёмка", weight: 7 },
  { re: /видеограф|video\s*graph/i, label: "видеосъёмка", weight: 7 },

  // Education
  {
    re: /английск|инглиш|\benglish\b|англійськ/i,
    label: "уроки английского",
    weight: 9,
  },
  { re: /испанск/i, label: "уроки испанского", weight: 8 },
  { re: /француз/i, label: "уроки французского", weight: 8 },
  { re: /репетитор|преподаватель|\btutor\b/i, label: "репетитор", weight: 7 },
  { re: /уроки.?гитар|занятия.?по.?гитар/i, label: "уроки гитары", weight: 8 },
  {
    re: /уроки.?барабан|занятия.?по.?барабан/i,
    label: "уроки барабанов",
    weight: 8,
  },
  {
    re: /школа.?программирован|python|coding\s*school/i,
    label: "обучение программированию",
    weight: 8,
  },
  { re: /автоинструктор|вожден|\bdmv\b/i, label: "автоинструктор", weight: 8 },

  // Home / food
  {
    re: /чистк\p{L}*.{0,12}(диван|матрас|ковр)|уборк|клининг|\bcleaning\b/iu,
    label: "уборка",
    weight: 8,
  },
  { re: /сантехник/i, label: "сантехник", weight: 8 },
  { re: /электрик/i, label: "электрик", weight: 8 },
  { re: /хендимен|handyman|мелкий.?ремонт/i, label: "мастер на час", weight: 8 },
  { re: /\bmoving\b|переезд|грузчик/i, label: "переезды", weight: 8 },
  {
    re: /торт|выпечк|кондитер|кулич|пасочк|медовик|пеку|\bbake\b/i,
    label: "домашняя выпечка",
    weight: 8,
  },
  { re: /пельмен|домашн\w*\s+еда|кейтеринг/i, label: "домашняя еда", weight: 7 },

  // Auto / travel / legal / finance
  {
    re: /аренд\p{L}*.{0,20}(авто|машин|toyota|tesla|camry|prius)|toyota.{0,40}аренд|prius.{0,40}аренд/iu,
    label: "аренда авто",
    weight: 10,
  },
  {
    re: /детейлинг|detailing|полировк/iu,
    label: "детейлинг авто",
    weight: 8,
  },
  {
    re: /диагностик\p{L}*.{0,8}авто|выездн\p{L}*\s+диагностик/iu,
    label: "диагностика авто",
    weight: 8,
  },
  {
    re: /cdl|non-domiciled|dot\s*medical/i,
    label: "продление CDL и DOT",
    weight: 10,
  },
  {
    re: /частн\p{L}*\s+трансфер|премиум.?такси|private.?driver/iu,
    label: "частный трансфер",
    weight: 9,
  },
  {
    re: /green.?card|грин.?карт|иммиграц|\blawyer\b|юрист|адвокат/i,
    label: "юридические услуги",
    weight: 8,
  },
  {
    re: /бухгалтер|\bcpa\b|налог|tax\s*prepar/i,
    label: "бухгалтерия и налоги",
    weight: 8,
  },
  {
    re: /страхов|insurance\s*(broker|agent)/i,
    label: "страхование",
    weight: 8,
  },
  {
    re: /риелтор|риэлтор|real.?estate|\brealtor\b|сдам.?комнат/i,
    label: "недвижимость",
    weight: 7,
  },

  // Promo / retail (still a “offer” on the card)
  {
    re: /винн|вино|last\s*bottle|wine/iu,
    label: "вино со скидкой",
    weight: 9,
  },
  {
    re: /скидк\p{L}*\s+до\s*\d{1,2}\s*%|\d{1,2}\s*[–\-—-]\s*\d{1,2}\s*%|до\s*\d{1,2}\s*%/iu,
    label: "акция со скидкой",
    weight: 5,
  },

  // Digital / creative
  {
    re: /создан\p{L}*\s+сайт|web.?design|\bseo\b|сайт(ов)?/iu,
    label: "сайты и SEO",
    weight: 8,
  },
  { re: /таргет|маркетинг|\bsmm\b/iu, label: "маркетинг", weight: 7 },
];

const CATEGORY_PITCH: Record<string, string> = {
  beauty: "услуги красоты",
  massage_wellness: "массаж и wellness",
  health: "здоровье",
  fitness: "фитнес и тренировки",
  education: "обучение",
  childcare: "уход за детьми",
  photo_video: "фото и видео",
  home_services: "дом и ремонт",
  home_food: "домашняя еда",
  creative: "дизайн и handmade",
  digital: "IT и сайты",
  legal: "юридические услуги",
  finance: "финансы и бухгалтерия",
  insurance: "страхование",
  real_estate: "недвижимость",
  auto: "автоуслуги",
  pets: "услуги для животных",
  events: "организация праздников",
  celebrations: "организация праздников",
  travel: "путешествия и трансферы",
};

function blobOf(input: ProfessionalCardBlurbInput): string {
  return [
    input.headline,
    input.shortDescription,
    input.description,
    ...(input.servicePreviewTitles ?? []),
  ]
    .filter(Boolean)
    .join("\n");
}

/** Max discount percent if the post advertises one. */
function extractMaxDiscountPercent(text: string): number | null {
  const nums: number[] = [];
  for (const m of text.matchAll(/(\d{1,2})\s*%/g)) {
    const n = Number(m[1]);
    if (n >= 5 && n <= 90) nums.push(n);
  }
  if (nums.length === 0) return null;
  return Math.max(...nums);
}
function extractMinPriceUsd(text: string): number | null {
  const prices: number[] = [];
  // $50, $ 50, от $50, 50$, 50 $
  for (const m of text.matchAll(
    /(?:от\s*)?\$\s*(\d{1,4})(?:\.\d{1,2})?|(\d{1,4})\s*\$/gi,
  )) {
    const n = Number(m[1] || m[2]);
    if (n >= 5 && n <= 5000) prices.push(n);
  }
  // «по цене 100$» / emoji-dollar already normalized upstream sometimes
  for (const m of text.matchAll(/по\s+цене\s+(\d{1,4})/gi)) {
    const n = Number(m[1]);
    if (n >= 5 && n <= 5000) prices.push(n);
  }
  if (prices.length === 0) return null;
  return Math.min(...prices);
}

function detectFacets(text: string): Facet[] {
  const found: Facet[] = [];
  const seen = new Set<string>();
  for (const f of FACETS) {
    if (!f.re.test(text)) continue;
    if (seen.has(f.label)) continue;
    seen.add(f.label);
    found.push({ label: f.label, weight: f.weight });
  }
  // Drop generic labels covered by a more specific one
  const labels = found.map((f) => f.label);
  const filtered = found.filter((f) => {
    if (f.label === "фотосъёмка") {
      return !labels.some((l) => l !== f.label && l.includes("фото"));
    }
    if (f.label === "репетитор") {
      return !labels.some((l) => l.startsWith("уроки "));
    }
    if (f.label === "страхование") {
      return !labels.some((l) => l.includes("аренда"));
    }
    if (f.label === "няня") {
      return !labels.some((l) => l.includes("сад"));
    }
  if (f.label === "акция со скидкой") {
      return !labels.some(
        (l) => l.includes("скидк") || l.includes("вино") || l.includes("акция"),
      );
    }
    return true;
  });
  return filtered.sort((a, b) => b.weight - a.weight);
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function joinLabels(labels: string[], maxChars: number): string {
  const parts: string[] = [];
  for (const label of labels) {
    const next = parts.length === 0 ? label : `${parts.join(" · ")} · ${label}`;
    if (next.length > maxChars) break;
    parts.push(label);
  }
  return parts.join(" · ");
}

/**
 * Synthesize a 1–2 line card pitch from the specialist’s offer signals.
 */
export function professionalCardBlurb(
  input: ProfessionalCardBlurbInput,
): string | null {
  const maxChars = input.maxChars ?? 120;

  // Prefer stored summary (LLM / batch enrich) — already a pitch, not a quote
  const stored = (input.cardSummary ?? "").trim();
  if (stored.length >= 8 && !STUB_RE.test(stored)) {
    if (stored.length <= maxChars) return stored;
    return stored.slice(0, maxChars - 1).trimEnd() + "…";
  }

  const blob = blobOf(input);
  const facets = detectFacets(blob);
  const price = extractMinPriceUsd(blob);

  // Prefer 1–2 strongest facets
  const top = facets.slice(0, 2).map((f) => f.label);

  // Headline may already be a clean profession word («массаж», «няня»)
  const head = (input.headline ?? "").trim();
  if (
    head &&
    !STUB_RE.test(head) &&
    head.length <= 28 &&
    /^[а-яёa-z][а-яёa-z\s/·-]{2,27}$/i.test(head) &&
    !top.some((t) => t.includes(head.toLowerCase()) || head.toLowerCase().includes(t))
  ) {
    // Use as facet if nothing stronger, or prefix when complementary
    if (top.length === 0) top.push(head.toLowerCase());
  }

  if (top.length > 0) {
    // Refine wine + discount into one line
    const discount = extractMaxDiscountPercent(blob);
    if (top[0]?.includes("вино") && discount != null) {
      return capitalize(`вино со скидкой до ${discount}%`);
    }
    if (top[0] === "акция со скидкой" && discount != null) {
      return capitalize(`скидки до ${discount}%`);
    }

    let pitch = joinLabels(top, price != null ? maxChars - 12 : maxChars);
    const priceFriendly =
      /массаж|маникюр|педикюр|фото|видео|уборк|няня|уроки|аренда|детейлинг|диагностик|ресниц|бров|стрижк|садик|сад/i.test(
        pitch,
      );
    if (price != null && priceFriendly && !pitch.includes("$")) {
      const withPrice = `${pitch} от $${price}`;
      if (withPrice.length <= maxChars) pitch = withPrice;
    }
    return capitalize(pitch);
  }

  // Service titles that look like real offerings
  const titles = (input.servicePreviewTitles ?? [])
    .map((t) => serviceTitleForDisplay(t).title.trim())
    .filter((t) => t.length >= 3 && t.length <= 48 && !STUB_RE.test(t));
  if (titles.length > 0) {
    let pitch = joinLabels(
      titles.slice(0, 2).map((t) => t.toLowerCase()),
      maxChars,
    );
    if (price != null && !pitch.includes("$")) {
      const withPrice = `${pitch} от $${price}`;
      if (withPrice.length <= maxChars) pitch = withPrice;
    }
    return capitalize(pitch);
  }

  const slug = input.categorySlug ?? "";
  if (slug && slug !== "pro_other" && CATEGORY_PITCH[slug]) {
    let pitch = CATEGORY_PITCH[slug];
    if (price != null) {
      const withPrice = `${pitch} от $${price}`;
      if (withPrice.length <= maxChars) pitch = withPrice;
    }
    return capitalize(pitch);
  }

  const cat = (input.categoryName ?? "").trim();
  if (cat && !/^прочее$/i.test(cat)) return cat;

  return null;
}
