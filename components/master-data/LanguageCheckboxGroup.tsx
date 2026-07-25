"use client";

import type { LanguageOption } from "@/types/master-data";

type LanguageCheckboxGroupProps = {
  languages: LanguageOption[];
  value: string[];
  onChange: (codes: string[]) => void;
  legend?: string;
};

export function LanguageCheckboxGroup({
  languages,
  value,
  onChange,
  legend = "Языки",
}: LanguageCheckboxGroupProps) {
  function toggle(code: string) {
    if (value.includes(code)) {
      onChange(value.filter((c) => c !== code));
    } else {
      onChange([...value, code]);
    }
  }

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-slate-700">{legend}</legend>
      <div className="flex flex-wrap gap-4">
        {languages.map((lang) => (
          <label key={lang.code} className="flex items-center gap-2 text-sm">
            <input
              checked={value.includes(lang.code)}
              onChange={() => toggle(lang.code)}
              type="checkbox"
            />
            <span className="text-slate-700">{lang.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
