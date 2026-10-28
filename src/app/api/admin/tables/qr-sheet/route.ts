import { route, ok } from "@/lib/api";
import { requireApiPermission } from "@/server/http/guards";
import { env } from "@/lib/env";
import { buildQrSheet } from "@/server/services/table.service";

/**
 * QR stickers for every enabled table. The codes are built from the configured
 * public URL: if NEXT_PUBLIC_APP_URL still points at localhost the sheet says so,
 * because a printed sticker that opens nothing is worse than no sheet at all.
 */
export const GET = route(async (request: Request) => {
  await requireApiPermission(request, "table:manage");
  const appUrl = env.appUrl;
  const sheet = await buildQrSheet(appUrl);
  return ok({
    appUrl,
    looksLocal: /localhost|127\.0\.0\.1/.test(appUrl),
    tables: sheet,
    printedWith: new Date().toISOString(),
  });
});
