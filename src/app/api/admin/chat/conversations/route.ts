import { z } from "zod";
import { route, ok, parseQuery, paginate } from "@/lib/api";
import { requireApiPermission } from "@/server/http/guards";
import { chatHealth, listConversations } from "@/server/services/chatbot.service";
import { dateKeySchema } from "@/server/validation/common";
import { getSettings } from "@/server/services/settings.service";
import { dayRange } from "@/lib/time";

const querySchema = z.object({
  escalated: z.enum(["1", "true"]).optional(),
  dateKey: dateKeySchema.optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(30),
});

/** Chat inbox: what guests asked, what the assistant answered, and what escalated. */
export const GET = route(async (request: Request) => {
  await requireApiPermission(request, "chat:view");
  const url = new URL(request.url);
  const query = parseQuery(url.searchParams, querySchema);
  const settings = await getSettings();
  const { page, pageSize, skip, take } = paginate({ page: query.page, pageSize: query.pageSize });

  const window = query.dateKey ? dayRange(query.dateKey, settings.timezone) : null;
  const result = await listConversations(
    {
      escalated: query.escalated ? true : undefined,
      from: window?.start,
      to: window?.end,
    },
    { skip, take },
  );
  const health = await chatHealth();
  return ok({ ...result, health }, { meta: { page, pageSize, total: result.total } });
});
