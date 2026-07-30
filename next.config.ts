import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Explicit: `NEXT_DIST_DIR=.next-dev npm run dev` — never share cache with `next build`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  outputFileTracingRoot: process.cwd(),
  turbopack: {
    root: process.cwd(),
  },
  experimental: {
    serverActions: {
      // Client compresses photos to ~700 KB before paste-enrich; leave headroom
      // for the text blob. Do not raise this to multi-MB phone originals.
      bodySizeLimit: "2mb",
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
      {
        protocol: "https",
        hostname: "svoi.us",
        pathname: "/files/**",
      },
      {
        protocol: "https",
        hostname: "www.russianorangepages.com",
      },
      {
        protocol: "https",
        hostname: "russianorangepages.com",
      },
      {
        protocol: "https",
        hostname: "static.glossgenius.com",
      },
      {
        protocol: "https",
        hostname: "glossgenius.com",
      },
      {
        protocol: "https",
        hostname: "*.glossgenius.com",
      },
    ],
  },
};

export default nextConfig;
