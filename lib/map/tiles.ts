/** Shared Leaflet basemap — Carto Voyager (OSM data). */

export const OSM_TILE_URL =
  "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";

/**
 * Required by OSM ODbL + CARTO tile terms.
 * Show as plain text credit; Leaflet's decorative flag is hidden in CSS.
 */
export const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>';

/** Attribution control options — no Leaflet flag/prefix, just the tile credit. */
export const MAP_ATTRIBUTION_CONTROL = {
  prefix: false as const,
  position: "bottomright" as const,
};
