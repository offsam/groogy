/** Visible map credit when Leaflet's corner control would be clipped (home 3D map). */
export function MapAttribution({ className }: { className?: string }) {
  return (
    <p className={className}>
      ©{" "}
      <a
        className="underline decoration-slate-300 underline-offset-2 hover:text-slate-700"
        href="https://www.openstreetmap.org/copyright"
        rel="noreferrer"
        target="_blank"
      >
        OpenStreetMap
      </a>{" "}
      ©{" "}
      <a
        className="underline decoration-slate-300 underline-offset-2 hover:text-slate-700"
        href="https://carto.com/attributions"
        rel="noreferrer"
        target="_blank"
      >
        CARTO
      </a>
    </p>
  );
}
