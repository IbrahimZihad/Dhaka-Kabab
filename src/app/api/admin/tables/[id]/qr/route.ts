import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { requireApiPermission } from "@/server/http/guards";
import { getTableSummary, orderUrlForTable, qrPngBuffer } from "@/server/services/table.service";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";

/**
 * One table's QR code as a PNG, for reprinting a single sticker. The encoded URL
 * carries only the table's public token; rotating that token invalidates every
 * previously printed copy.
 */
export const GET = route(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await requireApiPermission(request, "table:manage");
  const table = await getTableSummary(id);
  const target = orderUrlForTable(table.publicToken, env.appUrl);
  if (!/^https?:\/\//.test(target)) throw new AppError("VALIDATION", "NEXT_PUBLIC_APP_URL is not a full URL.");
  const png = await qrPngBuffer(target);
  return new NextResponse(Uint8Array.from(png), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(png.length),
      "Cache-Control": "no-store",
      "Content-Disposition": `inline; filename="table-${table.label}.png"`,
    },
  });
});
