import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth/session";
import { ROLE_LABELS, roleHasPermission } from "@/lib/auth/rbac";
import { env } from "@/lib/env";
import { bpsToPercentLabel, formatPoisa } from "@/lib/money";
import { parseOpeningHours } from "@/lib/time";
import { orUnset, siteContext } from "@/server/http/site";
import { ensureSettings } from "@/server/services/settings.service";
import { providerReadiness } from "@/server/services/providers";
import { chatHealth } from "@/server/services/chatbot.service";
import { emailTransportStatus } from "@/server/services/email.service";
import { Note, Panel, StatusBadge } from "@/components/admin/admin-ui";
import { SettingsForm, SettingsFormSkeleton, type SettingsRow } from "@/components/admin/settings-form";
import type { GatewayReadinessView } from "@/components/admin/settings-payments-section";
import type { ChatHealthView, EmailHealthView } from "@/components/admin/settings-services-section";

/**
 * The owner's screen for everything the restaurant configures.
 *
 * The row is read straight from the settings service rather than through the
 * admin API, because a server component may call a service directly; the browser
 * PATCHes /api/admin/settings when a section is saved. Every read here (the
 * signed-in role, the row, the gateway, the assistant, the mail host) is
 * request-time, so it all streams inside the page's single Suspense boundary.
 *
 * No credential value is read or rendered anywhere on this page: the row handed
 * to the form is assembled field by field and deliberately omits the gateway's
 * stored `paymentStoreId`. Where a capability depends on the environment, the
 * readiness helpers say which variable is missing, and the screen repeats their
 * words — never implying that email, online payment or an AI assistant work when
 * they do not.
 */

async function SettingsView() {
  const user = await getCurrentUser();
  if (!user) return null;

  if (!roleHasPermission(user.role, "settings:manage")) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="hint mt-1">Charges, opening hours, payments and contact details.</p>
        </div>
        <Panel title="Only the owner may change these" description="Nothing on this screen is editable from your account.">
          <p className="text-sm soft">
            Your role is {ROLE_LABELS[user.role]}. Service charges, VAT, the delivery fee and the payment gateway are
            set by the {ROLE_LABELS.OWNER} account, because a wrong figure here is charged to every guest in the
            restaurant. If something needs changing, ask the {ROLE_LABELS.OWNER} to change it here — a manager cannot
            save these forms even if they were shown.
          </p>
          <p className="hint mt-3">
            The charges currently in force are shown on the overview page, and the bills record what each guest was
            actually charged.
          </p>
        </Panel>
      </div>
    );
  }

  const [stored, gateway, chat, email, site] = await Promise.all([
    ensureSettings(),
    providerReadiness(),
    chatHealth(),
    emailTransportStatus(),
    siteContext(),
  ]);

  // Field by field — never a spread. `paymentStoreId` and any other
  // credential-shaped column must not cross into the client tree.
  const row: SettingsRow = {
    name: stored.name,
    logoUrl: stored.logoUrl,
    addressLine1: stored.addressLine1,
    addressLine2: stored.addressLine2,
    city: stored.city,
    country: stored.country,
    phonePrimary: stored.phonePrimary,
    phoneSecondary: stored.phoneSecondary,
    emailPublic: stored.emailPublic,
    mapsUrl: stored.mapsUrl,
    facebookUrl: stored.facebookUrl,
    instagramUrl: stored.instagramUrl,
    contactNote: stored.contactNote,
    timezone: stored.timezone,
    currencyCode: stored.currencyCode,
    currencySymbol: stored.currencySymbol,
    openingHours: parseOpeningHours(stored.openingHours),
    serviceChargeBps: stored.serviceChargeBps,
    vatBps: stored.vatBps,
    vatOnServiceCharge: stored.vatOnServiceCharge,
    roundingStepPoisa: stored.roundingStepPoisa,
    reservationSlotMinutes: stored.reservationSlotMinutes,
    reservationDurationMinutes: stored.reservationDurationMinutes,
    reservationBufferMinutes: stored.reservationBufferMinutes,
    reservationMaxDaysAhead: stored.reservationMaxDaysAhead,
    reservationCutoffMinutes: stored.reservationCutoffMinutes,
    reservationDepositPoisa: stored.reservationDepositPoisa,
    requirePolicyAcceptance: stored.requirePolicyAcceptance,
    allowDineIn: stored.allowDineIn,
    allowTakeaway: stored.allowTakeaway,
    allowDelivery: stored.allowDelivery,
    deliveryFeePoisa: stored.deliveryFeePoisa,
    autoConfirmOrders: stored.autoConfirmOrders,
    enablePartialPayments: stored.enablePartialPayments,
    paymentProvider: stored.paymentProvider,
    chatbotEnabled: stored.chatbotEnabled,
    chatbotFallbackOnly: stored.chatbotFallbackOnly,
    emailNotificationsEnabled: stored.emailNotificationsEnabled,
    receiptHeader: stored.receiptHeader,
    receiptFooter: stored.receiptFooter,
  };

  const readiness: GatewayReadinessView = {
    configured: gateway.configured,
    available: gateway.available,
    realCredentials: gateway.realCredentials,
    label: gateway.label,
    mode: gateway.mode,
    missing: gateway.missing,
  };
  const chatView: ChatHealthView = chat;
  const emailView: EmailHealthView = email;

  const symbol = row.currencySymbol || "৳";

  const gaps: string[] = [];
  if (!row.addressLine1.trim()) gaps.push("No street address is recorded, so the website cannot tell guests where you are.");
  if (row.openingHours.length === 0) gaps.push("Opening hours have never been recorded: the website says so to guests instead of inventing a time, and the booking form has no slot to offer.");
  if (!row.phonePrimary.trim()) gaps.push("No phone number is recorded, so a guest with a problem has no way to call.");
  if (gateway.configured === "none") gaps.push("No online payment gateway is chosen, so every bill is settled at the counter. Choose one under Payments when you are ready to take payments online.");
  else if (!gateway.available) gaps.push(`Online payment is not reachable on this server: ${gateway.missing.join(", ") || "the gateway"} is not configured. Guests can still pay at the counter.`);
  if (!email.configured) gaps.push(`${email.reason ?? "SMTP is not configured"}, so emailed receipts and booking confirmations do not exist today.`);
  else if (!email.enabled) gaps.push("A mail host is configured but email sending is switched off in settings, so guests receive nothing.");
  if (chat.enabled && !chat.fallbackOnly && !chat.aiConfigured) gaps.push(`${chat.aiReason ?? "No AI model is configured"}, so the assistant only answers from the menu and these settings.`);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="hint mt-1">
          Everything the restaurant tells a guest and charges one. Saved row: {row.name}, {orUnset(row.city)},{" "}
          {row.currencyCode}. Each section below saves on its own request; nothing is applied until the server accepts
          it.
        </p>
        <p className="hint mt-1">
          On caching, honestly: the guest pages and footer re-read this row on every request, so a saved change reaches
          the next visitor within seconds. One part is not invalidated on save — the site title and page metadata are
          held in the Next.js data cache under the settings tag for up to an hour, and no code refreshes that tag, so a
          renamed restaurant can linger in old titles and search previews for a while.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-4">
          <p className="label">Right now, in {row.timezone}</p>
          <p className="mt-1 flex items-center gap-2">
            <StatusBadge status={site.open ? "Open" : "Closed"} />
            <span className="hint">{site.clock} on {site.todayKey}</span>
          </p>
          <p className="hint mt-2">{site.hours}</p>
        </div>
        <div className="card p-4">
          <p className="label">Charges in force</p>
          <p className="mt-1 text-lg font-bold">
            {bpsToPercentLabel(row.serviceChargeBps)}% service · {bpsToPercentLabel(row.vatBps)}% VAT
          </p>
          <p className="hint mt-1">
            {row.vatOnServiceCharge ? "VAT on food plus service charge" : "VAT on food only"} · totals rounded to the
            nearest {formatPoisa(row.roundingStepPoisa, { symbol })}
          </p>
        </div>
        <div className="card p-4">
          <p className="label">Delivery and deposits</p>
          <p className="mt-1 text-lg font-bold">
            {formatPoisa(row.deliveryFeePoisa, { symbol })} delivery · {formatPoisa(row.reservationDepositPoisa, { symbol })}{" "}
            deposit
          </p>
          <p className="hint mt-1">
            {[
              row.allowDineIn ? "dine-in" : null,
              row.allowTakeaway ? "takeaway" : null,
              row.allowDelivery ? "delivery" : null,
            ]
              .filter((value): value is string => value !== null)
              .join(", ") || "no ordering channel is switched on"}
          </p>
        </div>
        <div className="card p-4">
          <p className="label">Money and mail</p>
          <p className="mt-1 text-lg font-bold">{gateway.label}</p>
          <p className="hint mt-1">
            {email.configured
              ? email.enabled
                ? "Email is configured and switched on."
                : "Email is configured but switched off in settings."
              : email.reason ?? "Email is not configured."}
          </p>
        </div>
      </div>

      {gaps.length > 0 ? (
        <Panel title="What is missing, and what a guest feels" description="In the same spirit as the overview's attention list.">
          <ul className="space-y-2 text-sm">
            {gaps.map((gap) => (
              <li key={gap} className="rounded-md border border-line px-3 py-2">
                {gap}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {row.openingHours.length === 0 ? <Note>Record at least one opening range below, or bookings stay impossible.</Note> : null}
      {!gateway.available ? (
        <Note kind="error">
          Online payment is not reachable on this server right now: {gateway.missing.join(", ") || "the gateway"} is
          not set in the deployment environment. Guests can still pay at the counter.
        </Note>
      ) : null}

      <SettingsForm
        settings={row}
        gateway={readiness}
        chat={chatView}
        email={emailView}
        callbackUrl={`${env.appUrl}/api/payments/gateway/callback`}
      />

      <Panel title="What this screen does not hold" description="Credentials are environment-only, by design.">
        <div className="card p-4 text-sm soft">
          The gateway&apos;s SSLCOMMERZ_STORE_ID and SSLCOMMERZ_API_KEY, the assistant&apos;s AI_API_KEY and AI_MODEL,
          and SMTP_HOST with SMTP_USER, SMTP_PASS and MAIL_FROM are set where the site runs. This form cannot show,
          send or change them, which is why the readouts above say configured or missing instead of printing a value.
        </div>
        <p className="hint mt-3">
          One gap to be aware of: the settings API does accept a `paymentStoreId` value, and a GET of the settings row
          returns it. This screen exposes no field for it and never renders it, so nothing stored there is displayed or
          edited here.
        </p>
      </Panel>
    </div>
  );
}

export default function AdminSettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <div className="space-y-2">
            <span className="skeleton block h-9 w-48" />
            <span className="skeleton block h-4 w-full max-w-2xl" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <span key={index} className="skeleton block h-28" />
            ))}
          </div>
          <SettingsFormSkeleton />
        </div>
      }
    >
      <SettingsView />
    </Suspense>
  );
}
