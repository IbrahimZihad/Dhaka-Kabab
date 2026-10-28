import { route, ok, parseBody, assertSameOrigin, clientIp } from "@/lib/api";
import { rateLimit } from "@/lib/auth/rate-limit";
import { passwordResetStartSchema } from "@/server/validation/auth";
import { startPasswordReset } from "@/server/services/auth.service";

export const POST = route(async (request: Request) => {
  assertSameOrigin(request);
  const input = await parseBody(request, passwordResetStartSchema);
  const ip = clientIp(request);
  rateLimit("reset-ip", ip, 8, 600);
  rateLimit("reset-account", `${ip}:${input.email}`, 3, 1800);

  const result = await startPasswordReset(input.email, { ip });
  // Whether or not the address exists, the visitor sees the same sentence. The
  // real delivery outcome stays in the server log so the response cannot be
  // used to enumerate accounts.
  if (!result.delivered) console.info("[password-reset] not delivered", result.reason);
  return ok({ message: "If that address has an account, a reset link is on its way. Check your inbox and spam folder." });
});
