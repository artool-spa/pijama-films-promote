/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // `next dev` otherwise appends a `nextjs-agent-rules` block to CLAUDE.md on
  // every start, leaving an uncommitted change in a file the repo maintains by
  // hand. The guidance it adds is in `node_modules/next/dist/docs/` regardless.
  agentRules: false,
  serverExternalPackages: ['pino', 'pino-pretty'],
  images: {
    formats: ['image/avif', 'image/webp'],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '500mb',
    },
    proxyClientMaxBodySize: '500mb',
  },
  async redirects() {
    return [
      // Ad content moved into the campaign edit page; keep old links working.
      {
        source: '/films/:id/campaigns/:campaignId/ads/:adId/edit',
        destination: '/films/:id/campaigns/:campaignId/edit?section=ad&adId=:adId',
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on'
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'Referrer-Policy',
            value: 'origin-when-cross-origin'
          }
        ]
      }
    ];
  }
};

export default nextConfig;
