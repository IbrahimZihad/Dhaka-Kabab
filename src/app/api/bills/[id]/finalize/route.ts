import { route, ok, clientIp, parseBody } from "@/lib/api";
import { mutationUser, actorOf } from "@/server/http/guards";
import { finalizeBill } from "@/server/services/billing.service";
import { pricePoisa } from "@/server/validation/menu";
import { z } from "zod";

const bodySchema = z.object({ discountPoisa: pricePoisa.optional() });

/**
 * Finalizing turns the live mirror of a table's orders into an immutable
 * document with its own line copies and a snapshot of the charge configuration.
 * Money is not moved here — only the amount owed is fixed.
 */
export const POST = route(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const user = await mutationUser(request, "bill:manage");
  const input = await parseBody(request, bodySchema);
  const bill = await finalizeBill(id, { discountPoisa: input.discountPoisa }, actorOf(user, clientIp(request)));
  return ok({ number: bill.number, status: bill.status, totalPoisa: bill.totalPoisa });
});
