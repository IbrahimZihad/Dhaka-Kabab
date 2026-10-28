import type { NextConfig } from "next";

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
};

export default nextConfig;
