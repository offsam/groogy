import "server-only";

/**
 * Live scan of `businesses` rows whose `name` looks like an individual person
 * rather than a company — candidates to reclassify into `professionals` via
 * the existing moveEntitySectionAction("businesses" -> "professionals").
 *
 * This is a review queue, not an auto-migration: precision on the name-shape
 * heuristics below is good but not perfect (~85% on the Cyrillic two-word
 * pattern, lower on the English one — a plain two-word English company name
 * with no LLC/Inc/etc suffix can still slip through). Every row needs a
 * human click on "Перенести → professionals" via WrongSectionMoveButton;
 * there is no auto-move here.
 */

import { createServiceRoleClient } from "@/lib/supabase/service";

export type BusinessProfessionalCandidateReason =
  | "name_comma_role"
  | "two_word_ru_name"
  | "two_word_en_name"
  | "name_dash_company";

export type BusinessProfessionalCandidate = {
  entityId: string;
  slug: string;
  name: string;
  city: string | null;
  stateCode: string | null;
  categoryName: string | null;
  matchReason: BusinessProfessionalCandidateReason;
  confidence: "high" | "medium";
  path: string;
};

const REASON_CONFIDENCE: Record<
  BusinessProfessionalCandidateReason,
  "high" | "medium"
> = {
  name_comma_role: "high",
  two_word_ru_name: "high",
  two_word_en_name: "medium",
  name_dash_company: "medium",
};

export const REASON_LABEL: Record<BusinessProfessionalCandidateReason, string> =
  {
    name_comma_role: "«Имя, роль» (напр. Larisa, Nail Master)",
    two_word_ru_name: "Имя Фамилия (кириллица)",
    two_word_en_name: "Имя Фамилия (латиница)",
    name_dash_company: "Имя Фамилия - Название конторы",
  };

// Kept in sync with the manual audit run against this data — see chat
// history for the precision check against real rows.
const COMMA_ROLE_RE =
  /^[А-ЯЁA-Z][а-яёa-z]+,\s*(Nail|Master|Мастер|Photography|Stylist|стилист|массаж|Massage)/i;
const TWO_WORD_RU_RE = /^[А-ЯЁ][а-яё]+ [А-ЯЁ][а-яё]+$/;
const TWO_WORD_EN_RE = /^[A-Z][a-z]+ [A-Z][a-z]+$/;
const EN_BUSINESS_SUFFIX_RE =
  /(LLC|Inc|Corp|Group|Studio|Agency|Center|Clinic|Service|Shop|Store|Company|Care|House|Team|Pharmacy|Market|Salon)/i;
const NAME_DASH_COMPANY_RE = /^[А-ЯЁA-Z][а-яёa-z]+ [А-ЯЁA-Z][а-яёa-z]+ - /;

function classifyName(
  name: string,
): BusinessProfessionalCandidateReason | null {
  const n = name.trim();
  if (!n) return null;
  if (COMMA_ROLE_RE.test(n)) return "name_comma_role";
  if (TWO_WORD_RU_RE.test(n)) return "two_word_ru_name";
  if (TWO_WORD_EN_RE.test(n) && !EN_BUSINESS_SUFFIX_RE.test(n)) {
    return "two_word_en_name";
  }
  if (NAME_DASH_COMPANY_RE.test(n)) return "name_dash_company";
  return null;
}

type BusinessRow = {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  state_code: string | null;
  category_id: string | null;
};

export async function listBusinessProfessionalCandidatesLive(
  limit = 500,
): Promise<BusinessProfessionalCandidate[]> {
  const catalog = createServiceRoleClient() as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (
          col: string,
          val: string,
        ) => Promise<{ data: BusinessRow[] | null; error: unknown }>;
      };
    };
  };

  const { data, error } = await catalog
    .from("businesses")
    .select("id, slug, name, city, state_code, category_id")
    .eq("status", "approved");
  if (error || !data) return [];

  const categoryIds = [
    ...new Set(data.map((b) => b.category_id).filter((x): x is string => !!x)),
  ];
  const categoryNames = new Map<string, string>();
  if (categoryIds.length > 0) {
    const catClient = createServiceRoleClient() as unknown as {
      from: (table: string) => {
        select: (cols: string) => {
          in: (
            col: string,
            vals: string[],
          ) => Promise<{
            data: { id: string; name: string }[] | null;
            error: unknown;
          }>;
        };
      };
    };
    const { data: cats } = await catClient
      .from("categories")
      .select("id, name")
      .in("id", categoryIds);
    for (const c of cats || []) categoryNames.set(c.id, c.name);
  }

  const out: BusinessProfessionalCandidate[] = [];
  for (const row of data) {
    const reason = classifyName(row.name);
    if (!reason) continue;
    out.push({
      entityId: row.id,
      slug: row.slug,
      name: row.name,
      city: row.city,
      stateCode: row.state_code,
      categoryName: row.category_id
        ? (categoryNames.get(row.category_id) ?? null)
        : null,
      matchReason: reason,
      confidence: REASON_CONFIDENCE[reason],
      path: `/business/${row.slug}`,
    });
    if (out.length >= limit) break;
  }
  return out;
}
