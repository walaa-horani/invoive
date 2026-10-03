import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Client pay links carry a secret token in the path: keep it out of
  // Referer headers, caches and search engines.
  async headers() {
    return [
      {
        source: "/pay/:token*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "private, no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      {
        protocol: "https",
        hostname: "contribution.usercontent.google.com",
      },
    ],
  },
};

export default nextConfig;
