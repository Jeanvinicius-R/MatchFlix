import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Reuses a single PrismaClient (and its connection pool) across hot
 * reloads in development. Without this, each edit would open a new pool.
 */
const globalForPrisma = globalThis as unknown as {
  prisma?: InstanceType<typeof PrismaClient>;
};

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL não está definida. Configure o arquivo .env.");
}

/**
 * DATABASE_DRIVER="neon-ws" conecta ao Neon por WebSocket (porta 443) em vez
 * do protocolo Postgres (porta 5432) — para redes que bloqueiam a 5432.
 */
const adapter =
  process.env.DATABASE_DRIVER === "neon-ws"
    ? new PrismaNeon({ connectionString: databaseUrl })
    : new PrismaPg({ connectionString: databaseUrl });

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
