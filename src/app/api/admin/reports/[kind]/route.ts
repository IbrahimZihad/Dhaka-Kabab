import { z } from "zod";
import { NextResponse } from "next/server";
import { route, parseQuery } from "@/lib/api";
import { requireApiPermission } from "@/server/http/guards";
import { buildReport, toCsv, windowFor, type ReportKind } from "@/server/services/analytics.service";
import { getSettings } from "@/server/services/settings.service";
import { dayRange } from "@/lib/time";
import { dateKeySchema } from "@/server/validation/common";
import { AppError } from "@/lib/errors";

const KINDS = ["sales", "orders", "items", "payments", "reservations", "tables", "customers"] as const;

const querySchema = z.object({
  range: z.enum(["today", "yesterday", "7d", "30d", "month", "custom"]).default("30d"),
  from: dateKeySchema.optional(),
  to: dateKeySchema.optional(),
});

/**
 * CSV download. Amounts are exported as integer poisa next to a formatted label,
 * so a spreadsheet never has to guess the minor unit and floats cannot drift the
 * totals. Demo-flagged rows keep their flag in the export.
 */
export const GET = route(async (request: Request, ctx: { params: Promise<{ kind: string }> }) => {
  await requireApiPermission(request, "report:view");
  const { kind } = await ctx.params;
  if (!KINDS.includes(kind as (typeof KINDS)[number])) {
    throw new AppError("NOT_FOUND", `Unknown report. Choose one of: ${KINDS.join(", ")}.`);
  }
  const query = parseQuery(new URL(request.url).searchParams, querySchema);
  const settings = await getSettings();

  let custom;
  if (query.range === "custom") {
    if (!query.from || !query.to) throw new AppError("VALIDATION", "Choose a start and end date.");
    const fromDay = dayRange(query.from, settings.timezone);
    const toDay = dayRange(query.to, settings.timezone);
    if (toDay.end <= fromDay.start) throw new AppError("VALIDATION", "The end date must be on or after the start date.");
    custom = { from: fromDay.start, to: toDay.end };
  }

  const report = await buildReport(kind as ReportKind, windowFor(query.range, settings.timezone, custom));
  const body = toCsv(report.rows as Record<string, unknown>[], report.headers);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${report.filename}"`,
      "Cache-Control": "no-store",
    },
  });
});
