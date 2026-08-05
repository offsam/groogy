/**
 * Hosts shared by many unrelated cards: socials, catalogs and directories,
 * flipbook viewers, link shorteners, form builders, big marketplaces.
 * Identity there lives in the path, so an equal hostname is not proof that two
 * cards describe the same business — duplicate matching must ignore them.
 */
const SHARED_HOSTS = [
  // Socials / messengers
  "instagram.com",
  "facebook.com",
  "fb.com",
  "fb.me",
  "t.me",
  "telegram.me",
  "tiktok.com",
  "yelp.com",
  "youtube.com",
  "youtu.be",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "wa.me",
  "whatsapp.com",
  "vk.com",
  "vk.ru",
  "ok.ru",
  // Link-in-bio, shorteners, forms, shared Google surfaces
  "linktr.ee",
  "taplink.cc",
  "beacons.ai",
  "bit.ly",
  "goo.gl",
  "maps.app.goo.gl",
  "maps.apple.com",
  "forms.gle",
  "docs.google.com",
  "sites.google.com",
  "drive.google.com",
  // Flipbook / catalog viewers (directory issues live under one host)
  "fliphtml5.com",
  "pubhtml5.com",
  "anyflip.com",
  "issuu.com",
  "calameo.com",
  "joomag.com",
  // Ticketing / event platforms shared by many organizers
  "eventbrite.com",
  "loveoverse.com",
  // App stores / OS vendor chrome
  "apps.apple.com",
  "itunes.apple.com",
  "apple.com",
  "apple.com.cn",
  "apple.co",
  "icloud.com",
  "play.google.com",
  "appgallery.huawei.com",
  "huawei.com",
  "rustore.ru",
  // Booking SaaS support / marketing
  "support.dikidi.app",
  "dikidi.app",
  "dikidi.net",
  // Russian-speaking directories we import from
  "svoi.us",
  "russianorangepages.com",
  "bostonrussianpages.com",
  "yellowpages.com",
  "to4ka.us",
  "api.to4ka.us",
  // Civic / park portals from ROP chrome — never a card's own site.
  // Real businesses that leaked from the same sidebar (fchconstruction.org,
  // liveattheshell.org, art-a-fair.com) are NOT listed here: when an admin
  // sets one as the card website, enrich must mine it. Directory BFS still
  // refuses related links from ROP/Svoi.
  "ocparks.com",
  "themuck.org",
  // to4ka catalog ads / stuffed listing.url
  "bazar.club",
  "apteka03.online",
  "madbid.com",
];

/** Shops here get a personal subdomain, so only the bare host is shared. */
const SHARED_HOSTS_EXACT = ["etsy.com"];

const SHARED_HOST_PATTERNS = [/(?:yellow|orange|russian).{0,3}pages\./i];

/** True when the hostname is shared by many cards and cannot identify one. */
export function isSharedNonIdentityHost(
  raw: string | null | undefined,
): boolean {
  const host = (raw || "")
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
  if (!host) return false;
  if (SHARED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
    return true;
  }
  if (SHARED_HOSTS_EXACT.includes(host)) return true;
  return SHARED_HOST_PATTERNS.some((re) => re.test(host));
}
