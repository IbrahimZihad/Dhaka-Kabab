import { cacheLife, cacheTag } from "next/cache";
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";

/**
 * Public pages only. Nothing behind a token or a session belongs here: an order
 * or booking link is a capability, and listing it would hand it to anyone who
 * reads this file.
 */
type Entry = { url: string; lastModified?: Date; changeFrequency: "daily" | "weekly" | "monthly"; priority: number };

async function menuUrls(): Promise<{ slug: string; updatedAt: Date }[]> {
  "use cache";
  cacheLife("days");
  cacheTag("menu");
  return prisma.menuItem.findMany({
    where: { archivedAt: null, available: true },
    select: { slug: true, updatedAt: true },
  });
}

export default async function sitemap(): Promise<Entry[]> {
  const items = await menuUrls();
  return sitemapEntries(items);
}

function sitemapEntries(items: { slug: string; updatedAt: Date }[]): Entry[] {
  const base = env.appUrl.replace(/\/$/, "");
  const statics: Entry[] = [
    { url: `${base}/`, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/menu`, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/reservations`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${base}/about`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${base}/contact`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/track`, changeFrequency: "monthly", priority: 0.3 },
  ];
  return [
    ...statics,
    ...items.map<Entry>((item) => ({
      url: `${base}/menu/${item.slug}`,
      lastModified: item.updatedAt,
      changeFrequency: "weekly",
      priority: 0.6,
    })),
  ];
}
