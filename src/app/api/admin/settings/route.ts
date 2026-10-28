import { route, ok, parseBody, clientIp } from "@/lib/api";
import { mutationUser, requireApiPermission } from "@/server/http/guards";
import { getSettings, updateSettings } from "@/server/services/settings.service";
import { settingsInputSchema } from "@/server/validation/settings";
import { providerReadiness } from "@/server/services/providers";
import { chatHealth } from "@/server/services/chatbot.service";
import { emailTransportStatus } from "@/server/services/email.service";
import { env } from "@/lib/env";
import { revalidateSettings } from "@/lib/revalidate";

/**
 * GET returns the settings row plus presence flags for environment-only secrets.
 * Secret values are never read here: the settings screen shows "configured" or
 * "missing", which is all an operator can safely see.
 */
export const GET = route(async (request: Request) => {
  await requireApiPermission(request, "settings:manage");
  const [settings, gateway, chat, email] = await Promise.all([
    getSettings(),
    providerReadiness(),
    chatHealth(),
    emailTransportStatus(),
  ]);
  return ok({
    settings,
    environment: {
      appUrl: env.appUrl,
      isProduction: env.isProduction,
      gatewayMode: gateway.mode,
      gatewayRealCredentials: gateway.realCredentials,
      gatewayMissing: gateway.missing,
      aiConfigured: chat.aiConfigured,
      aiModel: chat.aiModel,
      aiReason: chat.aiReason,
      smtpConfigured: email.configured,
      smtpReason: email.reason,
      callbackUrl: `${env.appUrl}/api/payments/gateway/callback`,
    },
  });
});

/**
 * Owner-only save. Every field is re-validated server-side; the charge settings
 * in particular cannot be smuggled past the basis-point bounds by editing the form.
 */
export const PATCH = route(async (request: Request) => {
  const user = await mutationUser(request, "settings:manage");
  const patch = await parseBody(request, settingsInputSchema);
  const settings = await updateSettings(patch, { userId: user.id, role: user.role }, { ip: clientIp(request) });
  revalidateSettings();
  return ok({ settings });
});
