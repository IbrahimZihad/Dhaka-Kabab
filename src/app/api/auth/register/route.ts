import { route, ok, parseBody, clientIp } from "@/lib/api";
import { rateLimit, RATE_LIMITS } from "@/lib/auth/rate-limit";
import { setSessionCookie, startSession } from "@/lib/auth/session";
import { registerSchema } from "@/server/validation/auth";
import { signUpCustomer } from "@/server/services/auth.service";

export const POST = route(async (request: Request) => {
  const input = await parseBody(request, registerSchema);
  const ip = clientIp(request);
  rateLimit("register", ip, RATE_LIMITS.register.limit, RATE_LIMITS.register.windowSeconds);

  const user = await signUpCustomer(input, { ip });
  const { cookie, maxAge } = await startSession(user, { ip });
  await setSessionCookie(cookie, maxAge);
  return ok(user, { status: 201 });
});
