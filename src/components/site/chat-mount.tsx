import { Suspense } from "react";
import { getSettings } from "@/server/services/settings.service";
import { ChatWidget } from "@/components/site/chat-widget";

async function ChatGate() {
  const settings = await getSettings();
  // The switch is the owner's: when the assistant is off, no button appears.
  if (!settings.chatbotEnabled) return null;
  return <ChatWidget />;
}

export function ChatMount() {
  return (
    <Suspense fallback={null}>
      <ChatGate />
    </Suspense>
  );
}
