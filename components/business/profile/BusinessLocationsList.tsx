import { MapPin } from "lucide-react";
import {
  formatBusinessLocationLine,
  type BusinessLocation,
} from "@/types/business-location";

export function BusinessLocationsList({
  locations,
}: {
  locations: BusinessLocation[];
}) {
  if (locations.length === 0) return null;

  return (
    <ul className="mt-3 space-y-2">
      {locations.map((loc) => {
        const line = formatBusinessLocationLine(loc);
        const href =
          loc.googleMapsUrl?.trim() ||
          (line
            ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(line)}`
            : null);
        return (
          <li key={loc.id} className="flex items-start gap-2 text-sm text-slate-600">
            <MapPin
              aria-hidden="true"
              className="mt-0.5 size-3.5 shrink-0 text-slate-400"
            />
            <span className="min-w-0">
              {loc.label ? (
                <span className="font-medium text-slate-800">
                  {loc.label}
                  <span className="text-slate-400"> · </span>
                </span>
              ) : null}
              {href ? (
                <a
                  className="text-slate-700 underline-offset-2 hover:underline"
                  href={href}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {line}
                </a>
              ) : (
                line
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
