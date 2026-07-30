import type { PlatformEvent } from "@/lib/events/queries";
import type { CommentRecommendation } from "@/lib/import-review/recommendation-queries";

/** Comment recommendation → EventProfileView / EventCard (admin preview). */
export function recommendationToEventPreview(
  item: CommentRecommendation,
): PlatformEvent {
  const title =
    item.display_name?.trim() ||
    item.comment_texts?.[0]?.trim()?.slice(0, 80) ||
    "Событие";

  let telegramUrl: string | null = null;
  for (const w of item.websites || []) {
    const m = w.match(/(?:t\.me|telegram\.me)\/([A-Za-z0-9_]{4,32})/i);
    if (
      m?.[1] &&
      !/^\d+$/.test(m[1]) &&
      !["c", "s"].includes(m[1].toLowerCase())
    ) {
      telegramUrl = `https://t.me/${m[1]}`;
      break;
    }
  }

  let registration: string | null = item.registration_url?.trim() || null;
  if (!registration) {
    for (const w of item.websites || []) {
      const s = w.trim();
      if (!/^https?:\/\//i.test(s)) continue;
      if (/instagram\.com|facebook\.com|t\.me\/|telegram\.me|wa\.me/i.test(s)) {
        continue;
      }
      registration = s;
      break;
    }
  }

  const phone =
    (item.phones || [])
      .map((p) => p.trim())
      .find((p) => p.replace(/\D/g, "").length >= 10) || null;

  const startsAtRaw = item.event_at?.trim() || null;
  const startsAt =
    item.starts_at ||
    (startsAtRaw && !Number.isNaN(Date.parse(startsAtRaw))
      ? new Date(startsAtRaw).toISOString()
      : startsAtRaw);

  return {
    id: item.id,
    title,
    slug: `preview-${item.id.slice(0, 8)}`,
    description:
      item.request_snippets?.[0] ||
      item.comment_texts?.[0] ||
      null,
    status: item.status || "pending",
    starts_at: startsAt,
    ends_at: item.ends_at ?? null,
    event_at_label: startsAtRaw,
    city: item.city,
    state_code: item.state_code ?? null,
    address_line: item.address_line ?? null,
    venue_name: item.venue_name ?? null,
    latitude: item.latitude ?? null,
    longitude: item.longitude ?? null,
    cover_image_url: item.cover_image_url,
    registration_url: registration,
    source_url: item.source_post_urls?.[0] ?? null,
    source_posted_at: item.last_posted_at,
    source_body: item.comment_texts?.join("\n\n") ?? null,
    format: "offline",
    price_label: item.price_label ?? null,
    payment_methods: item.payment_methods ?? null,
    phone,
    telegram_url: telegramUrl,
    category: item.category ?? null,
    tags: item.tags ?? null,
    source_language: item.source_language ?? null,
    title_original: item.title_original ?? null,
    description_original: item.description_original ?? null,
    audience_label: item.audience_label ?? null,
    external_source: item.external_source ?? null,
    external_id: item.external_id ?? null,
    created_at: item.created_at,
  };
}
