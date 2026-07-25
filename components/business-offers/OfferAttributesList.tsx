import type { BusinessOffer, BusinessOfferType } from "@/types/business-offer";
import { ATTRIBUTE_FIELDS } from "@/lib/business-offers/validation";

type OfferAttributesListProps = {
  offer: BusinessOffer;
};

function formatValue(key: string, value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  if (Array.isArray(value)) return value.join(", ");
  if (key === "deposit_amount" && typeof value === "number") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(value);
  }
  return String(value);
}

export function OfferAttributesList({ offer }: OfferAttributesListProps) {
  const fields = ATTRIBUTE_FIELDS[offer.offerType as BusinessOfferType] ?? [];
  const attrs = offer.attributes as Record<string, unknown>;
  const rows = fields
    .map((field) => ({
      label: field.label,
      value: formatValue(field.key, attrs[field.key]),
    }))
    .filter((row) => row.value !== "—");

  if (rows.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-slate-900">Характеристики</h2>
      <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:justify-between sm:gap-4"
          >
            <dt className="text-sm text-slate-500">{row.label}</dt>
            <dd className="text-sm font-medium text-slate-900">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
