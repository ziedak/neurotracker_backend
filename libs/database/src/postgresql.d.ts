import { PrismaClient } from "../node_modules/.prisma/client";
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
export declare class PostgreSQLClient {
    private static instance;
    private static isConnected;
    static getInstance(): PrismaClient;
    static connect(): Promise<void>;
    static disconnect(): Promise<void>;
    static ping(): Promise<boolean>;
    static healthCheck(): Promise<{
        status: string;
        latency?: number;
        version?: string;
    }>;
    static isHealthy(): boolean;
    static executeRaw(query: string, ...params: any[]): Promise<any>;
    static transaction<T>(callback: (prisma: Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">) => Promise<T>): Promise<T>;
}
