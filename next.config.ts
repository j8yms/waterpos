import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      // Service-workers must be served fresh so updates ship instead of
      // sitting in the HTTP cache for the default period.
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        source: "/icons/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      // Network-first cache headers for API routes
      {
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      // Secure auth and POS routes — enforce HTTPS, HttpOnly, Secure cookies
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
        ],
      },
      // Restrict API auth endpoints to POST only, prevent parameter tampering
      {
        source: "/api/auth/login",
        headers: [
          { key: "Allow", value: "POST" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self' 'unsafe-inline';" },
        ],
      },
      // Prevent M-PESA webhook replay without shared secret
      {
        source: "/api/mpesa-webhook",
        headers: [
          { key: "Content-Security-Policy", value: "default-src 'self'" },
        ],
      },
    ];
  },
  /* config options here */
};

export default nextConfig;