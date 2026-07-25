"use client";

import { cn } from "@/lib/utils";
import type { UsStateOption } from "@/types/master-data";

type StateSelectProps = {
  states: UsStateOption[];
  value?: string;
  onChange?: (stateCode: string, abbreviation: string) => void;
  id?: string;
  name?: string;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
};

export function StateSelect({
  states,
  value = "",
  onChange,
  id = "state_code",
  name,
  className,
  disabled,
  required,
  placeholder = "Выберите штат",
}: StateSelectProps) {
  return (
    <select
      className={cn(
        "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2",
        className,
      )}
      disabled={disabled}
      id={id}
      name={name}
      onChange={(e) => {
        const code = e.target.value;
        const match = states.find((s) => s.code === code);
        onChange?.(code, match?.abbreviation ?? "");
      }}
      required={required}
      value={value}
    >
      <option value="">{placeholder}</option>
      {states.map((s) => (
        <option key={s.code} value={s.code}>
          {s.abbreviation} — {s.nameRu || s.nameEn}
        </option>
      ))}
    </select>
  );
}
