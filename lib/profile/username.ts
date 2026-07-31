/**
 * Username from display name (Cyrillic→Latin) + digits if taken.
 * App-side fallback when DB trigger/migration not yet applied.
 */

const CYR_MAP: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

const RESERVED = new Set([
  "admin",
  "profile",
  "marketplace",
  "business",
  "auth",
  "api",
  "login",
  "signup",
  "settings",
  "support",
  "root",
  "system",
  "moderator",
  "register",
  "u",
  "search",
  "null",
  "undefined",
]);

export function slugifyUsernameBase(raw: string | null | undefined): string {
  const lower = (raw ?? "").trim().toLowerCase();
  let out = "";
  for (const ch of lower) {
    if (CYR_MAP[ch] != null) {
      out += CYR_MAP[ch];
      continue;
    }
    if (/[a-z0-9]/.test(ch)) {
      out += ch;
      continue;
    }
    if (/[\s_\-.+]/.test(ch)) {
      if (out && !out.endsWith("_")) out += "_";
    }
  }
  out = out.replace(/_+/g, "_").replace(/^_|_$/g, "");
  if (out.length > 24) out = out.slice(0, 24).replace(/^_|_$/g, "");
  if (out.length < 3) return "user";
  if (RESERVED.has(out)) return `${out}_u`.slice(0, 24);
  return out;
}

export function usernameCandidate(base: string, n: number): string {
  if (n <= 0) return base.slice(0, 30);
  const suffix = String(n);
  return `${base.slice(0, Math.max(1, 30 - suffix.length))}${suffix}`;
}
