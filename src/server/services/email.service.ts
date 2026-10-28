import { env } from "@/lib/env";
import { getSettings } from "@/server/services/settings.service";

/**
 * Email transport. The contract is that a result of `ok: true` means an SMTP
 * server accepted the message. Anything else — no credentials, disabled in
 * settings, a connection error — is returned as a reason, never thrown, so a
 * failed email can never roll back an order or a payment.
 */

export type EmailResult = { ok: true; messageId: string } | { ok: false; reason: string };

export type EmailTransportStatus = {
  configured: boolean;
  enabled: boolean;
  from: string | null;
  reason: string | null;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Renders the plain-text body with line breaks preserved; no HTML from user input. */
export function textToHtml(text: string): string {
  return `<div style="font-family:ui-sans-serif,system-ui,sans-serif;font-size:15px;line-height:1.55;color:#1c1917;max-width:560px">${text
    .split("\n")
    .map((line) => (line.trim() === "" ? "<br/>" : `<p style="margin:0 0 12px">${escapeHtml(line)}</p>`))
    .join("")}</div>`;
}

export async function emailTransportStatus(): Promise<EmailTransportStatus> {
  const settings = await getSettings();
  const smtp = env.smtp;
  const from = smtp?.from ?? smtp?.user ?? null;
  if (!smtp) {
    return { configured: false, enabled: settings.emailNotificationsEnabled, from: null, reason: "SMTP_HOST is not set." };
  }
  if (!from) {
    return { configured: true, enabled: settings.emailNotificationsEnabled, from: null, reason: "MAIL_FROM or SMTP_USER must be set." };
  }
  if (!settings.emailNotificationsEnabled) {
    return {
      configured: true,
      enabled: false,
      from,
      reason: "Email notifications are switched off in restaurant settings.",
    };
  }
  return { configured: true, enabled: true, from, reason: null };
}

export async function sendEmail(input: { to: string; toName?: string; subject: string; text: string }): Promise<EmailResult> {
  const settings = await getSettings();
  const smtp = env.smtp;
  if (!smtp) return { ok: false, reason: "SMTP is not configured on this server." };
  const from = smtp.from ?? smtp.user;
  if (!from) return { ok: false, reason: "MAIL_FROM is not configured." };
  if (!settings.emailNotificationsEnabled) {
    return { ok: false, reason: "Email notifications are disabled in settings." };
  }

  const { createTransport } = await import("nodemailer");
  const transport = createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user && smtp.pass ? { user: smtp.user, pass: smtp.pass } : undefined,
  });

  try {
    const info = await transport.sendMail({
      from: `${settings.name} <${from}>`,
      replyTo: settings.emailPublic || undefined,
      to: input.toName ? `${input.toName} <${input.to}>` : input.to,
      subject: input.subject,
      text: input.text,
      html: textToHtml(input.text),
    });
    const messageId = typeof info.messageId === "string" && info.messageId !== "" ? info.messageId : "accepted";
    return { ok: true, messageId };
  } catch (error) {
    // SMTP bodies can echo credentials back in the error text; keep only the shape.
    const message = error instanceof Error ? error.message : "unknown transport error";
    return { ok: false, reason: message.slice(0, 300) };
  } finally {
    transport.close();
  }
}
