import { route, ok, parseBody, clientIp } from "@/lib/api";
import { mutationUser } from "@/server/http/guards";
import { billVoidSchema } from "@/server/validation/billing";
import { voidBill } from "@/server/services/billing.service";

/**
 * Voiding is the only way a bill leaves the ledger, and it needs a reason. The
 * row, its lines and its payments all survive.
 */
export const POST = route(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const user = await mutationUser(request, "bill:void");
  const input = await parseBody(request, billVoidSchema);
  const bill = await voidBill(id, input.reason, { userId: user.id, role: user.role, ip: clientIp(request) });
  return ok({ number: bill.number, status: bill.status, voidedAt: bill.voidedAt?.toISOString() ?? null });
});
