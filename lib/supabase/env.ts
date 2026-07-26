/**
 * Shared public Supabase env parsing for browser/server/middleware.
 * Normalizes common Vercel misconfigs (quotes, missing protocol, trailing junk).
 */

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim();
  }
  return value;
}

/** Returns a canonical https://…supabase… origin, or null if unusable. */
export function normalizeSupabaseUrl(raw: string | undefined | null): string | null {
  if (!raw) return null;

  let value = stripWrappingQuotes(raw.trim());
  if (!value) return null;

  // Common dashboard paste: project host without scheme.
  if (/^[a-z0-9][a-z0-9-]*\.supabase\.co\/?$/i.test(value)) {
    value = `https://${value.replace(/\/$/, "")}`;
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

export function getPublicSupabaseEnv(): { url: string; anonKey: string } {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url || !anonKey) {
    throw new Error(
      "Не задан корректный NEXT_PUBLIC_SUPABASE_URL (нужен https://….supabase.co) или NEXT_PUBLIC_SUPABASE_ANON_KEY в Vercel → Settings → Environment Variables. После правки нужен Redeploy.",
    );
  }

  return { url, anonKey };
}
