/** Shared Leaflet basemap — Carto Voyager when keyed, else Esri (no watermark). */

/**
 * CARTO raster tiles now require a free API key
 * (https://carto.com/basemaps/apikey). Without it they serve
 * "API KEY REQUIRED" watermarks.
 *
 * Prefer NEXT_PUBLIC_CARTO_API_KEY for Voyager. Fallback is Esri World Street
 * Map — no key, no Leaflet flag chrome (attributionControl stays off).
 */
const CARTO_KEY = process.env.NEXT_PUBLIC_CARTO_API_KEY?.trim() ?? "";

export const OSM_TILE_URL = CARTO_KEY
  ? `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(CARTO_KEY)}`
  : "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}";

/**
 * Required by OSM ODbL + tile provider terms.
 * Show as plain text credit; Leaflet's decorative flag is hidden in CSS.
 */
export const OSM_ATTRIBUTION = CARTO_KEY
  ? '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>'
  : '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> &copy; <a href="https://www.esri.com/" target="_blank" rel="noreferrer">Esri</a>';

/** Attribution control options — no Leaflet flag/prefix, just the tile credit. */
export const MAP_ATTRIBUTION_CONTROL = {
  prefix: false as const,
  position: "bottomright" as const,
};
