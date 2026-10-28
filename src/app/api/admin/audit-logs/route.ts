import { z } from "zod";
import { route, ok, parseQuery, paginate } from "@/lib/api";
import { requireApiPermission } from "@/server/http/guards";
import { listAuditLogs } from "@/server/services/audit.service";
import { getSettings } from "@/server/services/settings.service";
import { dayRange, todayKey } from "@/lib/time";
import { dateKeySchema } from "@/server/validation/common";

const querySchema = z.object({
  action: z.string().trim().max(60).optional(),
  entityType: z.string().trim().max(40).optional(),
  entityId: z.string().trim().max(64).optional(),
  actorUserId: z.string().trim().max(64).optional(),
  from: dateKeySchema.optional(),
  to: dateKeySchema.optional(),
  page: z.coerce.number().int().min(1).max(100_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

/**
 * Read-only view of the audit trail. `action` is matched as a prefix, so
 * "payment." lists every payment event recorded by any code path.
 */
export const GET = route(async (request: Request) => {
  await requireApiPermission(request, "audit:view");
  const query = parseQuery(new URL(request.url).searchParams, querySchema);
  const { page, pageSize, skip, take } = paginate(query, { pageSize: 50, max: 200 });
  const settings = await getSettings();

  // Default to the current trading day so an unfiltered call cannot stream the
  // whole history into a browser; one-sided windows are honoured as given.
  const bounded = Boolean(query.from ?? query.to);
  const today = dayRange(todayKey(settings.timezone), settings.timezone);
  const from = query.from ? dayRange(query.from, settings.timezone).start : bounded ? undefined : today.start;
  const to = query.to ? dayRange(query.to, settings.timezone).end : bounded ? undefined : today.end;

  const { logs, total } = await listAuditLogs(
    {
      action: query.action,
      entityType: query.entityType,
      entityId: query.entityId,
      actorUserId: query.actorUserId,
      from,
      to,
    },
    { skip, take },
  );
  return ok({ logs, window: { from: from?.toISOString() ?? null, to: to?.toISOString() ?? null } }, { meta: { page, pageSize, total } });
});
