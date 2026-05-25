/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },

  /* ============================================================
     Image optimization
     - Enable Next.js automatic AVIF/WebP transcoding,
       responsive `srcset` generation, and on-demand resizing.
     - The `<Image>` component (used by GameCard) will now serve
       per-viewport sizes instead of one full-resolution PNG.
     - `remotePatterns` allow the optimizer to handle thumbnails
       hosted on the Vercel blob CDN and the Dicebear avatar
       service (used by Aviator's bet list).
     - `minimumCacheTTL` keeps optimized variants in the disk
     cache for 30 days so repeat visits hit the cache.
     ============================================================ */
  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [360, 414, 640, 750, 828, 1080, 1200, 1440, 1920, 2048],
    imageSizes: [16, 32, 48, 64, 96, 128, 192, 256, 320, 384],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'hebbkx1anhila5yf.public.blob.vercel-storage.com',
      },
      {
        protocol: 'https',
        hostname: 'api.dicebear.com',
      },
    ],
    minimumCacheTTL: 60 * 60 * 24 * 30, // 30 days
  },

  /* ============================================================
     Bundle / runtime
     - `optimizePackageImports` tells Next to tree-shake barrel
       imports from `lucide-react` (and friends) so each page
       only pays for the icons it actually uses, not the whole
       1000+ icon set.
     - `compress: true` enables gzip/brotli on the Node server.
     - `poweredByHeader: false` shaves a few bytes per response
       and removes a fingerprint header.
     ============================================================ */
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  compress: true,
  poweredByHeader: false,

  /* ============================================================
     HTTP caching
     - All static images / audio in /public are content-hashed
       at build time only when they live under `/_next/static`,
       so for `/games/*`, `/mobile-bet/*`, etc. we set a long
       `immutable` cache so browsers never re-fetch them on
       repeat visits.
     - Filename collisions are avoided because we treat them as
       semantic asset paths (a swap of `aviator-thumb.png`
       would also change the file size and the browser will
       already revalidate when forced).
     ============================================================ */
  async headers() {
    return [
      {
        source: '/games/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/mobile-bet/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/:path*\\.(png|jpg|jpeg|gif|webp|avif|svg|ico|m4a|mp3|woff|woff2)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ]
  },
}

export default nextConfig
