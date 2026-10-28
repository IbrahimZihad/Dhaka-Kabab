import { z } from "zod";
import { route, ok, created, parseBody, parseQuery, clientIp, paginate } from "@/lib/api";
import { mutationUser, requireApiPermission } from "@/server/http/guards";
import { paymentRecordSchema } from "@/server/validation/billing";
import { listPayments, recordCounterPayment } from "@/server/services/payment.service";
import { getSettings } from "@/server/services/settings.service";
import { dateKeySchema } from "@/server/validation/common";
import { dayRange, todayKey } from "@/lib/time";

const listSchema = z.object({
  status: z.enum(["PENDING", "SUCCEEDED", "FAILED", "CANCELLED", "REFUNDED"]).optional(),
  provider: z.string().trim().max(30).optional(),
  billId: z.string().trim().max(64).optional(),
  dateKey: dateKeySchema.optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(30),
});

export const GET = route(async (request: Request) => {
  await requireApiPermission(request, "payment:view");
  const url = new URL(request.url);
  const query = parseQuery(url.searchParams, listSchema);
  const settings = await getSettings();
  const { page, pageSize, skip, take } = paginate({ page: query.page, pageSize: query.pageSize });

  const window = query.dateKey ? dayRange(query.dateKey, settings.timezone) : null;
  const { payments, total } = await listPayments(
    {
      status: query.status,
      provider: query.provider,
      billId: query.billId,
      from: window?.start,
      to: window?.end,
    },
    { skip, take },
  );
  return ok(
    { payments, currencySymbol: settings.currencySymbol },
    { meta: { page, pageSize, total, dateKey: query.dateKey ?? todayKey(settings.timezone) } },
  );
});

/**
 * Cash, card or mobile banking handed over at the counter. The actor is stored
 * with the payment, so every takings figure is attributable to a person.
 */
export const POST = route(async (request: Request) => {
  const user = await mutationUser(request, "payment:record");
  const input = await parseBody(request, paymentRecordSchema);
  const payment = await recordCounterPayment({
    billId: input.billId,
    orderId: input.orderId,
    method: input.method,
    amountPoisa: input.amountPoisa,
    reference: input.reference,
    note: input.note,
    actor: { userId: user.id, ip: clientIp(request) },
  });
  return created(payment);
});
