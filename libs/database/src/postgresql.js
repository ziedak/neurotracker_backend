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
    static instance;
    static isConnected = false;
    static getInstance() {
        if (!PostgreSQLClient.instance) {
            PostgreSQLClient.instance = new PrismaClient({
                datasources: {
                    db: {
                        url: getEnv("DATABASE_URL", "postgresql://postgres:password@localhost:5432/cart_recovery?schema=public"),
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
    static async connect() {
        if (!PostgreSQLClient.isConnected) {
            await PostgreSQLClient.getInstance().$connect();
            PostgreSQLClient.isConnected = true;
        }
    }
    static async disconnect() {
        if (PostgreSQLClient.instance && PostgreSQLClient.isConnected) {
            await PostgreSQLClient.instance.$disconnect();
            PostgreSQLClient.isConnected = false;
        }
    }
    static async ping() {
        try {
            await PostgreSQLClient.getInstance().$queryRaw `SELECT 1`;
            return true;
        }
        catch (error) {
            console.error("PostgreSQL ping failed:", error);
            return false;
        }
    }
    static async healthCheck() {
        try {
            const start = Date.now();
            // Test connection and get PostgreSQL version
            const versionResult = await PostgreSQLClient.getInstance().$queryRaw `SELECT version() as version`;
            const version = versionResult[0]?.version;
            const latency = Date.now() - start;
            return {
                status: "healthy",
                latency,
                version,
            };
        }
        catch (error) {
            console.error("PostgreSQL health check failed:", error);
            return { status: "unhealthy" };
        }
    }
    static isHealthy() {
        return PostgreSQLClient.isConnected;
    }
    static async executeRaw(query, ...params) {
        try {
            return await PostgreSQLClient.getInstance().$queryRawUnsafe(query, ...params);
        }
        catch (error) {
            console.error("PostgreSQL raw query failed:", error);
            throw error;
        }
    }
    static async transaction(callback) {
        return await PostgreSQLClient.getInstance().$transaction(callback);
    }
}
//# sourceMappingURL=postgresql.js.map