import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Literata, Manrope } from "next/font/google";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { MobilePreview } from "@/components/layout/MobilePreview";
import { NavigationProgress } from "@/components/layout/NavigationProgress";
import { ErrorReportButton } from "@/components/error-report/ErrorReportButton";
import { AiSearchOverlay } from "@/components/search/AiSearchLoader";
import { PageViewTracker } from "@/components/admin/PageViewTracker";
import { MicrosoftClarity } from "@/components/analytics/MicrosoftClarity";
import { BRAND_NAME } from "@/lib/brand";
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
  maximumScale: 5,
  viewportFit: "cover",
};

export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      className={`${manrope.variable} ${literata.variable}`}
      lang="ru"
    >
      <body className="overflow-x-hidden font-[family-name:var(--font-sans)]">
        <MicrosoftClarity />
        <Suspense fallback={null}>
          <NavigationProgress />
          <AiSearchOverlay />
        </Suspense>
        <div className="flex min-h-screen min-w-0 flex-col overflow-x-hidden">
          <div className="sticky top-0 z-[1001]">
            <Header />
          </div>
          <main className="mx-auto min-w-0 w-full max-w-6xl flex-1 overflow-x-hidden px-3 py-6 sm:px-4 sm:py-10 has-[.home-fullwidth]:max-w-none has-[.home-fullwidth]:px-0 has-[.home-fullwidth]:py-0 has-[.admin-shell]:max-w-none has-[.admin-shell]:px-3 has-[.admin-shell]:py-4 sm:has-[.admin-shell]:px-6 sm:has-[.admin-shell]:py-6">
            {children}
          </main>
          <Footer />
        </div>
        <MobilePreview />
        <Suspense fallback={null}>
          <ErrorReportButton />
        </Suspense>
        <Suspense fallback={null}>
          <PageViewTracker />
        </Suspense>
      </body>
    </html>
  );
}
