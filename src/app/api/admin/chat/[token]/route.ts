import { route, ok } from "@/lib/api";
import { requireApiPermission } from "@/server/http/guards";
import { chatTranscript } from "@/server/services/chatbot.service";

/** Full transcript of one conversation, for the staff inbox. */
export const GET = route(async (request: Request, ctx: { params: Promise<{ token: string }> }) => {
  const { token } = await ctx.params;
  await requireApiPermission(request, "chat:view");
  const conversation = await chatTranscript(token);
  return ok({
    id: conversation.id,
    publicToken: conversation.publicToken,
    tableToken: conversation.tableToken,
    startedAt: conversation.startedAt.toISOString(),
    lastActiveAt: conversation.lastActiveAt.toISOString(),
    escalatedAt: conversation.escalatedAt?.toISOString() ?? null,
    escalationReason: conversation.escalationReason,
    fallbackOnly: conversation.fallbackOnly,
    messages: conversation.messages.map((message) => ({
      role: message.role,
      content: message.content,
      usedFallback: message.usedFallback,
      sources: message.sourcesJson,
      at: message.createdAt.toISOString(),
    })),
  });
});
