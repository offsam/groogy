/**
 * Photos / certificates from a fetched homepage (Wix, WordPress, static HTML).
 * Heuristics first: skip logos and builder chrome; keep portraits and cert scans.
 */

const IMG_EXT_RE = /\.(?:jpe?g|png|webp|gif|avif)(?:$|\?)/i;
const CERT_RE = /cert|diploma|certificate|notar|apostille|license|licen[cs]e/i;
const LOGO_RE =
  /logo|favicon|icon|sprite|watermark|badge|button|placeholder|1x1|pixel\.gif|emoji/i;
const DECORATIVE_RE = /chatgpt%20image|chatgpt-image|wix-logo|parastorage/i;
const SKIP_HOST_RE =
  /googleusercontent\.com\/gadgets|facebook\.com\/tr|doubleclick|gravatar\.com\/avatar\/000/i;

export type ClassifiedSiteImage = {
  url: string;
  kind: "portrait" | "certificate" | "logo" | "skip";
  score: number;
  width: number | null;
  height: number | null;
  fileHint: string;
};

export type SiteMediaPick = {
  portrait: string | null;
  certificates: string[];
  logos: string[];
};

export function canonicalMediaUrl(raw: string): string {
  let url = raw.trim();
  if (!url) return "";
  try {
    url = url.replace(/&amp;/g, "&");
    const u = new URL(url);
    if (u.hostname === "static.wixstatic.com") {
      const media = u.pathname.split("/v1/")[0] || u.pathname;
      return `${u.origin}${media}`;
    }
    u.hash = "";
    return u.toString();
  } catch {
    return url.split("?")[0] ?? url;
  }
}

function fileHint(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname).toLowerCase();
  } catch {
    try {
      return decodeURIComponent(url).toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  }
}

function fillSize(url: string): { width: number | null; height: number | null } {
  const w = url.match(/[?/_]w[_=](\d{2,4})/i)?.[1];
  const h = url.match(/[?/_]h[_=](\d{2,4})/i)?.[1];
  const fill = url.match(/\/fill\/w_(\d{2,4})(?:,h_(\d{2,4}))?/i);
  const wixFill = url.match(/w_(\d{2,4})%2Ch_(\d{2,4})/i);
  const width = Number(fill?.[1] || wixFill?.[1] || w || "") || null;
  const height = Number(fill?.[2] || wixFill?.[2] || h || "") || null;
  return { width, height };
}

export function looksLikeLogoUrl(url: string | null | undefined): boolean {
  if (!url) return true;
  const hint = fileHint(url);
  if (LOGO_RE.test(hint) || hint.endsWith(".svg") || hint.endsWith(".ico")) {
    return true;
  }
  return false;
}

export function extractImageUrlsFromHtml(
  html: string,
  pageUrl?: string,
): string[] {
  const found: string[] = [];
  const push = (raw: string | undefined) => {
    const t = (raw || "").trim();
    if (!t || t.startsWith("data:")) return;
    if (!/^https?:\/\//i.test(t) && !t.startsWith("/")) return;
    let abs = t;
    if (pageUrl && !/^https?:\/\//i.test(t)) {
      try {
        abs = new URL(t, pageUrl).toString();
      } catch {
        return;
      }
    }
    if (!/^https?:\/\//i.test(abs)) return;
    found.push(abs);
  };

  for (const m of html.matchAll(
    /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/gi,
  )) {
    push(m[1]);
  }
  for (const m of html.matchAll(
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/gi,
  )) {
    push(m[1]);
  }
  for (const m of html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    push(m[1]);
  }
  for (const m of html.matchAll(/<img\b[^>]*\bsrcset=["']([^"']+)["']/gi)) {
    for (const part of (m[1] || "").split(",")) {
      push(part.trim().split(/\s+/)[0]);
    }
  }
  for (const m of html.matchAll(
    /https?:\/\/static\.wixstatic\.com\/media\/[^\s"'<>)]+/gi,
  )) {
    push(m[0].replace(/&quot;/g, "").replace(/\\u002F/g, "/"));
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of found) {
    const key = canonicalMediaUrl(url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

export function classifySiteImage(rawUrl: string): ClassifiedSiteImage {
  const url = canonicalMediaUrl(rawUrl);
  const hint = fileHint(rawUrl);
  const { width, height } = fillSize(rawUrl);
  const maxEdge = Math.max(width || 0, height || 0);
  const isOriginal = !/\/v1\//i.test(rawUrl);

  if (
    !url ||
    SKIP_HOST_RE.test(url) ||
    DECORATIVE_RE.test(hint) ||
    hint.endsWith(".svg") ||
    hint.endsWith(".ico")
  ) {
    return { url, kind: "skip", score: 0, width, height, fileHint: hint };
  }
  if (!IMG_EXT_RE.test(hint) && !/wixstatic\.com\/media\//i.test(url)) {
    return { url, kind: "skip", score: 0, width, height, fileHint: hint };
  }
  try {
    const host = new URL(url).hostname;
    if (
      host !== "static.wixstatic.com" &&
      /quality_auto|enc_avif|\/v1\/fill/i.test(hint)
    ) {
      return { url, kind: "skip", score: 0, width, height, fileHint: hint };
    }
  } catch {
    return { url, kind: "skip", score: 0, width, height, fileHint: hint };
  }
  if (maxEdge > 0 && maxEdge < 90) {
    return { url, kind: "skip", score: 0, width, height, fileHint: hint };
  }
  if (LOGO_RE.test(hint)) {
    return { url, kind: "logo", score: maxEdge, width, height, fileHint: hint };
  }
  if (CERT_RE.test(hint)) {
    const score = 80 + Math.min(maxEdge, 1600) / 20 + (isOriginal ? 10 : 0);
    return {
      url,
      kind: "certificate",
      score,
      width,
      height,
      fileHint: hint,
    };
  }

  let score = 10 + Math.min(maxEdge || 400, 1600) / 16;
  if (/\.jpe?g(?:$|\?)/i.test(hint)) score += 18;
  if (isOriginal) score += 22;
  if (height && width && height / width >= 1.15) score += 36;
  if (width && height && width / height >= 1.6 && maxEdge >= 800) {
    // Wide header / banner — weaker than a headshot.
    score -= 12;
  }
  return {
    url,
    kind: "portrait",
    score,
    width,
    height,
    fileHint: hint,
  };
}

export function pickSiteMedia(urls: string[]): SiteMediaPick {
  const classified = urls.map(classifySiteImage);
  const portraits = classified
    .filter((c) => c.kind === "portrait")
    .sort((a, b) => b.score - a.score);
  const certificates = classified
    .filter((c) => c.kind === "certificate")
    .sort((a, b) => b.score - a.score);
  const logos = classified.filter((c) => c.kind === "logo");

  const seenCert = new Set<string>();
  const certUrls: string[] = [];
  for (const c of certificates) {
    if (seenCert.has(c.url)) continue;
    seenCert.add(c.url);
    certUrls.push(c.url);
    if (certUrls.length >= 6) break;
  }

  return {
    portrait: portraits[0]?.url ?? null,
    certificates: certUrls,
    logos: logos.map((c) => c.url),
  };
}

const CONTENT_PATH_RE =
  /^\/(contact|contacts|contact-us|about|about-us|menu|services|service|our-services|pricing|prices|price-list|treatments|book-online|visit|new-here|times|service-times|schedule|ministries|ministry|connect|location|locations)\/?$/i;

/** Same-origin paths that actually appear as links — do not guess /menu. */
export function linkedContentPaths(html: string, pageUrl: string): string[] {
  let origin: string;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return [];
  }
  const paths = new Set<string>();
  for (const m of html.matchAll(/href=["']([^"']+)["']/gi)) {
    const href = (m[1] || "").trim();
    if (!href || href.startsWith("#") || href.startsWith("mailto:")) continue;
    try {
      const abs = new URL(href, pageUrl);
      if (abs.origin !== origin) continue;
      const path = abs.pathname.replace(/\/+$/, "") || "/";
      if (path === "/") continue;
      if (CONTENT_PATH_RE.test(path)) paths.add(path.startsWith("/") ? path : `/${path}`);
    } catch {
      /* ignore */
    }
  }
  return [...paths].slice(0, 8);
}
