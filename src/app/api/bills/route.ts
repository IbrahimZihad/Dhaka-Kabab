import { z } from "zod";
import { route, ok, parseQuery, paginate } from "@/lib/api";
import { requireApiPermission } from "@/server/http/guards";
import { listBills } from "@/server/services/billing.service";
import { dateKeySchema } from "@/server/validation/common";
import { getSettings } from "@/server/services/settings.service";
import { dayRange, todayKey } from "@/lib/time";

const querySchema = z.object({
  status: z.enum(["OPEN", "FINALIZED", "SETTLED", "VOIDED"]).optional(),
  dateKey: dateKeySchema.optional(),
  search: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(30),
});

export const GET = route(async (request: Request) => {
  await requireApiPermission(request, "bill:view");
  const url = new URL(request.url);
  const query = parseQuery(url.searchParams, querySchema);
  const settings = await getSettings();
  const { page, pageSize, skip, take } = paginate({ page: query.page, pageSize: query.pageSize });

  // The list is day-bounded by default so an unfiltered poll cannot walk every
  // bill the restaurant has ever raised.
  const dayKey = query.dateKey ?? todayKey(settings.timezone);
  const window = dayRange(dayKey, settings.timezone);

  const { bills, total } = await listBills(
    { status: query.status, from: window.start, to: window.end, search: query.search },
    { skip, take },
  );
  return ok({ bills, currencySymbol: settings.currencySymbol, dateKey: dayKey }, { meta: { page, pageSize, total } });
});
