/**
 * Live «Обогатить» address rewrite helpers (Start CDL-style dump → site street).
 * Run: npx tsx lib/admin/published-finalize-address.test.ts
 */
import {
  extractUsStreetAddresses,
  extractSpaPostalAddressLines,
  preferWebsiteStreet,
  streetIdentity,
} from "@/lib/admin/paste-enrich";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const cardDump = "2605 U.S. 130, Cinnaminson, NJ, USA";
const siteBlob = `
School location
835 Industrial Hwy, Unit 1, Cinnaminson, NJ 08077
7213 truck driver vacancies per day
Earn $1800+/Week
`;

const hits = extractUsStreetAddresses(siteBlob).filter(
  (a) =>
    a.addressLine &&
    !/\b(?:vacanc(?:y|ies)|hiring|jobs?\s+per\s+day|truck\s+driver|earn\s+\$)\b/i.test(
      a.addressLine,
    ),
);

assert(hits.length >= 1, `expected Industrial street, got ${JSON.stringify(hits)}`);
const best = hits[0]!;
assert(
  /industrial/i.test(best.addressLine || ""),
  `expected Industrial Hwy, got ${best.addressLine}`,
);
assert(
  preferWebsiteStreet(cardDump, best.addressLine),
  "site Industrial must rewrite U.S. 130 dump",
);
assert(
  streetIdentity(cardDump) !== streetIdentity(best.addressLine),
  "street identities must differ",
);
assert(
  !preferWebsiteStreet(best.addressLine, best.addressLine),
  "same street must not rewrite itself",
);

const spaJs = `streetAddress:"600 N Brand Blvd Ste 570",addressLocality:"Glendale",addressRegion:"CA",postalCode:"91203"},{streetAddress:"9701 Fair Oaks Blvd.",addressLocality:"Fair Oaks",addressRegion:"CA",postalCode:"95628"`;
const spaLines = extractSpaPostalAddressLines(spaJs);
assert(spaLines.length >= 2, `expected 2 SPA offices, got ${JSON.stringify(spaLines)}`);
assert(
  spaLines.some((l) => /Brand/i.test(l)),
  "Glendale Brand Blvd",
);
assert(
  spaLines.some((l) => /Fair Oaks/i.test(l)),
  "Fair Oaks office",
);
const fromSpa = extractUsStreetAddresses(spaLines.join("\n"));
assert(
  fromSpa.length >= 2,
  `SPA lines must parse as US streets, got ${JSON.stringify(fromSpa)}`,
);

console.log("OK: published-finalize address rewrite (Start CDL)");
