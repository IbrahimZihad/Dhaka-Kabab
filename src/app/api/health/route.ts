import { prisma } from "@/lib/db";
import { route, ok } from "@/lib/api";

/**
 * Liveness probe. Answers only what an operator needs to know without giving an
 * outsider a map of the installation: no versions, no paths, no counts of money —
 * and no statement about the payment gateway either, because "not-configured" tells
 * an attacker which door is unguarded and "sandbox" tells them the till is not live.
 * Staff see the provider truth on every screen that acts on it, through
 * `providerReadiness()` on the authenticated dashboard and settings pages.
 */
export const GET = route(async () => {
  let database = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = true;
  } catch {
    database = false;
  }
  return ok(
    { status: database ? "ok" : "degraded", database, time: new Date().toISOString() },
    { status: database ? 200 : 503 },
  );
});
