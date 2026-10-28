import { z } from "zod";
import { route, ok, parseBody, clientIp, assertSameOrigin } from "@/lib/api";
import { rateLimit } from "@/lib/auth/rate-limit";
import { publicTokenSchema } from "@/server/validation/common";
import { escalateConversation } from "@/server/services/chatbot.service";

const bodySchema = z.object({
  conversationToken: publicTokenSchema,
  reason: z.string().trim().max(300).optional(),
});

/**
 * "Let me speak to a manager." The chat stops guessing and a human is told. The
 * queue is best-effort: if mail is not configured the request still lands in the
 * staff inbox, which is why this answers honestly about what happened.
 */
export const POST = route(async (request: Request) => {
  assertSameOrigin(request);
  const input = await parseBody(request, bodySchema);
  rateLimit("chat-escalate", clientIp(request), 5, 300);

  const result = await escalateConversation(input.conversationToken, input.reason ?? null);
  return ok({
    escalated: true,
    message: "A member of the team has been told you would like to speak to them. They will come over or call you.",
    escalation: result,
  });
});
