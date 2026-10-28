import { route, ok, parseBody, clientIp } from "@/lib/api";
import { mutationUser, requireApiPermission } from "@/server/http/guards";
import { getCustomerProfile, updateCustomer } from "@/server/services/customer.service";
import { customerUpdateSchema } from "@/server/validation/auth";

export const GET = route(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await requireApiPermission(request, "customer:view");
  return ok(await getCustomerProfile(id));
});

export const PATCH = route(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const user = await mutationUser(request, "customer:manage");
  const input = await parseBody(request, customerUpdateSchema);
  return ok(await updateCustomer(id, input, { userId: user.id, ip: clientIp(request) }));
});
