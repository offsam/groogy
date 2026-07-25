/**
 * Strip internal import dumps (---FB_ENTITY_...---, JSON sources, etc.)
 * so public business pages only show human-readable copy.
 */
export function sanitizePublicDescription(
  description: string | null | undefined,
): string | null {
  if (description == null) return null;

  const marker = /\n?^---[A-Z0-9_]{3,}---\s*$/m;
  const match = marker.exec(description);
  const cleaned = (match ? description.slice(0, match.index) : description)
    .replace(/\s+$/g, "")
    .trim();

  return cleaned.length > 0 ? cleaned : null;
}
