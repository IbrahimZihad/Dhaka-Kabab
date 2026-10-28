import { route, ok, assertSameOrigin } from "@/lib/api";
import { getCurrentUserFromRequest, destroyCurrentSession } from "@/lib/auth/session";

export const POST = route(async (request: Request) => {
  assertSameOrigin(request);
  const user = await getCurrentUserFromRequest(request);
  if (user) await destroyCurrentSession(user);
  // The client is told the same thing either way; logging out without a session
  // is not a signal worth leaking.
  return ok({ signedOut: true });
});
