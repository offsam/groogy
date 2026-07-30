import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Literata, Manrope } from "next/font/google";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { MobilePreview } from "@/components/layout/MobilePreview";
import { ErrorReportButton } from "@/components/error-report/ErrorReportButton";
import { PageViewTracker } from "@/components/admin/PageViewTracker";
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
        <div className="flex min-h-screen flex-col">
          <div className="sticky top-0 z-[1001]">
            <Header />
          </div>
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 has-[.home-fullwidth]:max-w-none has-[.home-fullwidth]:px-0 has-[.home-fullwidth]:py-0 has-[.admin-shell]:max-w-none has-[.admin-shell]:px-4 has-[.admin-shell]:py-6 sm:has-[.admin-shell]:px-6">
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
