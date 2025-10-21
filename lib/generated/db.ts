// backend/lib/db.ts
import { PrismaClient } from "@prisma/client";

declare global {
  // Prevent multiple PrismaClient instances in development
  // (important for hot reloads with ts-node-dev)
  var prisma: PrismaClient | undefined;
}

export const db = global.prisma || new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.prisma = db;
}
