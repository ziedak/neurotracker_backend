import { PrismaClient } from "@prisma/client";
import { withAccelerate } from "@prisma/extension-accelerate";
import { getEnv, getBooleanEnv } from "@libs/config";

/**
 * PostgreSQLClient: Singleton for type-safe, resilient Prisma operations
 * - Connection pooling, health checks, transactions, and raw queries
 * - Strict typing, error resilience, and clean architecture
 *
 * Usage Example:
 *   const users = await PostgreSQLClient.getInstance().user.findMany();
 *   await PostgreSQLClient.transaction(async (prisma) => { ... });
 */
export class PostgreSQLClient {
  /**
   * PrismaClient instance extended with Accelerate. Type is 'any' due to extension type ambiguity.
   * Safe usage: always access via getInstance().
   */
  private static instance: unknown;
  private static isConnected = false;

  /**
   * Get singleton PrismaClient instance (with Accelerate extension)
   */
  static getInstance(): PrismaClient {
    if (!PostgreSQLClient.instance) {
      const client = new PrismaClient({
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
      PostgreSQLClient.instance = client.$extends(withAccelerate());
      PostgreSQLClient.isConnected = false;
    }
    return PostgreSQLClient.instance as PrismaClient;
  }

  /**
   * Connect to database (idempotent)
   */
  static async connect(): Promise<void> {
    if (!PostgreSQLClient.isConnected) {
      await PostgreSQLClient.getInstance().$connect();
      PostgreSQLClient.isConnected = true;
    }
  }

  /**
   * Disconnect from database (idempotent)
   */
  static async disconnect(): Promise<void> {
    if (PostgreSQLClient.instance && PostgreSQLClient.isConnected) {
      await (PostgreSQLClient.instance as PrismaClient).$disconnect();
      PostgreSQLClient.isConnected = false;
    }
  }

  /**
   * Ping database for connectivity
   */
  static async ping(): Promise<boolean> {
    try {
      await PostgreSQLClient.getInstance().$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      console.error("PostgreSQL ping failed:", error);
      return false;
    }
  }

  /**
   * Health check: returns status, latency, and version
   */
  static async healthCheck(): Promise<{
    status: "healthy" | "unhealthy";
    latency?: number;
    version?: string;
  }> {
    try {
      const start = Date.now();
      const versionResult = await PostgreSQLClient.getInstance().$queryRaw<
        { version: string }[]
      >`SELECT version() as version`;
      const version =
        typeof versionResult[0]?.version === "string"
          ? versionResult[0].version
          : undefined;
      const latency = Date.now() - start;
      return version !== undefined
        ? { status: "healthy", latency, version }
        : { status: "healthy", latency };
    } catch (error) {
      console.error("PostgreSQL health check failed:", error);
      return { status: "unhealthy" };
    }
  }

  /**
   * Returns connection health status
   */
  static isHealthy(): boolean {
    return PostgreSQLClient.isConnected;
  }

  /**
   * Execute raw SQL query (unsafe, use with caution)
   */
  static async executeRaw(
    query: string,
    ...params: unknown[]
  ): Promise<unknown> {
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

  /**
   * Run a transaction with type-safe Prisma client
   */
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
}
