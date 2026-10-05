/** @type {import('next').NextConfig} */
// Content-Security-Policy, shipped as REPORT-ONLY first. Next.js injects inline
// scripts and Paddle.js opens an iframe + XHR, so an enforcing policy written
// without a browser to test against could silently break checkout. Watch the
// browser console / a report endpoint for a week, then rename the header key
// to "Content-Security-Policy" to enforce.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.paddle.com https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.paddle.com https://challenges.cloudflare.com",
  "frame-src https://*.paddle.com https://challenges.cloudflare.com",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy-Report-Only", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
