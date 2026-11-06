import type { NextConfig } from 'next';

const config: NextConfig = {
  poweredByHeader: false,
  // Callback query parameters contain short-lived authorization codes and OAuth state.
  logging: {
    incomingRequests: { ignore: [/^\/api\/auth\/google\/callback(?:\?|$)/] },
  },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Cache-Control', value: 'private, no-store' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'same-origin' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' }
      ]
    }];
  }
};

export default config;
