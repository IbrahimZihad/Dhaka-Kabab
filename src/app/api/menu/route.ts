import { z } from "zod";
import { route, ok, parseQuery } from "@/lib/api";
import { listCategories, listMenuItems } from "@/server/services/menu.service";
import { getSettings, publicSettings } from "@/server/services/settings.service";

const menuQuerySchema = z.object({
  category: z.string().trim().max(60).optional(),
  search: z.string().trim().max(60).optional(),
  featured: z.enum(["1", "true"]).optional(),
});

export const GET = route(async (request: Request) => {
  const query = parseQuery(new URL(request.url).searchParams, menuQuerySchema);
  const [settings, categories, items] = await Promise.all([
    getSettings(),
    listCategories({ activeOnly: true }),
    listMenuItems({
      categorySlug: query.category,
      search: query.search,
      featuredOnly: query.featured !== undefined,
    }),
  ]);
  // Prices here are the live catalogue prices; an order re-derives them anyway.
  return ok({ restaurant: publicSettings(settings), categories, items });
});
