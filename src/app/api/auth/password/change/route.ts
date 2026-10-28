import { route, ok, parseBody, assertSameOrigin, clientIp } from "@/lib/api";
import { apiUser } from "@/server/http/guards";
import { passwordChangeSchema } from "@/server/validation/auth";
import { changePassword } from "@/server/services/auth.service";

export const POST = route(async (request: Request) => {
  assertSameOrigin(request);
  const user = await apiUser(request);
  const input = await parseBody(request, passwordChangeSchema);
  const result = await changePassword(user.id, input.currentPassword, input.newPassword, {
    ip: clientIp(request),
  });
  // Sessions were revoked, including this one: the client must send the guest
  // back to sign-in rather than assume the cookie still works.
  return ok({ ...result, reauthenticate: true });
});
