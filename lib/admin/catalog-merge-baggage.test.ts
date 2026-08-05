/**
 * Catalog merge baggage: fill-empty + contact_links + secondary source.
 * Run: npx tsx lib/admin/catalog-merge-baggage.test.ts
 */
import {
  buildCatalogMergeBaggage,
  enrichMergeDescription,
  normalizeMergeSourceUrl,
  splitDirectoryRoleTitle,
  unionContactLinks,
} from "./catalog-merge-baggage";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const merged = unionContactLinks(
  [{ channel: "whatsapp", value: "+15551234567" }],
  [{ channel: "tiktok", value: "@nails_la" }],
);
assert(
  merged.some((l) => l.channel === "tiktok") &&
    merged.some((l) => l.channel === "whatsapp"),
  "union must keep WhatsApp and add TikTok",
);

const result = buildCatalogMergeBaggage({
  keepKind: "business",
  dropKind: "business",
  keep: {
    phone: "+1 714 555 0100",
    contact_links: [],
    source_url: "https://t.me/rich_group/1",
    description: "Коротко",
  },
  drop: {
    name: "Donor Spa",
    phone: "+1 949 555 0199",
    contact_links: [
      { channel: "tiktok", value: "https://tiktok.com/@donor" },
    ],
    source_url: "https://facebook.com/groups/poor/posts/99",
    description: "Длинное описание специалиста с TikTok и записью.".repeat(3),
    booking_url: "https://calendly.com/donor",
  },
});

assert(result.patch.phone === undefined, "must not overwrite keep phone");
assert(
  result.patch.booking_url === "https://calendly.com/donor",
  "must fill booking_url",
);

const enriched = buildCatalogMergeBaggage({
  keepKind: "professional",
  dropKind: "professional",
  keep: {
    display_name: "Переводчик",
    description: "Делаю переводы и редактирую тексты для бизнеса.",
    contact_links: [],
  },
  drop: {
    display_name: "Репетитор",
    description:
      "Делаю переводы и редактирую тексты для бизнеса. Также репетитор английского, русского и украинского онлайн.",
    contact_links: [],
  },
});
assert(
  typeof enriched.patch.description === "string" &&
    String(enriched.patch.description).includes("репетитор"),
  "description must be enriched with unique donor facts",
);
assert(
  String(enriched.patch.description).startsWith("Делаю переводы"),
  "keep description base must stay",
);

const onlyKeep = enrichMergeDescription(
  "Короткое описание специалиста про переводы.",
  "Короткое описание специалиста про переводы.",
);
assert(onlyKeep === null, "near-dup description must not rewrite");
assert(
  Array.isArray(result.patch.contact_links) &&
    (result.patch.contact_links as { channel: string }[]).some(
      (l) => l.channel === "tiktok",
    ),
  "must union TikTok into contact_links",
);
assert(result.patch.source_url === undefined, "must keep primary source_url");
assert(
  result.secondarySourceUrl ===
    "https://facebook.com/groups/poor/posts/99",
  "must preserve donor source as secondary",
);
assert(result.filled.includes("второй источник"), "filled labels secondary");

const fillSource = buildCatalogMergeBaggage({
  keepKind: "professional",
  dropKind: "business",
  keep: { display_name: "Rich", source_url: null, contact_links: [] },
  drop: {
    name: "Poor Biz",
    source_url: "https://svoi.us/biz/1",
    source_kind: "directory",
    contact_links: [],
  },
});
assert(
  fillSource.patch.source_url === "https://svoi.us/biz/1",
  "empty keep source gets donor url",
);
assert(fillSource.secondarySourceUrl === null, "no secondary when keep empty");

assert(
  normalizeMergeSourceUrl("https://T.ME/x/1/") ===
    normalizeMergeSourceUrl("https://t.me/x/1"),
  "source url normalize",
);

const roles = splitDirectoryRoleTitle(
  "Репетитор английского, русского, украинскогою Писатель, редактор, переводчик ОНЛАЙН",
);
assert(
  roles.some((r) => /репетитор/i.test(r)) &&
    roles.some((r) => /писател/i.test(r)) &&
    roles.some((r) => /редактор/i.test(r)),
  "directory title must split into role services",
);

console.log("OK: catalog-merge-baggage");
