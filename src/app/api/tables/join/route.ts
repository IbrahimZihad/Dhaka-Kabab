import { route, ok, parseBody, clientIp, assertSameOrigin } from "@/lib/api";
import { rateLimit } from "@/lib/auth/rate-limit";
import { sessionJoinSchema } from "@/server/validation/table";
import { joinSessionByTableToken } from "@/server/services/table.service";

/** Guest entry point after a QR scan: binds this device to the table's session. */
export const POST = route(async (request: Request) => {
  assertSameOrigin(request);
  const input = await parseBody(request, sessionJoinSchema);
  rateLimit("table-join", clientIp(request), 40, 300);
  const session = await joinSessionByTableToken(input.tableToken, {
    participantToken: input.participantToken,
    label: input.label,
  });
  return ok(session);
});
