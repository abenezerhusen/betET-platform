/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["*.preview.same-app.com"],
  devIndicators: false,
  // Gzip-compress responses from `next start`. Safe, no behaviour change.
  compress: true,
  // Drop the framework fingerprint header.
  poweredByHeader: false,
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  // Strip console.* (except warn/error) from production bundles so the
  // shipped JS is smaller and free of dev logging. Dev builds keep them.
  compiler: {
    removeConsole: { exclude: ["error", "warn"] },
  },
  // Tree-shake large barrel packages so only the icons/components actually
  // imported land in each route chunk. Big reduction for lucide-react.
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  images: {
    unoptimized: true,
    domains: [
      "source.unsplash.com",
      "images.unsplash.com",
      "ext.same-assets.com",
      "ugc.same-assets.com",
    ],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "source.unsplash.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "ext.same-assets.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "ugc.same-assets.com",
        pathname: "/**",
      },
    ],
  },
};

module.exports = nextConfig;
