"use client";

/**
 * Banner when an import-review card has no county_geoid (blocks publish).
 */
export function ReviewLocationUnresolvedBanner({
  countyGeoid,
  city,
  state,
}: {
  countyGeoid?: string | null;
  city?: string | null;
  state?: string | null;
}) {
  if (countyGeoid && /^\d{5}$/.test(countyGeoid)) return null;

  return (
    <div
      className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950"
      role="status"
    >
      <p className="font-medium">Локация не определена</p>
      <p className="mt-0.5 text-amber-900/90">
        Без округа карточку нельзя опубликовать. Укажите ZIP, город и штат
        {city || state ? ` (сейчас: ${[city, state].filter(Boolean).join(", ")})` : ""}
        , адрес или известную группу — либо выберите округ вручную при
        редактировании.
      </p>
    </div>
  );
}
