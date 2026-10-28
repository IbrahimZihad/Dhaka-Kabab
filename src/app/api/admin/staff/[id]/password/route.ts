import { route, ok, parseBody, clientIp } from "@/lib/api";
import { actorOf, mutationUser } from "@/server/http/guards";
import { adminSetPassword } from "@/server/services/auth.service";
import { adminPasswordSchema } from "@/server/validation/auth";

/**
 * Administrative password reset: sets a new password and revokes every existing
 * session for that account, so a stolen or shared session dies with the old one.
 */
export const POST = route(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const user = await mutationUser(request, "staff:manage");
  const { newPassword } = await parseBody(request, adminPasswordSchema);
  return ok(await adminSetPassword(id, newPassword, actorOf(user, clientIp(request))));
});
