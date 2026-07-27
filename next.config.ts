import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  turbopack: {
    root: process.cwd(),
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
    ],
  },
};

export default nextConfig;
