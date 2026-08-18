/**
 * Run: npx tsx lib/admin/website-assets.test.ts
 */
import {
  canonicalMediaUrl,
  classifySiteImage,
  extractImageUrlsFromHtml,
  linkedContentPaths,
  pickSiteMedia,
} from "./website-assets";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const logo =
  "https://static.wixstatic.com/media/534338_5e62fcdab6c341799d8cb75ed7a1ba16~mv2.png/v1/fill/w_254,h_246,al_c,q_85/LOGO.png";
const cert =
  "https://static.wixstatic.com/media/534338_95cae00e765e4a218ca3d50087b76ab9~mv2_d_4915_3188_s_4_2.jpg/v1/fill/w_1346,h_858,al_c,q_85/FINAL%20CERT.jpg";
const cert2 =
  "https://static.wixstatic.com/media/534338_5c3144c1ff894a24a07eb41512ad4142~mv2.jpg/v1/fill/w_1124,h_858,al_c,q_85/WTI%20Immig%20Law%20Spec%20Cert_edited.jpg";
const portrait =
  "https://static.wixstatic.com/media/534338_f9e132cdf354442b9b596570fc7d5377~mv2.jpg/v1/crop/x_305,y_0,w_1415,h_2048/fill/w_636,h_918,al_c,q_85/photo.jpg";
const originalJpg =
  "https://static.wixstatic.com/media/534338_9a8e0e9dc4f24f40a0c058e74d8fd113~mv2.jpg";

assert(
  canonicalMediaUrl(logo) ===
    "https://static.wixstatic.com/media/534338_5e62fcdab6c341799d8cb75ed7a1ba16~mv2.png",
  "wix canonical strips fill",
);
assert(classifySiteImage(logo).kind === "logo", "logo filename");
assert(classifySiteImage(cert).kind === "certificate", "final cert");
assert(classifySiteImage(cert2).kind === "certificate", "wti cert");
assert(classifySiteImage(portrait).kind === "portrait", "portrait crop");

const pick = pickSiteMedia([logo, cert, cert2, portrait, originalJpg]);
assert(pick.portrait !== logo, "must not pick logo as cover");
assert(
  pick.portrait === canonicalMediaUrl(portrait) ||
    pick.portrait === canonicalMediaUrl(originalJpg),
  `portrait got ${pick.portrait}`,
);
assert(pick.certificates.length >= 2, `certs ${pick.certificates.length}`);

const html = `
  <a href="/about">About</a>
  <a href="https://www.translatorpro.org/contact">Contact</a>
  <img src="${logo}" />
  <img src="${cert}" />
`;
const links = linkedContentPaths(html, "https://www.translatorpro.org/");
assert(links.includes("/about"), "linked about");
assert(links.includes("/contact"), "linked contact");
assert(!links.includes("/menu"), "do not invent /menu");

const bogus = extractImageUrlsFromHtml(
  `src="quality_auto/FINAL%20CERT.jpg"`,
  "https://www.translatorpro.org/",
);
assert(
  !bogus.some((u) => /translatorpro\.org\/quality_auto/i.test(u)),
  "skip fill-path fragments",
);

const imgs = extractImageUrlsFromHtml(html, "https://www.translatorpro.org/");
assert(imgs.some((u) => /LOGO/i.test(u)), "extract logo img");

console.log("website-assets ok");
