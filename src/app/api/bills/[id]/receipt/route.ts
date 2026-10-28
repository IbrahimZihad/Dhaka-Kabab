import { route, ok } from "@/lib/api";
import { requireApiPermission } from "@/server/http/guards";
import { buildReceipt } from "@/server/services/billing.service";
import { formatPoisa } from "@/lib/money";

/**
 * Receipt data for printing or emailing. Figures come from the stored bill and
 * its snapshot, so a receipt reprinted months later shows the charges that were
 * actually in force that day.
 */
export const GET = route(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await requireApiPermission(request, "bill:view");
  const receipt = await buildReceipt(id);
  return ok({
    ...receipt,
    issuedAt: receipt.issuedAt.toISOString(),
    money: {
      subtotal: formatPoisa(receipt.subtotalPoisa, { symbol: receipt.currencySymbol }),
      discount: formatPoisa(receipt.discountPoisa, { symbol: receipt.currencySymbol }),
      serviceCharge: formatPoisa(receipt.serviceChargePoisa, { symbol: receipt.currencySymbol }),
      vat: formatPoisa(receipt.vatPoisa, { symbol: receipt.currencySymbol }),
      rounding: formatPoisa(receipt.roundingAdjustmentPoisa, { symbol: receipt.currencySymbol }),
      total: formatPoisa(receipt.totalPoisa, { symbol: receipt.currencySymbol }),
      paid: formatPoisa(receipt.paidPoisa, { symbol: receipt.currencySymbol }),
      refunded: formatPoisa(receipt.refundedPoisa, { symbol: receipt.currencySymbol }),
      outstanding: formatPoisa(receipt.outstandingPoisa, { symbol: receipt.currencySymbol }),
      overpaid: formatPoisa(receipt.overpaidPoisa, { symbol: receipt.currencySymbol }),
    },
  });
});
