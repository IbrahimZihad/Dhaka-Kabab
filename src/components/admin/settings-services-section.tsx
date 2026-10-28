"use client";

import { Panel } from "@/components/admin/admin-ui";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { SettingsSaveBar } from "@/components/admin/settings-save-bar";
import { ToggleField } from "@/components/admin/settings-form";
import {
  currentPayload,
  parseRow,
  useTrackedDraft,
  type SaveResponse,
  type SectionProps,
  type SettingsRow,
  type SettingsWire,
} from "@/components/admin/settings-form";

/**
 * The customer-facing assistant and outbound email. Both depend on environment
 * credentials this screen cannot see or edit (AI_MODEL and AI_API_KEY; SMTP_HOST,
 * SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM), so the switches here only decide
 * whether the restaurant uses them — the readouts say whether the server can
 * actually reach the model or the mail host. A guest must never be led to believe
 * an emailed receipt or an AI answer exists when it does not.
 */

export type ChatHealthView = {
  enabled: boolean;
  fallbackOnly: boolean;
  aiConfigured: boolean;
  aiModel: string | null;
  aiReason: string | null;
  conversationsLast24h: number;
  messagesLast24h: number;
  escalationsLast24h: number;
};

export type EmailHealthView = {
  configured: boolean;
  enabled: boolean;
  from: string | null;
  reason: string | null;
};

type ServicesDraft = {
  chatbotEnabled: boolean;
  chatbotFallbackOnly: boolean;
  emailNotificationsEnabled: boolean;
};

function fromRow(row: SettingsRow): ServicesDraft {
  return {
    chatbotEnabled: row.chatbotEnabled,
    chatbotFallbackOnly: row.chatbotFallbackOnly,
    emailNotificationsEnabled: row.emailNotificationsEnabled,
  };
}

export function SettingsServicesForm({
  row,
  chat,
  email,
  onSaved,
}: SectionProps & { chat: ChatHealthView; email: EmailHealthView }) {
  const action = useAdminAction();
  const { draft, update, reset, markSaved } = useTrackedDraft(row, fromRow);

  // Honest gaps only — nothing here is a bound the server would refuse.
  const warnings: string[] = [];
  if (draft.chatbotEnabled && !draft.chatbotFallbackOnly && !chat.aiConfigured) {
    warnings.push(
      "A language model is wanted but none is configured, so every reply falls back to the menu and these settings. Guests still get honest answers, only shorter ones. Set AI_MODEL and AI_API_KEY where the site runs, or tick the data-only switch.",
    );
  }
  if (draft.emailNotificationsEnabled && !email.configured) {
    warnings.push(
      (email.reason ?? "No mail host is configured on this server.") +
        " Switching this on asks the server to send mail it has nowhere to send through: receipts and booking confirmations will fail until SMTP is configured.",
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const overrides: Partial<SettingsWire> = {
      chatbotEnabled: draft.chatbotEnabled,
      chatbotFallbackOnly: draft.chatbotFallbackOnly,
      emailNotificationsEnabled: draft.emailNotificationsEnabled,
    };
    const response = await action.run<SaveResponse>("PATCH", "/api/admin/settings", {
      ...currentPayload(row),
      ...overrides,
    });
    if (!response) return;
    const next = parseRow(response.settings);
    markSaved();
    onSaved(next);
    action.setNotice(
      next.chatbotEnabled
        ? `Saved. The assistant stays on the website (${
            next.chatbotFallbackOnly ? "menu and settings data only" : "using the configured model if one exists"
          }).`
        : "Saved. The chat bubble on the website will no longer reply, so guests must phone or use the menu page.",
    );
  }

  return (
    <Panel title="Assistant and notifications" description="What the website does on the restaurant's behalf.">
      <form onSubmit={submit}>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <ToggleField
              id="set-chatbot"
              label="Assistant is available on the website"
              checked={draft.chatbotEnabled}
              onChange={(value) => update({ chatbotEnabled: value })}
              hint="Switching it off leaves guests with no chat reply at all."
            />
            <ToggleField
              id="set-chatbot-fallback"
              label="Answer from menu and settings data only (no language model)"
              checked={draft.chatbotFallbackOnly}
              disabled={!draft.chatbotEnabled}
              onChange={(value) => update({ chatbotFallbackOnly: value })}
              hint="On: the assistant quotes the menu and these settings and nothing invented."
            />
          </div>

          <div className="rounded-lg border border-line p-3 text-sm">
            <p className="label">What the assistant can do right now</p>
            <p className="soft">
              {chat.enabled
                ? chat.fallbackOnly
                  ? "Switched on, answering only from the menu, the prices and these settings."
                  : chat.aiConfigured
                    ? `Switched on, using the configured model (${chat.aiModel ?? "unnamed"}).`
                    : "Switched on and expected to use a language model, but none is configured."
                : "Switched off: the chat bubble on the website does not reply."}
            </p>
            <p className="hint mt-2">
              {chat.aiConfigured
                ? "The model and its key are read from AI_MODEL and AI_API_KEY in the deployment environment; no key is stored in this row or shown here."
                : chat.aiReason ?? "AI_API_KEY (or OPENAI_API_KEY) and AI_MODEL are not set on this server."}
            </p>
            <p className="hint mt-2">
              Last 24 hours: {chat.conversationsLast24h} conversation(s), {chat.messagesLast24h} message(s),{" "}
              {chat.escalationsLast24h} handed to staff.
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-3 border-t border-line pt-4">
          <ToggleField
            id="set-email"
            label="Send email from this restaurant (receipts, booking confirmations, hand-offs)"
            checked={draft.emailNotificationsEnabled}
            onChange={(value) => update({ emailNotificationsEnabled: value })}
            hint="Switching this off stops every outbound notification, not just receipts."
          />

          <div className="rounded-lg border border-line p-3 text-sm">
            <p className="label">Outbound mail</p>
            <p className="soft">
              {email.configured
                ? email.enabled
                  ? `A mail host is configured and sending is switched on${email.from ? `; mail goes out as ${email.from}` : ""}.`
                  : "A mail host is configured, but sending is switched off in these settings — guests are not receiving any email right now."
                : "No mail host is configured on this server, so emailed receipts do not exist today however this switch is set."}
            </p>
            {email.reason ? <p className="notice mt-2">{email.reason}</p> : null}
            <p className="hint mt-2">
              SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and MAIL_FROM are set in the deployment environment. This
              screen never shows or accepts a mail password.
            </p>
          </div>

          {warnings.map((warning) => (
            <p key={warning} className="notice notice-error">
              {warning}
            </p>
          ))}
        </div>

        <SettingsSaveBar
          busy={action.busy}
          error={action.error}
          notice={action.notice}
          problems={[]}
          label="Save assistant and notification switches"
          onReset={reset}
        />
      </form>
    </Panel>
  );
}
