/**
 * Strip internal import dumps (---FB_ENTITY_...---, JSON sources, etc.)
 * so public business pages only show human-readable copy.
 * Also collapses truncated duplicate paragraphs and builder chrome.
 */
export function sanitizePublicDescription(
  description: string | null | undefined,
): string | null {
  if (description == null) return null;

  const marker = /\n?^---[A-Z0-9_]{3,}---\s*$/m;
  const match = marker.exec(description);
  let cleaned = (match ? description.slice(0, match.index) : description)
    .replace(/\s+$/g, "")
    .trim();

  cleaned = cleanEnrichDescription(cleaned) ?? cleaned;

  return cleaned.length > 0 ? cleaned : null;
}

/** Dedup truncated blurb + strip Squarespace / builder nav glued into «О нас». */
export function cleanEnrichDescription(
  description: string | null | undefined,
): string | null {
  if (description == null) return null;
  let text = description.replace(/\u00a0/g, " ").trim();
  if (!text) return null;

  const chromeLine =
    /^(?:текущая\s+страница\s*:|current\s+page\s*:|клиентские\s+проекты|client\s+projects|свяжитесь\s+со\s+мной\s*:?|contact\s+me\s*:?)\s*$/i;
  const chromeTail =
    /\s*(?:ПОРТРЕТЫ\s+ДЛЯ\s+МИРА|Клиентские\s+проекты|Красота\s+Мода\s+Портреты|Текущая\s+страница\s*:.*|Current\s+page\s*:.*|Свяжитесь\s+со\s+мной\s*:?|Contact\s+me\s*:?)\s*$/i;

  const lines: string[] = [];
  for (const line of text.split(/\n/)) {
    const s0 = line.trim();
    if (!s0) {
      lines.push("");
      continue;
    }
    if (chromeLine.test(s0) && s0.length < 80) continue;
    let s = s0;
    let prev = "";
    while (prev !== s) {
      prev = s;
      s = s.replace(chromeTail, "").trim();
    }
    if (s) lines.push(s);
  }
  text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) return null;

  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paras.length >= 2) {
    const kept: string[] = [];
    for (let i = 0; i < paras.length; i++) {
      const para = paras[i]!;
      const stem = para.replace(/[….]+$/g, "").trim();
      let covered = false;
      for (let j = i + 1; j < paras.length; j++) {
        const other = paras[j]!.replace(/[….]+$/g, "").trim();
        if (stem.length >= 40 && other.startsWith(stem.slice(0, Math.min(stem.length, 120)))) {
          covered = true;
          break;
        }
        if (stem.length >= 40 && other.includes(stem.slice(0, 80))) {
          covered = true;
          break;
        }
      }
      if (covered) continue;
      if (
        stem.length >= 40 &&
        kept.some((k) => k.startsWith(stem.slice(0, 80)) || k.includes(stem.slice(0, 80)))
      ) {
        continue;
      }
      kept.push(para);
    }
    if (kept.length) text = kept.join("\n\n").trim();
  }

  return text || null;
}
