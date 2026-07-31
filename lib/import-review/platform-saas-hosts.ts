/**
 * Booking / SaaS hosts: may yield booking_url (and tenant-matched services),
 * but must never become the card's phone / email / Instagram / website identity.
 *
 * Keep in sync with scripts/business-enrich/platform_saas_hosts.py.
 */

const PLATFORM_SAAS_HOSTS = [
  "dikidi.net",
  "dikidi.app",
  "support.dikidi.app",
  "glossgenius.com",
  "fresha.com",
  "vagaro.com",
  "booksy.com",
  "mindbodyonline.com",
  "mindbody.io",
  "calendly.com",
  "setmore.com",
  "squareup.com",
  "square.site",
  "book.squareup.com",
  "acuityscheduling.com",
  "styleseat.com",
  "schedulicity.com",
  "gentlemint.com",
  "treatwell.com",
  "salonized.com",
  "phorest.com",
  "timely.com",
  "booker.com",
  "boulevard.io",
];

function hostOnly(raw: string | null | undefined): string {
  const value = (raw || "").trim().toLowerCase();
  if (!value) return "";
  let host = value;
  try {
    if (value.includes("://") || value.startsWith("//") || value.includes("/")) {
      const withProto = value.includes("://")
        ? value
        : `https://${value.replace(/^\/+/, "")}`;
      host = new URL(withProto).hostname.toLowerCase();
    }
  } catch {
    host = value.split("/")[0] || "";
  }
  return host.replace(/^www\./, "");
}

/** True when URL/host is a shared booking SaaS platform. */
export function isPlatformSaasHost(raw: string | null | undefined): boolean {
  const host = hostOnly(raw);
  if (!host) return false;
  return PLATFORM_SAAS_HOSTS.some(
    (h) => host === h || host.endsWith(`.${h}`),
  );
}

/** Prefer storing SaaS URLs as booking_url, never as website. */
export function bookingUrlFromMaybeSaas(
  url: string | null | undefined,
): string | null {
  const trimmed = (url || "").trim();
  if (!trimmed) return null;
  if (!isPlatformSaasHost(trimmed)) return null;
  return trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
}
