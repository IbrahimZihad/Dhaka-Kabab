import { z } from "zod";

/** Chat widget messages. Length and history caps bound both cost and abuse. */

export const chatSendSchema = z.object({
  conversationToken: z.string().min(8).max(64).optional(),
  tableToken: z.string().min(8).max(64).optional(),
  message: z
    .string()
    .trim()
    .min(2, "Type a question first.")
    .max(600, "Keep questions under 600 characters."),
  /** Client-side transcript, sent so a stateless widget can keep context. */
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(600) }))
    .max(12, "Only the last few messages are considered.")
    .default([]),
});

export type ChatSendInput = z.infer<typeof chatSendSchema>;
