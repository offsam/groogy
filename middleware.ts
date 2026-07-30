import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { updateSession } from "@/lib/supabase/middleware";
import { normalizeSupabaseUrl } from "@/lib/supabase/env";

const CARD_PATH_RE =
  /^\/(business|professional|marketplace|jobs|events|lechu|transfers|services|real-estate)\/([^/]+)\/?$/;

async function lookupEntityMoveRedirect(
  fromPath: string,
): Promise<string | null> {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  try {
    const supabase = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await supabase
      .from("entity_moves")
      .select("to_path")
      .eq("from_path", fromPath)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const toPath = data?.to_path;
    if (typeof toPath === "string" && toPath.startsWith("/") && !toPath.startsWith("//")) {
      return toPath;
    }
  } catch {
    return null;
  }
  return null;
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname.replace(/\/$/, "") || "/";
  if (CARD_PATH_RE.test(pathname)) {
    const toPath = await lookupEntityMoveRedirect(pathname);
    if (toPath && toPath !== pathname) {
      const dest = request.nextUrl.clone();
      dest.pathname = toPath;
      return NextResponse.redirect(dest, 308);
    }
  }

  try {
    return await updateSession(request);
  } catch {
    return NextResponse.next({ request });
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
