import { route, ok } from "@/lib/api";
import { mutationUser } from "@/server/http/guards";
import { prisma } from "@/lib/db";
import { getBillById, refreshBillLines } from "@/server/services/billing.service";

/**
 * Re-mirror a live bill against its session's orders after a kitchen or floor
 * change. A finalized bill's lines are preserved: this cannot rewrite an
 * already-issued document.
 */
export const POST = route(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await mutationUser(request, "bill:manage");
  const refreshed = await refreshBillLines(id, prisma, { preserveFinalized: true });
  return ok({ bill: refreshed ?? (await getBillById(id)) });
});
