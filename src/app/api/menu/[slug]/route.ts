import { route, ok } from "@/lib/api";
import { getMenuItemBySlug } from "@/server/services/menu.service";
import { getSettings, publicSettings } from "@/server/services/settings.service";

export const GET = route(
  async (_request: Request, ctx: { params: Promise<{ slug: string }> }) => {
    const { slug } = await ctx.params;
    const [item, settings] = await Promise.all([getMenuItemBySlug(slug), getSettings()]);
    return ok({ restaurant: publicSettings(settings), item });
  },
);
