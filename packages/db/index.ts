// @anoon/db — единая точка доступа к БД (shared между backend v2 и admin).
// Singleton PrismaClient (в dev переживает hot-reload через globalThis).
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "production" ? ["error"] : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// Реэкспорт типов/enum-ов Prisma для потребителей (import { ReportStatus } from "@anoon/db").
export * from "@prisma/client";
