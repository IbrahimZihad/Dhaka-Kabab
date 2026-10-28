import { z } from "zod";
import { route, ok, parseQuery } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { requireApiPermission } from "@/server/http/guards";
import { getSettings } from "@/server/services/settings.service";
import {
  categorySales,
  dailySales,
  demandHeatmap,
  kitchenPerformance,
  paymentCollection,
  reservationStats,
  tableUtilisation,
  topItems,
  windowFor,
} from "@/server/services/analytics.service";
import { dayRange } from "@/lib/time";
import { dateKeySchema } from "@/server/validation/common";

const querySchema = z.object({
  range: z.enum(["today", "yesterday", "7d", "30d", "month", "custom"]).default("today"),
  from: dateKeySchema.optional(),
  to: dateKeySchema.optional(),
});

/**
 * One call returns every figure the reports screen draws. "Sales" (order totals
 * raised) and "collected" (verified payments) stay separate keys — they differ
 * legitimately while tables are still open, and merging them would misstate takings.
 */
export const GET = route(async (request: Request) => {
  await requireApiPermission(request, "report:view");
  const query = parseQuery(new URL(request.url).searchParams, querySchema);
  const settings = await getSettings();

  const custom =
    query.range === "custom"
      ? (() => {
          if (!query.from || !query.to) throw new AppError("VALIDATION", "Choose a start and end date.");
          const fromDay = dayRange(query.from, settings.timezone);
          const toDay = dayRange(query.to, settings.timezone);
          if (toDay.end <= fromDay.start) throw new AppError("VALIDATION", "The end date must be on or after the start date.");
          return { from: fromDay.start, to: toDay.end };
        })()
      : undefined;

  const dateWindow = windowFor(query.range, settings.timezone, custom);
  const [sales, collections, items, categories, heatmap, kitchen, reservations, tables] = await Promise.all([
    dailySales(dateWindow),
    paymentCollection(dateWindow),
    topItems(dateWindow, 15),
    categorySales(dateWindow),
    demandHeatmap(dateWindow),
    kitchenPerformance(dateWindow),
    reservationStats(dateWindow),
    tableUtilisation(dateWindow),
  ]);

  return ok({
    window: { from: dateWindow.from.toISOString(), to: dateWindow.to.toISOString(), range: query.range },
    currencySymbol: settings.currencySymbol,
    currencyCode: settings.currencyCode,
    timezone: settings.timezone,
    sales,
    collections,
    items,
    categories,
    heatmap,
    kitchen,
    reservations,
    tables,
  });
});
