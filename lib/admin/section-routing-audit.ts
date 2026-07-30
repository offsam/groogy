import "server-only";

/**
 * Load published-card section mismatches from the latest audit JSON
 * (written by scripts/business-enrich/audit_section_routing.py).
 * Live recompute is available via listSectionRoutingMismatchesLive.
 */

import { readFile } from "fs/promises";
import path from "path";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { routeCard } from "@/lib/import-review/entity-routing";
import type { MoveSectionKey } from "@/lib/admin/move-entity-section";

export type SectionRoutingMismatch = {
  section: MoveSectionKey;
  entityId: string;
  slug: string | null;
  title: string;
  currentEntityType: string;
  suggestedEntityType: string;
  suggestedCollection: string;
  confidence: string;
  reason: string;
  path: string;
};

const SECTION_ENTITY: Record<string, string> = {
  professionals: "private_specialist",
  businesses: "business",
  marketplace: "marketplace_listing",
  jobs: "job",
  events: "event",
  lechu: "lechu_listing",
  transfers: "transfer_listing",
};

export async function loadSectionRoutingAuditFile(): Promise<{
  generatedAt: string | null;
  mismatches: SectionRoutingMismatch[];
}> {
  const file = path.join(
    process.cwd(),
    "docs/audits/data/section_routing_audit_latest.json",
  );
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as {
      generated_at?: string;
      findings?: Array<Record<string, unknown>>;
    };
    const mismatches = (raw.findings || []).map((f) => ({
      section: String(f.section) as MoveSectionKey,
      entityId: String(f.entity_id),
      slug: f.slug == null ? null : String(f.slug),
      title: String(f.title || ""),
      currentEntityType: String(f.current_entity_type || ""),
      suggestedEntityType: String(f.suggested_entity_type || ""),
      suggestedCollection: String(f.suggested_collection || ""),
      confidence: String(f.confidence || ""),
      reason: String(f.reason || ""),
      path: String(f.path || ""),
    }));
    return { generatedAt: raw.generated_at ?? null, mismatches };
  } catch {
    return { generatedAt: null, mismatches: [] };
  }
}

/** Live scan of approved professionals for goods-sale / wrong-section signals. */
export async function listSectionRoutingMismatchesLive(
  limit = 200,
): Promise<SectionRoutingMismatch[]> {
  const catalog = createServiceRoleClient() as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (
          col: string,
          val: string,
        ) => {
          limit: (n: number) => Promise<{
            data: Array<{
              id: string;
              slug: string;
              display_name: string | null;
              description: string | null;
              short_description: string | null;
              headline: string | null;
            }> | null;
          }>;
        };
      };
    };
  };
  const { data: pros } = await catalog
    .from("professionals")
    .select(
      "id, slug, display_name, description, short_description, headline, status",
    )
    .eq("status", "approved")
    .limit(limit);

  const out: SectionRoutingMismatch[] = [];
  for (const row of pros || []) {
    const text = [
      row.display_name,
      row.headline,
      row.short_description,
      row.description,
    ]
      .filter(Boolean)
      .join(" ");
    const result = routeCard({
      text,
      personName: row.display_name,
      hasContact: true,
    });
    const expected = SECTION_ENTITY.professionals;
    if (
      !result.entityType ||
      result.entityType === expected ||
      result.confidence === "none"
    ) {
      continue;
    }
    out.push({
      section: "professionals",
      entityId: row.id,
      slug: row.slug,
      title: row.display_name || "",
      currentEntityType: expected,
      suggestedEntityType: result.entityType,
      suggestedCollection: result.targetCollection || "",
      confidence: result.confidence,
      reason: result.reason,
      path: `/professional/${row.slug}`,
    });
  }
  return out;
}
