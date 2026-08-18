// One-off build script — converts the us-atlas states topology into a lean
// GeoJSON FeatureCollection keyed by our own ISO state code (US-CA, US-NY…)
// for the home map's state-outline choropleth. Re-run only if the source
// topology package is upgraded; output is committed as a static asset.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as topojson from "topojson-client";
import { presimplify, simplify } from "topojson-simplify";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..");

const NAME_TO_CODE = {
  Alabama: "US-AL", Alaska: "US-AK", Arizona: "US-AZ", Arkansas: "US-AR",
  California: "US-CA", Colorado: "US-CO", Connecticut: "US-CT",
  Delaware: "US-DE", "District of Columbia": "US-DC", Florida: "US-FL",
  Georgia: "US-GA", Hawaii: "US-HI", Idaho: "US-ID", Illinois: "US-IL",
  Indiana: "US-IN", Iowa: "US-IA", Kansas: "US-KS", Kentucky: "US-KY",
  Louisiana: "US-LA", Maine: "US-ME", Maryland: "US-MD",
  Massachusetts: "US-MA", Michigan: "US-MI", Minnesota: "US-MN",
  Mississippi: "US-MS", Missouri: "US-MO", Montana: "US-MT",
  Nebraska: "US-NE", Nevada: "US-NV", "New Hampshire": "US-NH",
  "New Jersey": "US-NJ", "New Mexico": "US-NM", "New York": "US-NY",
  "North Carolina": "US-NC", "North Dakota": "US-ND", Ohio: "US-OH",
  Oklahoma: "US-OK", Oregon: "US-OR", Pennsylvania: "US-PA",
  "Rhode Island": "US-RI", "South Carolina": "US-SC",
  "South Dakota": "US-SD", Tennessee: "US-TN", Texas: "US-TX",
  Utah: "US-UT", Vermont: "US-VT", Virginia: "US-VA",
  Washington: "US-WA", "West Virginia": "US-WV", Wisconsin: "US-WI",
  Wyoming: "US-WY", "Puerto Rico": "US-PR",
};

const topoPath = path.join(root, "node_modules", "us-atlas", "states-10m.json");
const rawTopo = JSON.parse(readFileSync(topoPath, "utf8"));
// Coarse simplification — this layer only needs to read as a recognizable
// state silhouette at national zoom, not survey-accurate coastlines.
const topo = simplify(presimplify(rawTopo), 0.02);
const geo = topojson.feature(topo, topo.objects.states);

const features = geo.features
  .map((f) => {
    const name = f.properties?.name;
    const code = NAME_TO_CODE[name];
    if (!code) return null;
    return {
      type: "Feature",
      properties: { code },
      geometry: f.geometry,
    };
  })
  .filter(Boolean);

const out = { type: "FeatureCollection", features };
const outPath = path.join(root, "public", "data", "us-states.geo.json");
writeFileSync(outPath, JSON.stringify(out));
console.log(`wrote ${features.length} states to ${outPath}`);
