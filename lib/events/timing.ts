/** Relative timing labels for event cards. */

export function daysUntilEvent(startsAt: string | null, now = Date.now()): number | null {
  if (!startsAt) return null;
  const t = new Date(startsAt).getTime();
  if (Number.isNaN(t)) return null;
  const dayMs = 24 * 60 * 60 * 1000;
  // Compare calendar-ish from local midnight proximity: use floor of ms diff
  return Math.floor((t - now) / dayMs);
}

export function isEventPast(startsAt: string | null, now = Date.now()): boolean {
  if (!startsAt) return false; // undated → treat as upcoming/open
  const t = new Date(startsAt).getTime();
  if (Number.isNaN(t)) return false;
  return t < now - 6 * 60 * 60 * 1000; // 6h grace after start
}

function pluralDays(n: number): string {
  const abs = Math.abs(n);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return "день";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "дня";
  return "дней";
}

/** Short badge: «Сегодня», «Завтра», «Через 5 дней», «Прошло», «3 дня назад» */
export function eventTimingLabel(
  startsAt: string | null,
  now = Date.now(),
): { kind: "upcoming" | "past" | "undated"; text: string } {
  if (!startsAt) {
    return { kind: "undated", text: "Дата уточняется" };
  }
  if (isEventPast(startsAt, now)) {
    const days = daysUntilEvent(startsAt, now);
    if (days === null) return { kind: "past", text: "Уже прошло" };
    const ago = Math.abs(days);
    if (ago <= 0) return { kind: "past", text: "Уже прошло" };
    return {
      kind: "past",
      text: `${ago} ${pluralDays(ago)} назад`,
    };
  }
  const days = daysUntilEvent(startsAt, now);
  if (days === null) return { kind: "undated", text: "Дата уточняется" };
  if (days <= 0) return { kind: "upcoming", text: "Сегодня" };
  if (days === 1) return { kind: "upcoming", text: "Завтра" };
  return {
    kind: "upcoming",
    text: `Через ${days} ${pluralDays(days)}`,
  };
}

export function splitEventsByTimeline<T extends { starts_at: string | null }>(
  events: T[],
  now = Date.now(),
): { upcoming: T[]; past: T[] } {
  const upcoming: T[] = [];
  const past: T[] = [];
  for (const e of events) {
    if (isEventPast(e.starts_at, now)) past.push(e);
    else upcoming.push(e);
  }
  return { upcoming, past };
}

export function sortUpcomingSoonest<T extends { starts_at: string | null }>(
  events: T[],
  direction: "soon" | "later" = "soon",
): T[] {
  const copy = [...events];
  const asc = direction !== "later";
  copy.sort((a, b) => {
    if (!a.starts_at && !b.starts_at) return 0;
    if (!a.starts_at) return 1;
    if (!b.starts_at) return -1;
    const da = new Date(a.starts_at).getTime();
    const db = new Date(b.starts_at).getTime();
    return asc ? da - db : db - da;
  });
  return copy;
}

export function sortPastNewestFirst<T extends { starts_at: string | null }>(
  events: T[],
): T[] {
  const copy = [...events];
  copy.sort((a, b) => {
    if (!a.starts_at && !b.starts_at) return 0;
    if (!a.starts_at) return 1;
    if (!b.starts_at) return -1;
    return new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime();
  });
  return copy;
}
