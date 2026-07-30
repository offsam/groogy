import { hasCyrillic } from "@/lib/business/card-blurb";

/**
 * Show Russian for English professional service titles.
 * Phrase dictionary first, then synonym-token fallback.
 */

const PHRASES: Array<[string, string]> = [
  ["russian manicure", "русский маникюр"],
  ["gel manicure", "гель-маникюр"],
  ["nail extension", "наращивание ногтей"],
  ["nail extensions", "наращивание ногтей"],
  ["eyelash extension", "наращивание ресниц"],
  ["eyelash extensions", "наращивание ресниц"],
  ["brow lamination", "ламинирование бровей"],
  ["lash lift", "ламинирование ресниц"],
  ["deep tissue massage", "глубокий массаж"],
  ["swedish massage", "шведский массаж"],
  ["sports massage", "спортивный массаж"],
  ["prenatal massage", "массаж для беременных"],
  ["hot stone massage", "массаж горячими камнями"],
  ["facial massage", "массаж лица"],
  ["hair coloring", "окрашивание волос"],
  ["hair colouring", "окрашивание волос"],
  ["hair cut", "стрижка"],
  ["haircut", "стрижка"],
  ["balayage", "балаяж"],
  ["highlights", "мелирование"],
  ["keratine", "кератин"],
  ["keratin treatment", "кератиновое выпрямление"],
  ["teeth whitening", "отбеливание зубов"],
  ["dental cleaning", "чистка зубов"],
  ["root canal", "лечение каналов"],
  ["personal training", "персональные тренировки"],
  ["personal trainer", "персональный тренер"],
  ["physical therapy", "физиотерапия"],
  ["chiropractic", "хиропрактика"],
  ["tax preparation", "подготовка налогов"],
  ["tax filing", "подача налоговой декларации"],
  ["bookkeeping", "бухгалтерия"],
  ["accounting", "бухгалтерия"],
  ["immigration lawyer", "иммиграционный адвокат"],
  ["family law", "семейное право"],
  ["real estate agent", "риелтор"],
  ["home cleaning", "уборка дома"],
  ["house cleaning", "уборка дома"],
  ["deep cleaning", "генеральная уборка"],
  ["move out cleaning", "уборка после переезда"],
  ["moving help", "помощь с переездом"],
  ["handyman services", "услуги мастера"],
  ["handyman", "мастер на час"],
  ["plumbing", "сантехника"],
  ["electrician", "электрик"],
  ["electrical", "электрика"],
  ["hvac", "отопление и кондиционеры"],
  ["air conditioning", "кондиционеры"],
  ["car detailing", "детейлинг авто"],
  ["auto repair", "авторемонт"],
  ["oil change", "замена масла"],
  ["tire change", "шиномонтаж"],
  ["pet grooming", "груминг"],
  ["dog walking", "выгул собак"],
  ["babysitting", "няня"],
  ["childcare", "уход за детьми"],
  ["tutoring", "репетиторство"],
  ["private lessons", "частные уроки"],
  ["photo session", "фотосессия"],
  ["photoshoot", "фотосессия"],
  ["video editing", "монтаж видео"],
  ["web design", "веб-дизайн"],
  ["web development", "разработка сайтов"],
  ["graphic design", "графический дизайн"],
  ["social media", "соцсети"],
  ["makeup", "макияж"],
  ["make up", "макияж"],
  ["manicure", "маникюр"],
  ["pedicure", "педикюр"],
  ["massage", "массаж"],
  ["facial", "чистка лица"],
  ["consultation", "консультация"],
  ["consulting", "консультация"],
  ["therapy", "терапия"],
  ["counseling", "консультация психолога"],
  ["counselling", "консультация психолога"],
  ["cleaning", "уборка"],
  ["nanny", "няня"],
  ["tutor", "репетитор"],
  ["lawyer", "юрист"],
  ["attorney", "адвокат"],
  ["dentist", "стоматолог"],
  ["dental", "стоматология"],
  ["plumber", "сантехник"],
  ["mechanic", "автомеханик"],
  ["insurance", "страхование"],
  ["notary", "нотариус"],
  ["translation", "перевод"],
  ["interpreter", "переводчик"],
  ["interpreting", "перевод"],
  ["driving lessons", "уроки вождения"],
  ["transfer", "трансфер"],
];

/** Single-token EN → RU (used after phrase pass). */
const WORDS: Record<string, string> = {
  massage: "массаж",
  manicure: "маникюр",
  pedicure: "педикюр",
  nails: "ногти",
  nail: "ногти",
  haircut: "стрижка",
  hair: "волосы",
  brows: "брови",
  brow: "брови",
  lashes: "ресницы",
  lash: "ресницы",
  facial: "уход за лицом",
  cleaning: "уборка",
  repair: "ремонт",
  tutoring: "репетиторство",
  lessons: "уроки",
  lesson: "урок",
  training: "тренировки",
  therapy: "терапия",
  consultation: "консультация",
  consulting: "консультация",
  design: "дизайн",
  photo: "фото",
  photography: "фотография",
  video: "видео",
  moving: "переезд",
  packing: "упаковка",
  installation: "установка",
  service: "услуга",
  services: "услуги",
  russian: "русский",
  english: "английский",
  private: "частный",
  home: "домашний",
  online: "онлайн",
  offline: "офлайн",
  mobile: "выездной",
  kids: "для детей",
  children: "для детей",
  women: "для женщин",
  men: "для мужчин",
};

const PHRASES_SORTED = [...PHRASES].sort((a, b) => b[0].length - a[0].length);

function latinLetterRatio(text: string): number {
  const letters = text.replace(/[^\p{L}]/gu, "");
  if (!letters) return 0;
  const latin = (letters.match(/[A-Za-z]/g) ?? []).length;
  return latin / letters.length;
}

/** True when the title is mostly Latin / English (needs RU display). */
export function isEnglishServiceTitle(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  if (t.length < 2) return false;
  if (hasCyrillic(t) && latinLetterRatio(t) < 0.55) return false;
  return latinLetterRatio(t) >= 0.55;
}

function applyPhrases(input: string): string {
  let out = input;
  for (const [en, ru] of PHRASES_SORTED) {
    const re = new RegExp(`\\b${escapeRegExp(en)}\\b`, "gi");
    out = out.replace(re, ru);
  }
  return out;
}

function applyWords(input: string): string {
  return input.replace(/[A-Za-z][A-Za-z'-]*/g, (word) => {
    const key = word.toLowerCase();
    const mapped = WORDS[key];
    if (mapped) return mapped;
    return word;
  });
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tidyRu(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?)])/g, "$1")
    .replace(/([(])\s+/g, "$1")
    .trim();
}

function capitalizeRu(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export type ServiceTitleDisplay = {
  /** What to show as the main title. */
  title: string;
  /** Original English when we translated; null if unchanged. */
  originalEn: string | null;
};

/**
 * Prefer Russian label for English service titles.
 * If we couldn't translate enough, keep the original as the main title.
 */
export function serviceTitleForDisplay(raw: string): ServiceTitleDisplay {
  const original = raw.trim();
  if (!original) return { title: original, originalEn: null };
  if (!isEnglishServiceTitle(original)) {
    return { title: original, originalEn: null };
  }

  let translated = applyPhrases(original);
  translated = applyWords(translated);
  translated = tidyRu(translated);

  // Still mostly English → keep original, no fake translation.
  if (isEnglishServiceTitle(translated)) {
    return { title: original, originalEn: null };
  }

  return {
    title: capitalizeRu(translated),
    originalEn: original,
  };
}
