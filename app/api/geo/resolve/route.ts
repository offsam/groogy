import { NextResponse } from "next/server";
import { resolveCountyFromLatLng } from "@/lib/regions/fcc";
import {
  getRegionHubByCountyGeoid,
  resolveRegionHub,
} from "@/lib/regions/hubs";
import { countyInLabel } from "@/lib/brand";

export async function POST(request: Request) {
  let body: { lat?: unknown; lng?: unknown };
  try {
    body = (await request.json()) as { lat?: unknown; lng?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "invalid_coords" }, { status: 400 });
  }

  const county = await resolveCountyFromLatLng(lat, lng);
  if (!county) {
    return NextResponse.json({ error: "county_not_found" }, { status: 404 });
  }

  const hub =
    getRegionHubByCountyGeoid(county.countyGeoid) ??
    resolveRegionHub({ countyGeoid: null });

  const knownHub = Boolean(getRegionHubByCountyGeoid(county.countyGeoid));
  const inLabel =
    knownHub
      ? hub.inLabel
      : countyInLabel(county.countyGeoid, county.countyName) ?? hub.inLabel;

  return NextResponse.json({
    countyGeoid: county.countyGeoid,
    countyName: county.countyName,
    hubId: knownHub ? hub.id : null,
    inLabel,
    panoramaUrl: knownHub ? hub.panoramaUrl : hub.panoramaUrl,
    shortLabel: knownHub ? hub.shortLabel : county.countyName,
    mapCenter: hub.mapCenter,
    mapZoom: hub.mapZoom,
    exampleQueries: hub.exampleQueries,
    knownHub,
  });
}
