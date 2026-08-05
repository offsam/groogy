/**
 * Unit tests for near-duplicate street place matching (no DB).
 */
import assert from "node:assert/strict";
import { isSamePhysicalStreetPlace } from "./location-same-place.ts";

assert.equal(
  isSamePhysicalStreetPlace(
    {
      address_line: "835 Indusrtial Hwy, Unit 1",
      city: "Cinnaminson",
      state_code: "US-NJ",
      postal_code: "08077",
    },
    {
      addressLine: "835 Industrial Hwy #1",
      city: "Cinnaminson",
      state: "NJ",
      postalCode: "08077",
    },
  ),
  true,
  "typo Industrial twin",
);

assert.equal(
  isSamePhysicalStreetPlace(
    {
      address_line: "835 Industrial Hwy",
      city: "Cinnaminson",
      state_code: "US-NJ",
    },
    {
      addressLine: "900 Industrial Hwy",
      city: "Cinnaminson",
      state: "NJ",
    },
  ),
  false,
  "different house number",
);

assert.equal(
  isSamePhysicalStreetPlace(
    {
      address_line: "100 Main St",
      city: "Brea",
      state_code: "US-CA",
    },
    {
      addressLine: "100 Main St",
      city: "Irvine",
      state: "CA",
    },
  ),
  false,
  "different city",
);

console.log("OK: location-same-place matching");
