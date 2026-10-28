import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Security headers, served by the app itself rather than only by the proxy in front
 * of it: a deployment where the headers live in somebody's nginx file is a
 * deployment where they are missing on the box nobody rebuilt.
 *
 * `script-src 'unsafe-inline'` is measured, not assumed. Next 16 writes its own
 * bootstrap into inline `<script>` tags on every page (`window.__next_f.push`, the
 * `&_R_` router hint), and this version ships no nonce injection — `addScriptNonce`
 * is gone from both the config schema and the bundled docs — so a nonce policy would
 * blank the site. Inline *event handlers* are the scripting risk that actually
 * matters here, and they are covered by `'unsafe-inline'` only in the sense that the
 * application never generates one: no `dangerouslySetInnerHTML`, no `innerHTML`, no
 * `eval` anywhere in `src/`. Tightening this to a nonce needs a per-request nonce in
 * `proxy.ts`, and the review of that trade-off is deliberately left open rather than
 * settled by a guess.
 */
function contentSecurityPolicy(gatewayOrigin: string | null): string {
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self'",
    "font-src 'self'",
    // The gateway origin belongs here, not nowhere: the payment hand-off is a form post
    // to another site, and a policy that blocks it looks like a broken till.
    `form-action 'self'${gatewayOrigin ? ` ${gatewayOrigin}` : ""}`,
    "frame-ancestors 'none'",
    "img-src 'self' data: https:",
    "object-src 'none'",
    `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
  ];
  return directives.join("; ");
}

const sslcommerzOrigin = (() => {
  const configured = process.env.SSLCOMMERZ_BASE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return process.env.SSLCOMMERZ_MODE === "live" ? "https://securepay.sslcommerz.com" : "https://sandbox.sslcommerz.com";
})();

const securityHeaders: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy(sslcommerzOrigin) },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // The restaurant is reached by a QR code on a table, not by a search of the
          // visitor's neighbourhood, and the app uses no camera, microphone or payment
          // API. `clipboard-write` is deliberately absent: staff copy a new account's
          // password with it, and listing a feature here is what switches it off.
          {
            key: "Permissions-Policy",
            value: "geolocation=(), camera=(), microphone=(), payment=(), usb=(), fullscreen=()",
          },
          // Only meaningful over TLS, which the deployment is; no `preload`, because
          // that is a decision about every future subdomain, not about this app.
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
        ],
      },
      {
        // The JSON API is a response about a named bill or table. A shared cache must
        // not hold it, and a browser must not keep it after the guest walks out.
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
      {
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // `next dev` serves `/_next/*` only to origins it knows: `localhost`, its subdomains and the
  // bound hostname. A browser always sends `Origin` on the HMR handshake, so opening the dev
  // server at `http://127.0.0.1:3000` silently 403s the socket and the client never boots.
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  ...securityHeaders,
};

export default nextConfig;
