import { z } from "zod";
import { route, ok, parseBody, parseQuery, paginate } from "@/lib/api";
import { mutationUser, requireApiPermission } from "@/server/http/guards";
import { listNotifications, notificationHealth, retryNotifications } from "@/server/services/notification.service";

const querySchema = z.object({
  status: z.enum(["QUEUED", "SENDING", "SENT", "FAILED", "SKIPPED"]).optional(),
  type: z
    .enum([
      "ORDER_CREATED",
      "ORDER_STATUS_CHANGED",
      "ORDER_READY",
      "RESERVATION_CREATED",
      "RESERVATION_CONFIRMED",
      "RESERVATION_CANCELLED",
      "RESERVATION_REMINDER",
      "RESERVATION_NO_SHOW",
      "PAYMENT_SUCCEEDED",
      "PAYMENT_FAILED",
      "BILL_SETTLED",
      "BILL_REQUESTED",
      "CHAT_ESCALATION",
    ])
    .optional(),
  relatedId: z.string().trim().max(64).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

const retrySchema = z.object({ ids: z.array(z.string().min(1).max(64)).max(200).optional() });

export const GET = route(async (request: Request) => {
  await requireApiPermission(request, "settings:manage");
  const query = parseQuery(new URL(request.url).searchParams, querySchema);
  const { page, pageSize, skip, take } = paginate(query, { pageSize: 50, max: 200 });
  const [result, health] = await Promise.all([
    listNotifications({ status: query.status, type: query.type, relatedId: query.relatedId }, { skip, take }),
    notificationHealth(),
  ]);
  return ok({ ...result, health }, { meta: { page, pageSize, total: result.total } });
});

/**
 * Re-queue failed or skipped messages. Sending is attempted now, and the result
 * is reported truthfully: a queue that could not reach SMTP returns the transport
 * reason instead of pretending the mail went out.
 */
export const POST = route(async (request: Request) => {
  await mutationUser(request, "settings:manage");
  const body = await parseBody(request, retrySchema);
  return ok(await retryNotifications(body.ids));
});
