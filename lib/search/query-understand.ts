/**
 * Preprocess + deterministic heuristics for weird / messy search queries.
 * Runs before (and as failover after) the LLM intent parser.
 */

export type PreparsedKind =
  | "text"
  | "maps_url"
  | "address"
  | "social_handle"
  | "phone"
  | "website"
  | "chatty"
  | "slug";

export type PreparsedQuery = {
  /** Cleaned text for the LLM. */
  forLlm: string;
  kind: PreparsedKind;
  nearMe: boolean;
  city: string | null;
  /** Deterministic category guess when pattern is obvious. */
  categorySlug: string | null;
  queryMode:
    | "service_need"
    | "business_name"
    | "specialty"
    | "browse"
    | null;
  keywords: string[];
  mustHints: string[];
  preferCategory: boolean | null;
  /** Social / phone / domain extracted for name-like search. */
  identityToken: string | null;
  notes: string[];
};

/** ASCII + Cyrillic-safe token edges (JS \\b is ASCII-only). */
const LB = String.raw`(?<![\p{L}\p{N}_])`;
const RB = String.raw`(?![\p{L}\p{N}_])`;

/** Common SoCal / OC cities people type (incl. RU spellings). */
const CITY_ALIASES: ReadonlyArray<{ match: RegExp; city: string }> = [
  { match: new RegExp(`${LB}irvine${RB}`, "iu"), city: "Irvine" },
  { match: new RegExp(`${LB}айрвин\\p{L}*${RB}`, "iu"), city: "Irvine" },
  { match: new RegExp(`${LB}irvin${RB}`, "iu"), city: "Irvine" },
  { match: new RegExp(`${LB}anaheim${RB}`, "iu"), city: "Anaheim" },
  { match: new RegExp(`${LB}анах(?:айм|еим)\\p{L}*${RB}`, "iu"), city: "Anaheim" },
  { match: new RegExp(`${LB}santa\\s*ana${RB}`, "iu"), city: "Santa Ana" },
  { match: new RegExp(`${LB}санта[\\s-]?ана${RB}`, "iu"), city: "Santa Ana" },
  { match: new RegExp(`${LB}fountain\\s*valley${RB}`, "iu"), city: "Fountain Valley" },
  { match: new RegExp(`${LB}фаунтин\\s*в[эе]лли${RB}`, "iu"), city: "Fountain Valley" },
  { match: new RegExp(`${LB}huntington\\s*beach${RB}`, "iu"), city: "Huntington Beach" },
  { match: new RegExp(`${LB}хантингтон${RB}`, "iu"), city: "Huntington Beach" },
  { match: new RegExp(`${LB}newport\\s*beach${RB}`, "iu"), city: "Newport Beach" },
  { match: new RegExp(`${LB}ньюпорт${RB}`, "iu"), city: "Newport Beach" },
  { match: new RegExp(`${LB}costa\\s*mesa${RB}`, "iu"), city: "Costa Mesa" },
  { match: new RegExp(`${LB}коста\\s*меса${RB}`, "iu"), city: "Costa Mesa" },
  { match: new RegExp(`${LB}fullerton${RB}`, "iu"), city: "Fullerton" },
  { match: new RegExp(`${LB}фуллертон${RB}`, "iu"), city: "Fullerton" },
  { match: new RegExp(`${LB}orange${RB}(?!\\s*county)`, "iu"), city: "Orange" },
  { match: new RegExp(`${LB}tustin${RB}`, "iu"), city: "Tustin" },
  { match: new RegExp(`${LB}тастин${RB}`, "iu"), city: "Tustin" },
  { match: new RegExp(`${LB}laguna\\s*(?:niguel|beach|hills)?${RB}`, "iu"), city: "Laguna Niguel" },
  { match: new RegExp(`${LB}лагуна${RB}`, "iu"), city: "Laguna Niguel" },
  { match: new RegExp(`${LB}mission\\s*viejo${RB}`, "iu"), city: "Mission Viejo" },
  { match: new RegExp(`${LB}мишн\\s*вьехо${RB}`, "iu"), city: "Mission Viejo" },
  { match: new RegExp(`${LB}lake\\s*forest${RB}`, "iu"), city: "Lake Forest" },
  { match: new RegExp(`${LB}garden\\s*grove${RB}`, "iu"), city: "Garden Grove" },
  { match: new RegExp(`${LB}гарден\\s*гроу?в${RB}`, "iu"), city: "Garden Grove" },
  { match: new RegExp(`${LB}buena\\s*park${RB}`, "iu"), city: "Buena Park" },
  { match: new RegExp(`${LB}yorba\\s*linda${RB}`, "iu"), city: "Yorba Linda" },
  { match: new RegExp(`${LB}placentia${RB}`, "iu"), city: "Placentia" },
  { match: new RegExp(`${LB}brea${RB}`, "iu"), city: "Brea" },
  { match: new RegExp(`${LB}westh?minster${RB}`, "iu"), city: "Westminster" },
  { match: new RegExp(`${LB}вестминстер${RB}`, "iu"), city: "Westminster" },
  { match: new RegExp(`${LB}los\\s*alamitos${RB}`, "iu"), city: "Los Alamitos" },
  { match: new RegExp(`${LB}san\\s*clemente${RB}`, "iu"), city: "San Clemente" },
  { match: new RegExp(`${LB}san\\s*juan\\s*capistrano${RB}`, "iu"), city: "San Juan Capistrano" },
  { match: new RegExp(`${LB}dana\\s*point${RB}`, "iu"), city: "Dana Point" },
  { match: new RegExp(`${LB}aliso\\s*viejo${RB}`, "iu"), city: "Aliso Viejo" },
  { match: new RegExp(`${LB}rancho\\s*santa\\s*margarita${RB}`, "iu"), city: "Rancho Santa Margarita" },
  { match: new RegExp(`${LB}ladera\\s*ranch${RB}`, "iu"), city: "Ladera Ranch" },
  { match: new RegExp(`${LB}cerritos${RB}`, "iu"), city: "Cerritos" },
  { match: new RegExp(`${LB}long\\s*beach${RB}`, "iu"), city: "Long Beach" },
  { match: new RegExp(`${LB}torrance${RB}`, "iu"), city: "Torrance" },
  { match: new RegExp(`${LB}glendale${RB}`, "iu"), city: "Glendale" },
  { match: new RegExp(`${LB}глендейл${RB}`, "iu"), city: "Glendale" },
  { match: new RegExp(`${LB}burbank${RB}`, "iu"), city: "Burbank" },
  { match: new RegExp(`${LB}бербанк${RB}`, "iu"), city: "Burbank" },
  { match: new RegExp(`${LB}hollywood${RB}`, "iu"), city: "Hollywood" },
  { match: new RegExp(`${LB}west\\s*hollywood${RB}`, "iu"), city: "West Hollywood" },
  { match: new RegExp(`${LB}sher?man\\s*oaks${RB}`, "iu"), city: "Sherman Oaks" },
  { match: new RegExp(`${LB}encino${RB}`, "iu"), city: "Encino" },
  { match: new RegExp(`${LB}woodland\\s*hills${RB}`, "iu"), city: "Woodland Hills" },
  { match: new RegExp(`${LB}san\\s*diego${RB}`, "iu"), city: "San Diego" },
  { match: new RegExp(`${LB}сан[\\s-]?диего${RB}`, "iu"), city: "San Diego" },
];

const NEAR_ME_RE = new RegExp(
  `${LB}(рядом(?:\\s+со?\\s+мной)?|около\\s+меня|поблизости|недалеко|nearby|near\\s*me|close\\s*to\\s*me|around\\s*me|close\\s*by)${RB}`,
  "iu",
);

/** Latin translit / slang → canonical search terms (RU + EN). */
const TRANSLIT_ALIASES: Readonly<Record<string, readonly string[]>> = {
  manikyur: ["маникюр", "manicure", "nails"],
  manikur: ["маникюр", "manicure", "nails"],
  manicure: ["маникюр", "manicure", "nails"],
  pedikyur: ["педикюр", "pedicure"],
  pedikur: ["педикюр", "pedicure"],
  strizhka: ["стрижка", "haircut", "hair"],
  parikmaher: ["парикмахер", "haircut", "salon"],
  parikmaherskaya: ["парикмахер", "salon", "hair"],
  santehnik: ["сантехник", "plumber", "plumbing"],
  santehnika: ["сантехник", "plumber", "plumbing"],
  elektrik: ["электрик", "electrician"],
  stomatolog: ["стоматолог", "dentist", "dental"],
  zubnoy: ["стоматолог", "dentist"],
  advokat: ["адвокат", "lawyer", "attorney"],
  yurist: ["юрист", "lawyer", "attorney"],
  bukhgalter: ["бухгалтер", "accountant", "accounting"],
  buhgalter: ["бухгалтер", "accountant"],
  strahovka: ["страховка", "insurance"],
  maslo: ["масло", "oil"],
  shinomontazh: ["шиномонтаж", "tire", "tires"],
  avtoservis: ["автосервис", "auto", "mechanic"],
  avto: ["авто", "auto"],
  uborka: ["уборка", "cleaning"],
  pereezd: ["переезд", "moving", "movers"],
  repetitor: ["репетитор", "tutor", "tutoring"],
  massazh: ["массаж", "massage"],
  kosmetolog: ["косметолог", "facial", "skincare"],
  notarius: ["нотариус", "notary"],
  rieltor: ["риелтор", "realtor"],
  rielter: ["риелтор", "realtor"],
  detskiy: ["детский", "kids", "children"],
  russkiy: ["русский", "russian"],
  russkaya: ["русский", "russian"],
  ukrainskiy: ["украинский", "ukrainian"],
};

function rx(inner: string): RegExp {
  return new RegExp(`${LB}(?:${inner})${RB}`, "iu");
}

/** Phrase → category + bilingual hints (deterministic). */
const SERVICE_PATTERNS: ReadonlyArray<{
  re: RegExp;
  categorySlug: string;
  hints: readonly string[];
  mode?: "service_need" | "specialty" | "browse";
}> = [
  {
    re: rx("oil\\s*change|замен\\p{L}*\\s+масл\\p{L}*|поменя\\p{L}*\\s+масл\\p{L}*|сменить\\s+масл\\p{L}*|maslo"),
    categorySlug: "auto",
    hints: ["масло", "oil", "oil change"],
  },
  {
    re: rx("tire|tires|шин\\p{L}*|шиномонтаж|кол[её]с\\p{L}*"),
    categorySlug: "auto",
    hints: ["шины", "tire", "tires", "шиномонтаж"],
  },
  {
    re: rx("tow|towing|эвакуатор\\p{L}*|буксир\\p{L}*"),
    categorySlug: "auto",
    hints: ["эвакуатор", "tow", "towing"],
  },
  {
    re: rx("smog|смог"),
    categorySlug: "auto",
    hints: ["smog", "смог"],
  },
  {
    re: rx(
      "mechanic|автосервис|починить\\s+машин\\p{L}*|ремонт\\s+машин\\p{L}*|сломал(?:ась|ся)?\\s+машин\\p{L}*",
    ),
    categorySlug: "auto",
    hints: ["ремонт", "repair", "mechanic", "авто"],
  },
  {
    re: rx("manicure|маникюр\\p{L}*|ногт\\p{L}*|ноготоч\\p{L}*|nails?"),
    categorySlug: "beauty",
    hints: ["маникюр", "manicure", "nails"],
  },
  {
    re: rx("pedicure|педикюр\\p{L}*"),
    categorySlug: "beauty",
    hints: ["педикюр", "pedicure"],
  },
  {
    re: rx("haircut|стрижк\\p{L}*|парикмахер\\p{L}*|ба?рбер|barber"),
    categorySlug: "beauty",
    hints: ["стрижка", "haircut", "hair"],
  },
  {
    re: rx("lash(?:es)?|ресниц\\p{L}*|бров\\p{L}*|brows?"),
    categorySlug: "beauty",
    hints: ["ресницы", "lashes", "брови", "brows"],
  },
  {
    re: rx("massage|массаж\\p{L}*|spa"),
    categorySlug: "beauty",
    hints: ["массаж", "massage", "spa"],
  },
  {
    re: rx("plumber|plumbing|сантехник\\p{L}*|сантехник\\p{L}*"),
    categorySlug: "services",
    hints: ["сантехник", "plumber", "plumbing"],
  },
  {
    re: rx("electrician|электрик\\p{L}*"),
    categorySlug: "services",
    hints: ["электрик", "electrician"],
  },
  {
    re: rx("flooring|floor|ламинат|паркет|плитк\\p{L}*|полы|floring"),
    categorySlug: "services",
    hints: ["flooring", "полы", "ламинат", "laminate"],
  },
  {
    re: rx("cleaning|уборк\\p{L}*|клининг|housekeeping"),
    categorySlug: "services",
    hints: ["уборка", "cleaning"],
  },
  {
    re: rx("moving|movers?|переезд\\p{L}*|грузчик\\p{L}*"),
    categorySlug: "services",
    hints: ["переезд", "moving", "movers"],
  },
  {
    re: rx("handyman|хандимен|мастер\\s+на\\s+час|муж\\s+на\\s+час"),
    categorySlug: "services",
    hints: ["handyman", "мастер", "ремонт", "repair"],
  },
  {
    re: rx("dentist|dental|стоматолог\\p{L}*|зубн\\p{L}*|зубик"),
    categorySlug: "medical",
    hints: ["стоматолог", "dentist", "dental"],
  },
  {
    re: rx("doctor|clinic|врач\\p{L}*|клиник\\p{L}*|педиатр\\p{L}*"),
    categorySlug: "medical",
    hints: ["врач", "doctor", "clinic"],
  },
  {
    re: rx("lawyer|attorney|адвокат\\p{L}*|юрист\\p{L}*|immigration|иммиграц\\p{L}*"),
    categorySlug: "legal",
    hints: ["юрист", "lawyer", "attorney"],
  },
  {
    re: rx(
      "водитель\\s*[-–/]?\\s*переводчик\\p{L}*|переводчик\\s*[-–/]?\\s*водитель\\p{L}*|chaperone|водитель\\p{L}*\\s+переводчик\\p{L}*",
    ),
    categorySlug: "services",
    hints: ["водитель", "chaperone", "переводчик", "translator"],
  },
  {
    re: rx(
      "translator|translators|interpreter|interpreters|interpreting|переводчик\\p{L}*|устн\\p{L}*\\s+перевод|перевод\\s+для\\s+суд",
    ),
    categorySlug: "legal",
    hints: ["переводчик", "translator", "interpreter"],
  },
  {
    re: rx("notary|нотариус\\p{L}*"),
    categorySlug: "legal",
    hints: ["нотариус", "notary"],
  },
  {
    re: rx("insurance|страховк\\p{L}*|страхован\\p{L}*"),
    categorySlug: "insurance",
    hints: ["страховка", "insurance"],
  },
  {
    re: rx("accountant|accounting|taxes|бухгалтер\\p{L}*|налог\\p{L}*"),
    categorySlug: "finance",
    hints: ["бухгалтер", "accountant", "taxes", "налоги"],
  },
  {
    re: rx("realtor|риелтор\\p{L}*|риэлтор\\p{L}*|недвижимост\\p{L}*"),
    categorySlug: "real_estate",
    hints: ["риелтор", "realtor", "недвижимость"],
  },
  {
    re: rx("tutor|tutoring|репетитор\\p{L}*|учитель\\p{L}*"),
    categorySlug: "education",
    hints: ["репетитор", "tutor", "tutoring"],
  },
  {
    re: rx("daycare|childcare|няня|детск(?:ий|ого)\\s+сад"),
    categorySlug: "education",
    hints: ["детский", "daycare", "nanny", "няня"],
  },
  {
    re: rx("gym|fitness|йог\\p{L}*|yoga|фитнес|спортзал"),
    categorySlug: "fitness",
    hints: ["фитнес", "gym", "fitness", "yoga"],
  },
  {
    re: rx(
      "ballet|балет\\p{L}*|ballroom|танц\\p{L}*|dance|dancing|хореограф\\p{L}*|студи\\p{L}*\\s+балет|студи\\p{L}*\\s+танц",
    ),
    categorySlug: "fitness",
    hints: ["балет", "ballet", "dance", "танцы", "ballroom"],
  },
  {
    re: rx("vet|veterinary|ветеринар\\p{L}*|груминг|grooming"),
    categorySlug: "pets",
    hints: ["ветеринар", "vet", "grooming", "груминг"],
  },
  {
    re: rx("bakery|пекарн\\p{L}*|выпечк\\p{L}*"),
    categorySlug: "restaurants",
    hints: ["пекарня", "bakery", "выпечка"],
    mode: "specialty",
  },
  {
    re: rx("restaurant|restaurants|ресторан\\p{L}*|кафе|cafe|sushi|суши"),
    categorySlug: "restaurants",
    hints: ["ресторан", "restaurant", "кафе"],
    mode: "browse",
  },
  {
    re: rx("grocery|groceries|продукт\\p{L}*|магазин\\s+продукт"),
    categorySlug: "groceries",
    hints: ["продукты", "grocery", "market"],
    mode: "browse",
  },
];

const FILLER_RE = new RegExp(
  `^(?:ну\\s+)?(?:пожалуйста|please|подскажите|помогите|скажите|мне\\s+(?:бы|нужен|нужна|нужно)|ищу|looking\\s+for|need(?:\\s+a)?|want(?:\\s+a)?|нужен|нужна|нужно|нужны|где\\s+(?:можно|бы|тут)|кто\\s+(?:может|делает|знает)|есть\\s+ли|можно\\s+ли|нормальный|нормальную|хороший|хорошую)(?!\\p{L})[,:]?\\s*`,
  "iu",
);

function stripEmoji(text: string): string {
  return text
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .replace(/[\uFE0F\u200D]/g, "");
}

function extractCity(text: string): string | null {
  for (const { match, city } of CITY_ALIASES) {
    if (match.test(text)) return city;
  }
  return null;
}

function stripCityMentions(text: string): string {
  let out = text;
  for (const { match } of CITY_ALIASES) {
    out = out.replace(match, " ");
  }
  return out.replace(/\s+/g, " ").trim();
}

function extractPhone(text: string): string | null {
  const m = text.match(
    /(?:\+?1[\s.-]*)?(?:\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]*\d{4}\b/,
  );
  if (!m) return null;
  const digits = m[0].replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

function extractSocialHandle(text: string): string | null {
  const ig = text.match(
    /(?:instagram\.com\/|instagr\.am\/|@)([A-Za-z0-9._]{2,30})\b/i,
  );
  if (ig?.[1] && !/^(https?|www)$/i.test(ig[1])) {
    return ig[1].replace(/^@/, "");
  }
  const tg = text.match(
    /(?:t\.me\/|telegram\.me\/|telegram\.org\/|tg:\/\/resolve\?domain=)([A-Za-z0-9_]{3,32})\b/i,
  );
  if (tg?.[1]) return tg[1];
  // Bare @handle without URL
  const bare = text.trim().match(/^@([A-Za-z0-9._]{2,30})$/);
  if (bare?.[1]) return bare[1];
  return null;
}

function extractWebsiteIdentity(text: string): string | null {
  const m = text.match(
    /(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+)\.(?:com|net|org|io|biz|us|co)\b/i,
  );
  if (!m?.[1]) return null;
  const host = m[1].toLowerCase();
  if (
    ["google", "maps", "facebook", "instagram", "youtube", "yelp", "goo"].includes(
      host,
    )
  ) {
    return null;
  }
  return host.replace(/-/g, " ");
}

/** URL/path slug: ballroom-studio-dance-code */
const SLUG_STOP = new Set([
  "code",
  "the",
  "and",
  "for",
  "with",
  "from",
  "inc",
  "llc",
  "www",
  "http",
  "https",
]);

/** Too generic for ranking — keep for search tokens, drop from mustHints. */
const SLUG_WEAK = new Set([
  "studio",
  "school",
  "center",
  "centre",
  "club",
  "group",
  "company",
  "official",
]);

function parseKebabSlug(text: string): {
  slug: string;
  parts: string[];
  distinctive: string[];
} | null {
  const raw = text.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+){1,10}$/.test(raw)) return null;
  const parts = raw.split("-").filter((p) => p.length >= 2);
  if (parts.length < 2) return null;
  const distinctive = parts.filter((p) => !SLUG_STOP.has(p) && p.length >= 3);
  return { slug: raw, parts, distinctive: distinctive.length > 0 ? distinctive : parts };
}

function applyTranslit(text: string): { text: string; hints: string[] } {
  const hints: string[] = [];
  const parts = text.split(/([^\p{L}\p{N}]+)/u);
  const out = parts.map((part) => {
    if (!/^[\p{L}\p{N}]+$/u.test(part)) return part;
    const key = part.toLowerCase();
    const mapped = TRANSLIT_ALIASES[key];
    if (!mapped) return part;
    hints.push(...mapped);
    return mapped[0];
  });
  return { text: out.join(""), hints: [...new Set(hints)] };
}

function matchServicePattern(text: string): {
  categorySlug: string;
  hints: string[];
  mode: "service_need" | "specialty" | "browse";
} | null {
  for (const p of SERVICE_PATTERNS) {
    if (p.re.test(text)) {
      return {
        categorySlug: p.categorySlug,
        hints: [...p.hints],
        mode: p.mode ?? "service_need",
      };
    }
  }
  return null;
}

function isChatty(text: string): boolean {
  return (
    text.length > 40 ||
    /[?]{1,}|!(?:!!)?/.test(text) ||
    /\b(подскажите|помогите|пожалуйста|looking for|need a|где можно|кто знает)\b/i.test(
      text,
    )
  );
}

/**
 * Understand messy human input before LLM + as failover when LLM is down.
 */
export function preparseSearchQuery(raw: string): PreparsedQuery {
  const notes: string[] = [];
  let text = stripEmoji(raw).replace(/\s+/g, " ").trim();

  const nearMe = NEAR_ME_RE.test(text);
  if (nearMe) {
    text = text.replace(NEAR_ME_RE, " ").replace(/\s+/g, " ").trim();
    notes.push("near_me");
  }

  const phone = extractPhone(text);
  if (phone) {
    notes.push("phone");
    return {
      forLlm: phone,
      kind: "phone",
      nearMe,
      city: extractCity(raw),
      categorySlug: null,
      queryMode: "business_name",
      keywords: [phone, phone.slice(0, 3), phone.slice(3, 6), phone.slice(6)],
      mustHints: [phone],
      preferCategory: false,
      identityToken: phone,
      notes,
    };
  }

  const handle = extractSocialHandle(text);
  if (handle) {
    notes.push("social_handle");
    return {
      forLlm: handle,
      kind: "social_handle",
      nearMe,
      city: extractCity(raw),
      categorySlug: null,
      queryMode: "business_name",
      keywords: [handle, handle.replace(/[._]/g, " ")],
      mustHints: [handle],
      preferCategory: false,
      identityToken: handle,
      notes,
    };
  }

  // Website (not maps — maps handled upstream)
  if (
    !/google\.com\/maps|maps\.google|maps\.app\.goo/i.test(text) &&
    /\bhttps?:\/\//i.test(text)
  ) {
    const identity = extractWebsiteIdentity(text);
    if (identity) {
      notes.push("website");
      return {
        forLlm: identity,
        kind: "website",
        nearMe,
        city: extractCity(raw),
        categorySlug: null,
        queryMode: "business_name",
        keywords: identity.split(/\s+/).filter((t) => t.length >= 2),
        mustHints: identity.split(/\s+/).filter((t) => t.length >= 2),
        preferCategory: false,
        identityToken: identity,
        notes,
      };
    }
  }

  // Catalog / URL slug paste: ballroom-studio-dance-code
  const kebab = parseKebabSlug(text);
  if (kebab) {
    notes.push("slug");
    const serviceFromSlug = matchServicePattern(kebab.distinctive.join(" "));
    const rankHints = kebab.distinctive.filter((p) => !SLUG_WEAK.has(p));
    return {
      forLlm: kebab.distinctive.join(" "),
      kind: "slug",
      nearMe,
      city: extractCity(raw),
      categorySlug: serviceFromSlug?.categorySlug ?? null,
      queryMode: "business_name",
      keywords: kebab.distinctive,
      mustHints: [
        ...(rankHints.length > 0 ? rankHints : kebab.distinctive.slice(0, 2)),
        ...(serviceFromSlug?.hints ?? []),
      ].slice(0, 12),
      preferCategory: false,
      identityToken: kebab.slug,
      notes,
    };
  }

  const city = extractCity(text);
  if (city) notes.push(`city:${city}`);

  // Strip chatty openers / soft judgments
  let cleaned = text;
  for (let i = 0; i < 8; i += 1) {
    const next = cleaned.replace(FILLER_RE, "").trim();
    if (next === cleaned) break;
    cleaned = next;
    notes.push("stripped_filler");
  }

  // "в Irvine" / "in Anaheim" leftovers
  cleaned = cleaned
    .replace(new RegExp(`${LB}(?:в|во|in|at|near)${RB}\\s+`, "giu"), " ")
    .replace(/\s+/g, " ")
    .trim();

  const withoutCity = stripCityMentions(cleaned)
    .replace(new RegExp(`${LB}(?:в|во|in|at)${RB}\\s*`, "giu"), " ")
    .replace(/[?!.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const translit = applyTranslit(withoutCity || cleaned);
  if (translit.hints.length) notes.push("translit");

  const service = matchServicePattern(translit.text + " " + raw);
  const chatty = isChatty(raw);

  // Specialty modifiers people glue onto any service
  const modifierHints: string[] = [];
  if (new RegExp(`${LB}(?:русский|русская|русское|russian)${RB}`, "iu").test(raw)) {
    modifierHints.push("русский", "russian");
  }
  if (new RegExp(`${LB}(?:украинский|украинская|ukrainian)${RB}`, "iu").test(raw)) {
    modifierHints.push("украинский", "ukrainian");
  }
  if (new RegExp(`${LB}(?:детский|детская|kids?|children)${RB}`, "iu").test(raw)) {
    modifierHints.push("детский", "kids");
  }

  let queryMode: PreparsedQuery["queryMode"] = null;
  let categorySlug: string | null = null;
  let mustHints: string[] = [...translit.hints, ...modifierHints];
  let keywords: string[] = [];
  let preferCategory: boolean | null = null;

  // Two+ Capitalized / Cyrillic name tokens without service words → likely a person/brand.
  const nameTokens = translit.text
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  const looksLikePersonOrBrand =
    !service &&
    nameTokens.length >= 2 &&
    nameTokens.length <= 4 &&
    nameTokens.every((t) => /^\p{L}+$/u.test(t)) &&
    !NEAR_ME_RE.test(raw);

  if (service) {
    queryMode = modifierHints.length > 0 && service.mode === "browse"
      ? "specialty"
      : service.mode;
    categorySlug = service.categorySlug;
    mustHints = [...new Set([...mustHints, ...service.hints])];
    preferCategory =
      queryMode === "service_need" || queryMode === "browse";
    keywords = preferCategory ? [] : [...service.hints, ...modifierHints];
    notes.push(`service:${service.categorySlug}`);
  } else if (looksLikePersonOrBrand) {
    queryMode = "business_name";
    preferCategory = false;
    keywords = nameTokens.map((t) => t.toLowerCase());
    mustHints = [...new Set([...keywords, ...modifierHints])];
    notes.push("person_or_brand");
  } else if (
    translit.hints.length > 0 &&
    /^[\p{L}\p{N}\s-]{2,40}$/u.test(translit.text)
  ) {
    // Single translit token like "manikyur" → service-ish specialty
    queryMode = "service_need";
    preferCategory = true;
    mustHints = [...new Set(mustHints)];
    notes.push("translit_service");
  }

  const forLlm = (translit.text || withoutCity || cleaned || text)
    .replace(/[?]{2,}/g, " ")
    .replace(/!{2,}/g, " ")
    .replace(/\bASAP\b/gi, " ")
    .replace(/\bСРОЧНО\b/giu, " ")
    .replace(/[?!.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);

  return {
    forLlm: forLlm || text.slice(0, 200),
    kind: chatty ? "chatty" : "text",
    nearMe,
    city,
    categorySlug,
    queryMode,
    keywords,
    mustHints: mustHints.slice(0, 12),
    preferCategory,
    identityToken: null,
    notes,
  };
}

/**
 * Merge deterministic preparse into LLM (or empty) intent.
 * Preparse wins for identity tokens; fills gaps when LLM missed city/nearMe/hints.
 */
export function mergePreparseIntoIntent<
  T extends {
    keywords: string[];
    city: string | null;
    categorySlug: string | null;
    mustHints: string[];
    preferCategory: boolean;
    nearMe: boolean;
    queryMode: string;
  },
>(intent: T, pre: PreparsedQuery, allowedSlugs: Set<string>): T {
  if (
    pre.kind === "phone" ||
    pre.kind === "social_handle" ||
    pre.kind === "website" ||
    pre.kind === "slug"
  ) {
    return {
      ...intent,
      queryMode: "business_name",
      preferCategory: false,
      categorySlug: null,
      city: intent.city ?? pre.city,
      nearMe: intent.nearMe || pre.nearMe,
      keywords:
        pre.keywords.length > 0 ? pre.keywords : intent.keywords,
      mustHints:
        pre.mustHints.length > 0 ? pre.mustHints : intent.mustHints,
    };
  }

  const categorySlug = (() => {
    const fromIntent = intent.categorySlug;
    const fromPre =
      pre.categorySlug && allowedSlugs.has(pre.categorySlug)
        ? pre.categorySlug
        : null;
    if (intent.queryMode === "business_name") return null;
    return fromIntent ?? fromPre;
  })();

  const mustHints = [
    ...new Set(
      [...intent.mustHints, ...pre.mustHints].map((h) => h.toLowerCase()),
    ),
  ].slice(0, 16);

  let queryMode = intent.queryMode;
  let preferCategory = intent.preferCategory;
  if (
    (!intent.mustHints.length && !intent.keywords.length && pre.queryMode) ||
    (pre.queryMode && intent.queryMode === "specialty" && pre.queryMode === "service_need")
  ) {
    queryMode = pre.queryMode;
    preferCategory =
      pre.preferCategory ??
      (pre.queryMode === "service_need" || pre.queryMode === "browse");
  }

  return {
    ...intent,
    city: intent.city ?? pre.city,
    nearMe: intent.nearMe || pre.nearMe,
    categorySlug,
    mustHints,
    queryMode,
    preferCategory,
    keywords:
      preferCategory
        ? []
        : intent.keywords.length > 0
          ? intent.keywords
          : pre.keywords,
  };
}
