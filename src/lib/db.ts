import { PrismaClient, type Prisma } from "@prisma/client";

// A single client per process. Next.js dev reloads modules on every compile, so
// the instance is parked on globalThis to avoid exhausting the connection pool.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/** Anything that writes to the database accepts this so it can run inside a transaction. */
export type Db = Prisma.TransactionClient | typeof prisma;
