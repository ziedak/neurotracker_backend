import { PrismaClient } from "../node_modules/.prisma/client";
import { getEnv, getBooleanEnv } from "@libs/config";
/**
 * Usage:
const users = await PostgreSQLClient.getInstance().user.findMany({
  include: { carts: true }
});

const newUser = await PostgreSQLClient.getInstance().user.create({
  data: { email: 'test@example.com', name: 'Test User' }
});

// Transactions
await PostgreSQLClient.transaction(async (prisma) => {
  const user = await prisma.user.create({ data: { email: 'test@example.com' } });
  const cart = await prisma.cart.create({ data: { userId: user.id } });
  return { user, cart };
});
✅ Available Scripts:
* pnpm db:generate - Generate Prisma client
* pnpm db:push - Push schema to database
* pnpm db:migrate - Run migrations
* pnpm db:studio - Open Prisma Studio
* pnpm db:seed - Seed database with sample data
 */
export class PostgreSQLClient {
  private static instance: PrismaClient;
  private static isConnected = false;

  static getInstance(): PrismaClient {
    if (!PostgreSQLClient.instance) {
      PostgreSQLClient.instance = new PrismaClient({
        datasources: {
          db: {
            url: getEnv(
              "DATABASE_URL",
              "postgresql://postgres:TEST@postgres:5432/neurotracker?schema=public"
            ),
          },
        },
        log: getBooleanEnv("DATABASE_LOGGING")
          ? ["query", "info", "warn", "error"]
          : ["error"],
        errorFormat: "pretty",
      });

      // Connection event handlers (Prisma handles connection pooling internally)
      PostgreSQLClient.isConnected = true;
    }
    return PostgreSQLClient.instance;
  }

  static async connect(): Promise<void> {
    if (!PostgreSQLClient.isConnected) {
      await PostgreSQLClient.getInstance().$connect();
      PostgreSQLClient.isConnected = true;
    }
  }

  static async disconnect(): Promise<void> {
    if (PostgreSQLClient.instance && PostgreSQLClient.isConnected) {
      await PostgreSQLClient.instance.$disconnect();
      PostgreSQLClient.isConnected = false;
    }
  }

  static async ping(): Promise<boolean> {
    try {
      await PostgreSQLClient.getInstance().$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      console.error("PostgreSQL ping failed:", error);
      return false;
    }
  }

  static async healthCheck(): Promise<{
    status: string;
    latency?: number;
    version?: string;
  }> {
    try {
      const start = Date.now();

      // Test connection and get PostgreSQL version
      const versionResult = await PostgreSQLClient.getInstance().$queryRaw<
        { version: string }[]
      >`SELECT version() as version`;
      const version = versionResult[0]?.version;

      const latency = Date.now() - start;

      return {
        status: "healthy",
        latency,
        version,
      };
    } catch (error) {
      console.error("PostgreSQL health check failed:", error);
      return { status: "unhealthy" };
    }
  }

  static isHealthy(): boolean {
    return PostgreSQLClient.isConnected;
  }

  static async executeRaw(query: string, ...params: any[]): Promise<any> {
    try {
      return await PostgreSQLClient.getInstance().$queryRawUnsafe(
        query,
        ...params
      );
    } catch (error) {
      console.error("PostgreSQL raw query failed:", error);
      throw error;
    }
  }

  static async transaction<T>(
    callback: (
      prisma: Omit<
        PrismaClient,
        | "$connect"
        | "$disconnect"
        | "$on"
        | "$transaction"
        | "$use"
        | "$extends"
      >
    ) => Promise<T>
  ): Promise<T> {
    return await PostgreSQLClient.getInstance().$transaction(callback);
  }

  // Prisma provides type-safe database operations through the generated client
  // Example usage:
  // const users = await PostgreSQLClient.getInstance().user.findMany();
  // const user = await PostgreSQLClient.getInstance().user.create({ data: { name: 'John' } });
}
