/**
 * Lightweight RU↔EN synonym expansion for directory search.
 * Used so "русский маникюр" also matches "Russian manicure",
 * and service-need queries hit cards written in either language.
 */

/** Each group: any token in the group can satisfy any other token in the group. */
const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  // Language / community
  ["русский", "русская", "русское", "русские", "russian", "russians"],
  ["украинский", "украинская", "украинское", "ukrainian"],
  ["армянский", "армянская", "armenian"],

  // Beauty
  [
    "маникюр",
    "маникюра",
    "маникюры",
    "ногти",
    "ноготь",
    "manicure",
    "manicures",
    "nails",
    "nail",
  ],
  ["педикюр", "педикюра", "pedicure", "pedicures"],
  [
    "стрижка",
    "стрижки",
    "стрижку",
    "парикмахер",
    "парикмахерская",
    "haircut",
    "haircuts",
    "hair",
    "barber",
    "salon",
  ],
  ["окрашивание", "покраска волос", "coloring", "highlights", "балаяж", "balayage"],
  ["брови", "бровь", "brows", "eyebrows", "eyebrow"],
  ["ресницы", "lash", "lashes", "eyelashes", "наращивание"],
  ["массаж", "massage", "spa"],
  ["косметолог", "косметология", "facial", "facials", "skincare"],
  ["макияж", "makeup", "make-up"],

  // Medical
  ["стоматолог", "стоматология", "dentist", "dental", "odontology", "зубы", "зуб"],
  ["врач", "доктор", "клиника", "doctor", "clinic", "medical", "медицина"],
  ["педиатр", "детский врач", "pediatrician", "pediatrics"],
  ["гинеколог", "gynecologist", "obgyn", "ob-gyn"],
  ["терапевт", "primary care", "семейный врач", "family doctor"],
  ["окулист", "офтальмолог", "optometrist", "ophthalmologist", "глаза"],
  ["аптека", "pharmacy", "drugstore"],

  // Home / trades
  ["сантехник", "сантехника", "plumber", "plumbing"],
  ["электрик", "электрика", "electrician", "electrical", "wiring"],
  ["handyman", "хандимен", "мастер", "ремонт", "repair", "починить", "починка"],
  [
    "flooring",
    "floor",
    "floors",
    "hardwood",
    "laminate",
    "vinyl",
    "плитка",
    "ламинат",
    "паркет",
    "полы",
  ],
  ["крыша", "кровля", "roofing", "roof", "roofer"],
  ["покраска", "маляр", "painting", "painter"],
  ["уборка", "клининг", "cleaning", "cleaner", "housekeeping"],
  ["переезд", "переезды", "moving", "movers", "грузчики"],
  ["кондиционер", "hvac", "heating", "cooling", "отопление"],
  ["забор", "fencing", "fence"],
  ["бетон", "concrete"],
  ["гипсокартон", "drywall"],
  ["кухня", "kitchen", "remodel", "renovation", "ремонт дома"],
  ["подрядчик", "contractor", "строительство", "стройка", "builder"],
  ["ландшафт", "landscaping", "gardening", "lawn", "газон", "садовник"],

  // Auto
  [
    "автосервис",
    "авто",
    "mechanic",
    "auto",
    "garage",
    "машина",
    "машины",
    "автомобиль",
  ],
  [
    "масло",
    "масла",
    "маслу",
    "oil",
    "oils",
    "lube",
    "смазка",
  ],
  ["шиномонтаж", "шины", "tire", "tires", "колёса", "колеса", "rim"],
  ["эвакуатор", "tow", "towing", "буксировка"],
  ["смог", "smog", "inspection"],
  ["тормоза", "brakes", "brake"],
  ["аккумулятор", "battery", "batteries"],
  ["детейлинг", "detailing", "мойка"],

  // Food / grocery
  ["ресторан", "рестораны", "кафе", "restaurant", "restaurants", "cafe"],
  ["пекарня", "выпечка", "bakery", "bakeries", "хлеб"],
  ["продукты", "grocery", "groceries", "market", "супермаркет"],
  ["суши", "sushi", "роллы"],
  ["пицца", "pizza", "pizzeria"],
  ["кейтеринг", "catering", "банкет"],

  // Legal / finance / insurance / real estate
  ["юрист", "адвокат", "lawyer", "attorney", "legal", "юридический"],
  [
    "переводчик",
    "переводчика",
    "переводчики",
    "перевод",
    "translator",
    "translators",
    "interpreter",
    "interpreters",
    "interpreting",
    "устный перевод",
  ],
  ["иммиграция", "immigration", "виза", "visa"],
  ["нотариус", "notary", "notarial"],
  ["бухгалтер", "бухгалтерия", "accounting", "accountant", "taxes", "налоги"],
  ["страховка", "страхование", "insurance", "insurer"],
  ["риелтор", "риэлтор", "realtor", "недвижимость"],

  // Education / kids / fitness / pets
  ["репетитор", "учитель", "tutor", "teacher", "tutoring"],
  ["детский", "детский сад", "daycare", "childcare", "няня", "nanny"],
  ["фитнес", "спортзал", "gym", "fitness", "тренировка", "yoga", "йога"],
  ["ветеринар", "ветклиника", "vet", "veterinary", "груминг", "grooming"],

  // Dance / ballet / ballroom
  [
    "балет",
    "балета",
    "балетный",
    "ballet",
    "танцы",
    "танцев",
    "танец",
    "dance",
    "dancing",
    "ballroom",
  ],
  ["хореограф", "choreographer", "choreography"],

  // Travel / events
  ["путешествия", "турагентство", "travel"],
  ["мероприятие", "мероприятия", "event", "events", "свадьба", "wedding"],

  // Proximity
  ["рядом", "nearby", "near", "поблизости"],
];

const LOOKUP = new Map<string, readonly string[]>();
for (const group of SYNONYM_GROUPS) {
  const normalized = group.map((g) => g.toLowerCase());
  for (const token of normalized) {
    LOOKUP.set(token, normalized);
  }
}

/** Expand a single search token into itself + synonyms (deduped, lowercased). */
export function expandSearchToken(token: string): string[] {
  const lower = token.toLowerCase();
  const group = LOOKUP.get(lower);
  if (!group) return [lower];
  return [...new Set(group)];
}

/**
 * True if haystack satisfies the token via exact substring or any synonym.
 */
export function haystackMatchesToken(haystack: string, token: string): boolean {
  const variants = expandSearchToken(token);
  return variants.some((v) => haystack.includes(v));
}
