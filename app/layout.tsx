import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Literata, Manrope } from "next/font/google";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { PlatformResourceCounter } from "@/components/layout/PlatformResourceCounter";
import { PageViewTracker } from "@/components/admin/PageViewTracker";
import { BRAND_NAME } from "@/lib/brand";
import { VIEW_MODE_STORAGE_KEY } from "@/lib/view-mode";
import "leaflet/dist/leaflet.css";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin", "cyrillic"],
  variable: "--font-sans",
  display: "swap",
});

const literata = Literata({
  subsets: ["latin", "cyrillic"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: BRAND_NAME,
  description: "КРУГИ — каталог русскоязычного бизнеса по районам (county)",
  icons: {
    icon: [{ url: "/brand/krugi-mark-256.png", type: "image/png" }],
    apple: [{ url: "/brand/krugi-mark-256.png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const dynamic = "force-dynamic";

const viewModeBootScript = `(function(){try{var m=localStorage.getItem(${JSON.stringify(VIEW_MODE_STORAGE_KEY)});if(m==="mobile"||m==="desktop"){document.documentElement.setAttribute("data-view-mode",m);var meta=document.querySelector('meta[name="viewport"]');if(!meta){meta=document.createElement("meta");meta.setAttribute("name","viewport");document.head.appendChild(meta);}meta.setAttribute("content",m==="desktop"?"width=1280":"width=device-width, initial-scale=1, viewport-fit=cover");}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      className={`${manrope.variable} ${literata.variable}`}
      lang="ru"
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: viewModeBootScript }} />
      </head>
      <body className="overflow-x-hidden font-[family-name:var(--font-sans)]">
        <div className="view-shell flex min-h-screen flex-col">
          <div className="sticky top-0 z-[1001]">
            <div className="platform-top-counter-sticky">
              <Suspense
                fallback={
                  <div className="border-b border-slate-200 bg-slate-50">
                    <p className="mx-auto max-w-6xl px-4 py-1.5 text-xs text-slate-400">
                      Считаем ресурсы…
                    </p>
                  </div>
                }
              >
                <PlatformResourceCounter />
              </Suspense>
            </div>
            <Header />
          </div>
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 has-[.home-fullwidth]:max-w-none has-[.home-fullwidth]:px-0 has-[.home-fullwidth]:py-0">
            {children}
          </main>
          <Footer />
        </div>
        <Suspense fallback={null}>
          <PageViewTracker />
        </Suspense>
      </body>
    </html>
  );
}
