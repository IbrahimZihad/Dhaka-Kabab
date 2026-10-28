import { z } from "zod";
import { route, ok, parseQuery, paginate } from "@/lib/api";
import { requireApiPermission } from "@/server/http/guards";
import { listCustomers, listWalkInGuests, spendWindow } from "@/server/services/customer.service";
import { dateKeySchema } from "@/server/validation/common";

const querySchema = z.object({
  search: z.string().trim().max(80).optional(),
  active: z.enum(["1", "true", "0", "false"]).optional(),
  from: dateKeySchema.optional(),
  to: dateKeySchema.optional(),
  walkIns: z.enum(["1", "true"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

/**
 * Registered customers, or the walk-in list when `walkIns=1`. Spend is summed
 * from stored order totals over the selected window, excluding cancelled orders.
 */
export const GET = route(async (request: Request) => {
  await requireApiPermission(request, "customer:view");
  const query = parseQuery(new URL(request.url).searchParams, querySchema);
  const { page, pageSize, skip, take } = paginate(query);
  if (query.walkIns !== undefined) {
    const guests = await listWalkInGuests({ skip, take });
    return ok(guests, { meta: { page, pageSize } });
  }
  const { customers, total } = await listCustomers(
    {
      search: query.search,
      active: query.active === undefined ? undefined : ["1", "true"].includes(query.active),
      ...(await spendWindow(query.from, query.to)),
    },
    { skip, take },
  );
  return ok({ customers, total }, { meta: { page, pageSize, total } });
});
