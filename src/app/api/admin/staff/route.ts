import { z } from "zod";
import { route, ok, parseBody, parseQuery, paginate, clientIp } from "@/lib/api";
import { actorOf, mutationUser, requireApiPermission } from "@/server/http/guards";
import { createStaff, listStaff } from "@/server/services/staff.service";
import { staffInputSchema } from "@/server/validation/auth";
import { ROLE_PERMISSIONS, ROLE_LABELS } from "@/lib/auth/rbac";

const querySchema = z.object({
  role: z.enum(["OWNER", "MANAGER", "CASHIER", "KITCHEN"]).optional(),
  active: z.enum(["1", "true", "0", "false"]).optional(),
  search: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

export const GET = route(async (request: Request) => {
  await requireApiPermission(request, "staff:manage");
  const query = parseQuery(new URL(request.url).searchParams, querySchema);
  const { page, pageSize, skip, take } = paginate(query);
  const isActive = query.active === undefined ? undefined : ["1", "true"].includes(query.active);
  const { staff, total } = await listStaff({ role: query.role, isActive, search: query.search }, { skip, take });
  return ok(
    { staff, roles: ROLE_LABELS, permissions: ROLE_PERMISSIONS },
    { meta: { page, pageSize, total } },
  );
});

/**
 * A omitted password means the service mints a one-time password and returns it
 * exactly once, in this response, for the manager to hand over in person.
 */
export const POST = route(async (request: Request) => {
  const user = await mutationUser(request, "staff:manage");
  const input = await parseBody(request, staffInputSchema);
  const result = await createStaff(input, actorOf(user, clientIp(request)));
  return ok({ user: result.user, tempPassword: result.tempPassword }, { status: 201 });
});
