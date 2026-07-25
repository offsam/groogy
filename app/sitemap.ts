import type { MetadataRoute } from "next";
import {
  getSitemapMarketplaceIds,
  getSitemapServiceIds,
} from "@/lib/listings/queries";
import { getSitemapOfferSlugs } from "@/lib/business-offers/queries";
import { createServerClient } from "@/lib/supabase/server";

const BASE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "https://example.com";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: `${BASE_URL}/`,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${BASE_URL}/marketplace`,
      changeFrequency: "hourly",
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/services`,
      changeFrequency: "hourly",
      priority: 0.9,
    },
  ];

  try {
    const supabase = await createServerClient();
    const [listings, services, offers] = await Promise.all([
      getSitemapMarketplaceIds(supabase, 500),
      getSitemapServiceIds(supabase, 500),
      getSitemapOfferSlugs(supabase, 500),
    ]);

    const listingRoutes: MetadataRoute.Sitemap = listings.map((item) => ({
      url: `${BASE_URL}/marketplace/${item.id}`,
      lastModified: new Date(item.updatedAt),
      changeFrequency: "daily",
      priority: 0.7,
    }));

    const serviceRoutes: MetadataRoute.Sitemap = services.map((item) => ({
      url: `${BASE_URL}/services/${item.id}`,
      lastModified: new Date(item.updatedAt),
      changeFrequency: "daily",
      priority: 0.7,
    }));

    const offerRoutes: MetadataRoute.Sitemap = offers.map((item) => ({
      url: `${BASE_URL}/business/${item.businessSlug}/offers/${item.offerSlug}`,
      lastModified: new Date(item.updatedAt),
      changeFrequency: "daily",
      priority: 0.65,
    }));

    return [...staticRoutes, ...listingRoutes, ...serviceRoutes, ...offerRoutes];
  } catch {
    return staticRoutes;
  }
}
