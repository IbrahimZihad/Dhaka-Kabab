import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

/**
 * Staff and guest surfaces are disallowed by path, not by `noindex` alone: an
 * admin URL should not appear in a search result even for a moment, and a
 * token-carrying page must not be crawled into someone else's cache.
 */
export default function robots(): MetadataRoute.Robots {
  const base = env.appUrl.replace(/\/$/, "");
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/kitchen", "/api/", "/order?", "/account", "/login", "/register", "/reset-password"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
