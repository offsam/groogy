/**
 * Heuristic: firm card vs person-as-card (employee advertising the employer).
 * Used by catalog duplicate UI to offer «Привязать как сотрудника» vs «Склеить».
 */

const FIRM_TOKEN_RE =
  /\b(?:llc|pllc|llp|inc|corp|co\.|company|group|pc\b|ltd|gmbh|plc|law\b|firm|studio|salon|clinic|center|centre|school|academy|pharmacy|restaurant|cafe|café|market|shop|store|services?|associates?|attorneys?|юридическ\w*|адвокатск\w*|фирма|студия|салон|клиника|центр|школа|агентств\w*|офис|компании?)\b/i;

const CREDENTIAL_RE =
  /\b(?:cpa|ea\b|esq\.?|jd\b|md\b|dds|dmd|phd|do\b|np\b|pa-c|rn\b|lmsw|lcsw|attorney|lawyer|notary|realtor|риэлтор|риелтор|адвокат|нотариус|бухгалтер|юрист)\b/i;

/** «Natalie Melnik, CPA» / «Иван Петров» / «Dr. Olga Ivanova» */
const PERSON_NAME_RE =
  /^(?:dr\.?\s+|mr\.?\s+|mrs\.?\s+|ms\.?\s+)?[A-ZА-ЯЁ][a-zа-яё'’-]+(?:\s+[A-ZА-ЯЁ][a-zа-яё'’-]+){1,3}(?:,?\s+[A-ZА-ЯЁa-zа-яё.]{2,12})?$/u;

export type EntityNameKind = "firm" | "person" | "unknown";

export function classifyEntityName(name: string | null | undefined): EntityNameKind {
  const raw = (name || "").trim().replace(/\s+/g, " ");
  if (raw.length < 3) return "unknown";

  const hasFirm = FIRM_TOKEN_RE.test(raw);
  const hasCred = CREDENTIAL_RE.test(raw);
  const personShaped = PERSON_NAME_RE.test(raw);

  if (hasFirm && !personShaped) return "firm";
  if (hasFirm && personShaped) {
    // «Shestopalko Law PLLC» wins as firm; «John Smith Law» rare — treat firm token as firm.
    return "firm";
  }
  if (personShaped || (hasCred && !hasFirm)) return "person";
  if (hasCred) return "person";
  return "unknown";
}

export type EmployeeAttachSuggestion = {
  firmId: string;
  firmName: string;
  firmKind: "business";
  personId: string;
  personName: string;
  personKind: "business" | "professional";
  /** Hint for UI: auto-offer attach when names look like firm+person. */
  confidence: "high" | "low";
};

type Side = {
  id: string;
  name: string;
  kind: string;
};

/**
 * When one side looks like a firm and the other like a person, suggest
 * attaching the person as an employee of the firm (not a hard merge).
 */
export function suggestEmployeeAttach(
  a: Side,
  b: Side,
): EmployeeAttachSuggestion | null {
  const aKind = a.kind === "professional" || a.kind === "business" ? a.kind : null;
  const bKind = b.kind === "professional" || b.kind === "business" ? b.kind : null;
  if (!aKind || !bKind) return null;

  // Firm must be a business card.
  const aClass = classifyEntityName(a.name);
  const bClass = classifyEntityName(b.name);

  let firm: Side | null = null;
  let person: Side | null = null;
  let confidence: "high" | "low" = "high";

  if (aClass === "firm" && bClass === "person" && aKind === "business") {
    firm = a;
    person = b;
  } else if (bClass === "firm" && aClass === "person" && bKind === "business") {
    firm = b;
    person = a;
  } else if (aClass === "firm" && bClass === "unknown" && aKind === "business") {
    // Weak: firm + unknown — only if other is already a professional.
    if (bKind !== "professional") return null;
    firm = a;
    person = b;
    confidence = "low";
  } else if (bClass === "firm" && aClass === "unknown" && bKind === "business") {
    if (aKind !== "professional") return null;
    firm = b;
    person = a;
    confidence = "low";
  } else {
    return null;
  }

  if (!firm || !person) return null;
  if (firm.kind !== "business") return null;
  if (person.kind !== "business" && person.kind !== "professional") return null;

  return {
    firmId: firm.id,
    firmName: firm.name,
    firmKind: "business",
    personId: person.id,
    personName: person.name,
    personKind: person.kind as "business" | "professional",
    confidence,
  };
}

/** Role hint from credentials in the display name (CPA, Esq, …). */
export function employerRoleFromName(name: string | null | undefined): string | null {
  const raw = (name || "").trim();
  if (!raw) return null;
  const m = raw.match(CREDENTIAL_RE);
  if (!m) return null;
  const token = m[0].replace(/\./g, "").toUpperCase();
  const map: Record<string, string> = {
    CPA: "CPA",
    EA: "Enrolled Agent",
    ESQ: "Attorney",
    JD: "Attorney",
    MD: "MD",
    DDS: "DDS",
    DMD: "DMD",
    ATTORNEY: "Attorney",
    LAWYER: "Attorney",
    АДВОКАТ: "Адвокат",
    ЮРИСТ: "Юрист",
    БУХГАЛТЕР: "Бухгалтер",
    НОТАРИУС: "Нотариус",
    РИЭЛТОР: "Риэлтор",
    РИЕЛТОР: "Риэлтор",
  };
  return map[token] || m[0].trim().slice(0, 80);
}
