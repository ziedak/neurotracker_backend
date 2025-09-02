/**
 * @fileoverview Database Client Types for Clean Architecture
 * @module database/types/DatabaseClient
 * @version 1.0.0
 * @author Enterprise Development Team
 */
import type { PrismaClient } from "@prisma/client";
/**
 * Transaction callback type that matches Prisma's transaction signature
 * This is the standard callback used in database transactions
 */
export type TransactionCallback<T> = (prisma: Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">) => Promise<T>;
/**
 * Database Client type that maintains clean architecture
 * This is the type that repositories should use to interact with the database
 * It extends PrismaClient to ensure compatibility while allowing for future abstractions
 *
 * Using type alias instead of interface to ensure proper type inheritance
 */
export type DatabaseClient = PrismaClient;
/**
 * Type guard to ensure database client is properly initialized
 */
export declare function isDatabaseClient(client: unknown): client is DatabaseClient;
//# sourceMappingURL=DatabaseClient.d.ts.map