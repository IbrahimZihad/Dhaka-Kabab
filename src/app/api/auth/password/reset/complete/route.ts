import { route, ok, parseBody, assertSameOrigin, clientIp } from "@/lib/api";
import { rateLimit } from "@/lib/auth/rate-limit";
import { passwordResetCompleteSchema } from "@/server/validation/auth";
import { completePasswordReset } from "@/server/services/auth.service";

export const POST = route(async (request: Request) => {
  assertSameOrigin(request);
  const input = await parseBody(request, passwordResetCompleteSchema);
  rateLimit("reset-complete", clientIp(request), 10, 600);

  await completePasswordReset(input.token, input.newPassword);
  // No session is issued here: the reset link told us the mailbox was reachable,
  // not that this person knows the password.
  return ok({ message: "Password changed. Sign in with the new password." });
});
