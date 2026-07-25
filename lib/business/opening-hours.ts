/** Weekly opening hours stored on businesses.opening_hours (jsonb). */

export type OpeningHoursDay = {
  /** 0 = Sunday … 6 = Saturday (JS getDay). */
  day: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  closed?: boolean;
  /** 24h "HH:MM" */
  open?: string | null;
  /** 24h "HH:MM" */
  close?: string | null;
};

export type OpeningHours = {
  timezone?: string | null;
  weekly: OpeningHoursDay[];
};

const DAY_LABELS_RU: Record<OpeningHoursDay["day"], string> = {
  0: "Воскресенье",
  1: "Понедельник",
  2: "Вторник",
  3: "Среда",
  4: "Четверг",
  5: "Пятница",
  6: "Суббота",
};

export function isOpeningHours(value: unknown): value is OpeningHours {
  if (!value || typeof value !== "object") return false;
  const weekly = (value as { weekly?: unknown }).weekly;
  return Array.isArray(weekly);
}

export function parseOpeningHours(value: unknown): OpeningHours | null {
  if (!isOpeningHours(value)) return null;
  const weekly = value.weekly
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const day = Number((row as OpeningHoursDay).day);
      if (!Number.isInteger(day) || day < 0 || day > 6) return null;
      return {
        day: day as OpeningHoursDay["day"],
        closed: Boolean((row as OpeningHoursDay).closed),
        open: (row as OpeningHoursDay).open ?? null,
        close: (row as OpeningHoursDay).close ?? null,
      } satisfies OpeningHoursDay;
    })
    .filter((row): row is NonNullable<typeof row> => row != null);
  if (weekly.length === 0) return null;
  return {
    timezone:
      typeof value.timezone === "string" ? value.timezone : null,
    weekly,
  };
}

function formatClock(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return hhmm;
  const h = Number(m[1]);
  const min = m[2];
  if (!Number.isFinite(h) || h < 0 || h > 23) return hhmm;
  return `${String(h).padStart(2, "0")}:${min}`;
}

export function formatDayHoursLabel(day: OpeningHoursDay): string {
  if (day.closed || !day.open || !day.close) return "Закрыто";
  return `${formatClock(day.open)}–${formatClock(day.close)}`;
}

export function dayLabelRu(day: OpeningHoursDay["day"]): string {
  return DAY_LABELS_RU[day];
}

/** Ordered Sun→Sat rows for UI; fills missing days as closed. */
export function openingHoursRows(hours: OpeningHours): OpeningHoursDay[] {
  const byDay = new Map(hours.weekly.map((d) => [d.day, d]));
  return ([0, 1, 2, 3, 4, 5, 6] as const).map(
    (day) => byDay.get(day) ?? { day, closed: true },
  );
}
