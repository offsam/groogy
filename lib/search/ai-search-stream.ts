/**
 * Shared NDJSON event contract for POST /api/search/ai.
 *
 * The route streams one JSON object per line (see the same pattern used by
 * app/api/admin/published/enrich/route.ts): a `meta` event as soon as the
 * search pipeline (LLM intent + catalog cascade + rank + rerank) has settled
 * on a final, ordered result set, then one `card` event per business in that
 * order, then `finished`. This lets the client reveal cards one by one as
 * they arrive over the wire instead of faking the stagger client-side.
 */

import type { Business } from "@/types/business";

export type AiSearchIntentSummary = {
  keywords: string[];
  city: string | null;
  categorySlug: string | null;
  mustHints: string[];
  preferCategory?: boolean;
  nearMe?: boolean;
  queryMode?: string;
};

export type AiSearchMatchKind = "exact" | "similar" | "empty";

export type AiSearchStreamMeta = {
  intent: AiSearchIntentSummary;
  modelUsed: string | null;
  fallback: boolean;
  sortedByDistance?: boolean;
  preferCategory?: boolean;
  corrections?: Array<{ from: string; to: string }>;
  correctedQuery?: string | null;
  matchKind?: AiSearchMatchKind;
  message?: string | null;
  /** Final result count — lets the client size the skeleton grid exactly. */
  total: number;
};

export type AiSearchStreamEvent =
  | { type: "started" }
  | ({ type: "meta" } & AiSearchStreamMeta)
  | { type: "card"; index: number; business: Business }
  | { type: "finished" }
  | { type: "error"; message: string };
