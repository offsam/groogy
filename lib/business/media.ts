/** Category SVGs and generic placeholders are not real business photos. */
export function isPlaceholderBusinessImage(url: string | null | undefined): boolean {
  if (!url) return true;
  return (
    url.includes("/images/categories/") ||
    url.endsWith("placeholder.svg") ||
    url.endsWith("/placeholder.svg")
  );
}

export function hasRealBusinessPhoto(url: string | null | undefined): boolean {
  return !isPlaceholderBusinessImage(url);
}
