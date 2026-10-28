import { route, ok, parseBody, clientIp, assertSameOrigin } from "@/lib/api";
import { rateLimit, RATE_LIMITS } from "@/lib/auth/rate-limit";
import { chatSendSchema } from "@/server/validation/chat";
import { askChatbot } from "@/server/services/chatbot.service";

/**
 * Public assistant. The reply is composed from database facts; the AI, when
 * configured, is only asked to phrase those facts. Every answer says plainly
 * whether a model was involved, so a guest is never sold a guess as a fact.
 */
export const POST = route(async (request: Request) => {
  assertSameOrigin(request);
  const input = await parseBody(request, chatSendSchema);
  const ip = clientIp(request);
  rateLimit("chat", ip, RATE_LIMITS.chat.limit, RATE_LIMITS.chat.windowSeconds);
  if (input.conversationToken) {
    rateLimit("chat-thread", input.conversationToken, 12, RATE_LIMITS.chat.windowSeconds);
  }

  const answer = await askChatbot(input);
  return ok(answer);
});
