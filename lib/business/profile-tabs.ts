export type ProfileTab = {
  id: string;
  label: string;
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
