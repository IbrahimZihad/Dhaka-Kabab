import { route, ok } from "@/lib/api";
import { requireApiPermission } from "@/server/http/guards";
import { dashboardSnapshot } from "@/server/services/analytics.service";
import { providerReadiness } from "@/server/services/providers";
import { chatHealth } from "@/server/services/chatbot.service";
import { notificationHealth } from "@/server/services/notification.service";
import { emailTransportStatus } from "@/server/services/email.service";
import { ensureSettings } from "@/server/services/settings.service";

/**
 * Overview screen data. The capability blocks are deliberately honest: an
 * unconfigured gateway or SMTP shows as missing rather than being reported as
 * working, because a restaurant that believes receipts are being emailed will
 * discover the truth from an angry customer.
 */
export const GET = route(async (request: Request) => {
  await requireApiPermission(request, "report:view");
  const [snapshot, gateway, chat, notifications, transport] = await Promise.all([
    dashboardSnapshot(),
    providerReadiness(),
    chatHealth(),
    notificationHealth(),
    emailTransportStatus(),
  ]);
  const settings = await ensureSettings();
  return ok({
    ...snapshot,
    gateway,
    chat,
    notifications,
    email: transport,
    publicSite: {
      addressConfigured: Boolean(settings.addressLine1),
      phoneConfigured: Boolean(settings.phonePrimary),
      hoursConfigured: Array.isArray(settings.openingHours) && settings.openingHours.length > 0,
    },
  });
});
