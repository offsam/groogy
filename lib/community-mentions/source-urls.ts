/** Pure helpers — safe for client components. */

export function thirdPartySourceUrlsFromMentions(
  mentions: Array<{ sourceUrl?: string | null; kind?: string }>,
): string[] {
  const urls: string[] = [];
  for (const m of mentions) {
    if (m.kind === "self_ad") continue;
    const u = m.sourceUrl?.trim();
    if (u && !urls.includes(u)) urls.push(u);
  }
  return urls;
}
