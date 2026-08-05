import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { normalizeSupabaseUrl } from "@/lib/supabase/env";

const AUTH_PAGES = new Set(["/login", "/register", "/forgot-password"]);
const PROTECTED_PREFIXES = ["/profile", "/auth/update-password", "/admin"];

function isProtectedPath(pathname: string) {
  if (
    pathname === "/marketplace/new" ||
    pathname.startsWith("/marketplace/new/")
  ) {
    return true;
  }

  if (/^\/marketplace\/[^/]+\/edit\/?$/.test(pathname)) {
    return true;
  }

  if (pathname === "/services/new" || pathname.startsWith("/services/new/")) {
    return true;
  }

  if (/^\/services\/[^/]+\/edit\/?$/.test(pathname)) {
    return true;
  }

  if (pathname === "/events/new" || pathname.startsWith("/events/new/")) {
    return true;
  }

  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/profile";
  }
  return value;
}

function passThrough(request: NextRequest) {
  return NextResponse.next({ request });
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = passThrough(request);

  const { pathname } = request.nextUrl;

  // getUser() is a blocking network round-trip to Supabase Auth. Only
  // protected paths and the auth pages (login/register/forgot-password)
  // ever branch on its result — every other route (the vast majority of
  // traffic, including all the background RSC prefetch requests Next.js
  // fires for links in the viewport) doesn't need it. Skipping it here
  // removes an unnecessary network call from the critical path of nearly
  // every page load and prefetch on the site.
  if (!isProtectedPath(pathname) && !AUTH_PAGES.has(pathname)) {
    return supabaseResponse;
  }

  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  // Missing/invalid env must never take the whole site down.
  if (!url || !anonKey) {
    return supabaseResponse;
  }

  try {
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          supabaseResponse = passThrough(request);
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options);
          });
        },
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { searchParams } = request.nextUrl;

    if (!user && isProtectedPath(pathname)) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
      return NextResponse.redirect(loginUrl);
    }

    if (user && AUTH_PAGES.has(pathname)) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = safeNextPath(searchParams.get("next"));
      redirectUrl.search = "";
      return NextResponse.redirect(redirectUrl);
    }

    return supabaseResponse;
  } catch {
    // Auth/session refresh failures must not hard-fail every request.
    return passThrough(request);
  }
}
