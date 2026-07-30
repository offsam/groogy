export type ProfileTab = {
  id: string;
  label: string;
  /** Content count shown next to the label; omit for tabs without a count. */
  count?: number;
};

export function tabHref(
  businessSlug: string,
  tabId: string,
  options?: { edit?: boolean },
) {
  const params = new URLSearchParams();
  if (tabId !== "overview") params.set("tab", tabId);
  if (options?.edit) params.set("edit", "1");
  const qs = params.toString();
  return qs
    ? `/business/${businessSlug}?${qs}`
    : `/business/${businessSlug}`;
}
