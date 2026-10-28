import { route, ok, clientIp } from "@/lib/api";
import { handleGatewayCallback } from "@/server/services/payment.service";
import { rateLimit } from "@/lib/auth/rate-limit";

/**
 * Server-to-server payment notification. There is deliberately no session and
 * no same-origin check here: the caller is the gateway, not a browser. Safety
 * comes from the provider's own verification (signature plus a validation call
 * from the server), which `handleGatewayCallback` performs before any money is
 * recorded. A body that cannot be verified leaves the payment PENDING.
 */
export const POST = route(
  async (request: Request) => {
    // A gateway retry storm is legitimate traffic; the window is generous and the
    // handler is idempotent, so repeats are acknowledged rather than re-applied.
    rateLimit("gateway-callback", clientIp(request), 300, 60);
    const result = await handleGatewayCallback(request);
    return ok({
      received: true,
      status: result.status,
      duplicate: result.duplicate,
      /** Whether this money is real or simulated — surfaced so a demo never reads as revenue. */
      isDemo: "isDemo" in result ? result.isDemo : undefined,
    });
  },
  { allowForeignOrigin: true },
);
