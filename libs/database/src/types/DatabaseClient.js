/**
 * @fileoverview Database Client Types for Clean Architecture
 * @module database/types/DatabaseClient
 * @version 1.0.0
 * @author Enterprise Development Team
 */
/**
 * Type guard to ensure database client is properly initialized
 */
export function isDatabaseClient(client) {
    return (typeof client === "object" &&
        client !== null &&
        "$transaction" in client &&
        "$queryRaw" in client &&
        "$connect" in client &&
        "$disconnect" in client);
}
//# sourceMappingURL=DatabaseClient.js.map