"use client";

import { useEffect, useState } from "react";
import { CityCombobox } from "@/components/master-data/CityCombobox";
import { StateSelect } from "@/components/master-data/StateSelect";
import { getUsStatesAction } from "@/lib/master-data/actions";
import {
  normalizeStructuredAddress,
  type StructuredAddress,
} from "@/lib/address/normalize";
import type { UsStateOption } from "@/types/master-data";

const inputClass =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-blue";

const COUNTY_OPTIONS = [
  "",
  "Orange County",
  "Los Angeles County",
  "San Diego County",
  "Sacramento County",
  "San Francisco County",
  "Riverside County",
  "San Bernardino County",
  "Ventura County",
  "San Mateo County",
] as const;

type AddressFieldsEditorProps = {
  value: StructuredAddress;
  onChange: (next: StructuredAddress) => void;
  /** Used to strip brand/venue text from the street field. */
  businessName?: string | null;
  /** Compact spacing for dialogs. */
  className?: string;
};

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5 text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      {children}
      {hint ? <span className="block text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}

/**
 * Structured business address editor.
 * Street autocomplete via Google Places is paid — not used.
 * City uses free internal CityCombobox (platform_cities).
 */
export function AddressFieldsEditor({
  value,
  onChange,
  businessName,
  className,
}: AddressFieldsEditorProps) {
  const [states, setStates] = useState<UsStateOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await getUsStatesAction();
      if (cancelled || !res.ok) return;
      setStates(res.states);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function patch(partial: Partial<StructuredAddress>) {
    onChange(
      normalizeStructuredAddress({
        ...value,
        ...partial,
        businessName,
      }),
    );
  }

  function onStreetBlur() {
    onChange(
      normalizeStructuredAddress({
        addressLine: value.addressLine,
        city: value.city,
        region: value.region,
        stateCode: value.stateCode,
        postalCode: value.postalCode,
        businessName,
      }),
    );
  }

  return (
    <div className={className ?? "space-y-3"}>
      <Field
        hint="Только улица и suite (123 Main St). Без названия бизнеса, города, CA, ZIP и Orange County."
        label="Улица"
      >
        <input
          className={inputClass}
          placeholder="123 Main St, Ste 200"
          value={value.addressLine ?? ""}
          onBlur={onStreetBlur}
          onChange={(e) =>
            onChange({ ...value, addressLine: e.target.value || null })
          }
        />
      </Field>

      <Field hint="Начните вводить — подсказки из справочника городов." label="Город">
        {states.length > 0 ? (
          <CityCombobox
            className={inputClass}
            placeholder="Irvine"
            stateCode={value.stateCode}
            states={states}
            value={value.city ?? ""}
            onCityChange={(city) => onChange({ ...value, city: city || null })}
            onSelect={(sel) =>
              patch({
                city: sel.city,
                stateCode: sel.stateCode,
              })
            }
          />
        ) : (
          <input
            className={inputClass}
            placeholder="Irvine"
            value={value.city ?? ""}
            onChange={(e) =>
              onChange({ ...value, city: e.target.value || null })
            }
          />
        )}
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Штат">
          {states.length > 0 ? (
            <StateSelect
              className={inputClass}
              states={states}
              value={value.stateCode ?? ""}
              onChange={(code) => patch({ stateCode: code || null })}
            />
          ) : (
            <input
              className={inputClass}
              placeholder="CA"
              value={value.stateCode?.replace(/^US-/, "") ?? ""}
              onChange={(e) => {
                const raw = e.target.value.trim().toUpperCase();
                patch({
                  stateCode: raw
                    ? raw.startsWith("US-")
                      ? raw
                      : `US-${raw.slice(0, 2)}`
                    : null,
                });
              }}
            />
          )}
        </Field>
        <Field hint="5 цифр" label="ZIP">
          <input
            className={inputClass}
            inputMode="numeric"
            maxLength={10}
            placeholder="92618"
            value={value.postalCode ?? ""}
            onChange={(e) => {
              const digits = e.target.value.replace(/[^\d-]/g, "").slice(0, 10);
              onChange({
                ...value,
                postalCode: digits || null,
              });
            }}
            onBlur={() => patch({ postalCode: value.postalCode })}
          />
        </Field>
      </div>

      <Field
        hint="Не дублируйте округ в улице. Нужен только если нет точного города."
        label="Округ (необязательно)"
      >
        <select
          className={inputClass}
          value={value.region ?? ""}
          onChange={(e) =>
            patch({ region: e.target.value || null })
          }
        >
          {COUNTY_OPTIONS.map((opt) => (
            <option key={opt || "none"} value={opt}>
              {opt || "— не указан —"}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}
