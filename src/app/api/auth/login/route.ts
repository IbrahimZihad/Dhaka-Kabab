import { route, ok, parseBody, clientIp } from "@/lib/api";
import { rateLimit, RATE_LIMITS } from "@/lib/auth/rate-limit";
import { setSessionCookie, startSession } from "@/lib/auth/session";
import { loginSchema } from "@/server/validation/auth";
import { verifyCredentials } from "@/server/services/auth.service";

export const POST = route(async (request: Request) => {
  const input = await parseBody(request, loginSchema);
  const ip = clientIp(request);
  // Two windows: per address, and per address+account, so one client cannot
  // hammer many accounts from one IP or one account from a small set of IPs.
  rateLimit("login-ip", ip, RATE_LIMITS.login.limit * 10, RATE_LIMITS.login.windowSeconds);
  rateLimit("login", `${ip}:${input.email}`, RATE_LIMITS.login.limit, RATE_LIMITS.login.windowSeconds);

  const user = await verifyCredentials(input.email, input.password);
  const { cookie, maxAge } = await startSession(user, { ip });
  await setSessionCookie(cookie, maxAge);
  return ok(user);
});
