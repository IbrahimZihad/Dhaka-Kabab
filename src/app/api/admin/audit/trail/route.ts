import { z } from "zod";
import { route, ok, parseQuery } from "@/lib/api";
import { requireApiPermission } from "@/server/http/guards";
import { auditTrailFor } from "@/server/services/audit.service";

const querySchema = z.object({
  entityType: z.string().trim().min(3).max(40),
  entityId: z.string().trim().min(1).max(64),
});

/** Chronological trail for one record — what changed, who changed it, when. */
export const GET = route(async (request: Request) => {
  await requireApiPermission(request, "audit:view");
  const query = parseQuery(new URL(request.url).searchParams, querySchema);
  return ok({ trail: await auditTrailFor(query.entityType, query.entityId) });
});
