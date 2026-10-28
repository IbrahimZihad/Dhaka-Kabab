import { route, ok, parseBody, clientIp } from "@/lib/api";
import { apiCustomer } from "@/server/http/guards";
import { updateCustomer } from "@/server/services/customer.service";
import { selfProfileSchema } from "@/server/validation/auth";

/**
 * A signed-in diner editing their own contact details. The id is taken from the
 * session, never the body, and the staff-only fields (`notes`, `isActive`) have
 * no place in this schema at all.
 */
export const PATCH = route(async (request: Request) => {
  const user = await apiCustomer(request);
  const input = await parseBody(request, selfProfileSchema);
  return ok(await updateCustomer(user.id, input, { userId: user.id, ip: clientIp(request) }));
});
