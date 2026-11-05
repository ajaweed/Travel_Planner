import { PrismaClient } from "@prisma/client";

// Standard Next.js-safe singleton so hot-reload in dev doesn't exhaust
// SQLite/Postgres connections.
declare global {
  // eslint-disable-next-line no-var
  var __tripPlannerPrisma: PrismaClient | undefined;
}

export const prisma = globalThis.__tripPlannerPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__tripPlannerPrisma = prisma;
}

export * from "@prisma/client";
