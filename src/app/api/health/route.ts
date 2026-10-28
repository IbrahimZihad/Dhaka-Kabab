import { prisma } from "@/lib/db";
import { route, ok } from "@/lib/api";
import { providerReadiness } from "@/server/services/providers";

/**
 * Liveness probe. Answers only what an operator needs to know without giving an
 * outsider a map of the installation: no versions, no paths, no counts of money.
 */
export const GET = route(async () => {
  let database = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = true;
  } catch {
    database = false;
  }
  let gateway = "unknown";
  try {
    const readiness = await providerReadiness();
    gateway = readiness.available ? (readiness.mode ?? "configured") : "not-configured";
  } catch {
    gateway = "error";
  }
  return ok(
    { status: database ? "ok" : "degraded", database, gateway, time: new Date().toISOString() },
    { status: database ? 200 : 503 },
  );
});
