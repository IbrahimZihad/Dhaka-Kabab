import { route, ok, parseBody, clientIp } from "@/lib/api";
import { actorOf, mutationUser, requireApiPermission } from "@/server/http/guards";
import { deactivateStaff, getStaffById, updateStaff } from "@/server/services/staff.service";
import { staffPatchSchema } from "@/server/validation/auth";

export const GET = route(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await requireApiPermission(request, "staff:manage");
  return ok({ staff: await getStaffById(id) });
});

export const PATCH = route(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const user = await mutationUser(request, "staff:manage");
  const patch = await parseBody(request, staffPatchSchema);
  return ok(await updateStaff(id, patch, actorOf(user, clientIp(request))));
});

/**
 * Deactivation, not deletion. Orders, payments and audit rows name this account,
 * so removing it would rewrite financial history.
 */
export const DELETE = route(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const user = await mutationUser(request, "staff:manage");
  return ok(await deactivateStaff(id, actorOf(user, clientIp(request))));
});
