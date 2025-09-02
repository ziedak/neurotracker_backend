import { createClient } from "@clickhouse/client";
import { getEnv, getNumberEnv, getBooleanEnv } from "@libs/config";
import { Logger } from "@libs/monitoring";
import { executeWithRetry } from "@libs/utils";
export class ClickHouseClient {
    static logger = new Logger({ service: "ClickHouseClient" });
    static instance;
    static isConnected = false;
    static getInstance() {
        if (!ClickHouseClient.instance) {
            ClickHouseClient.instance = createClient({
                url: getEnv("CLICKHOUSE_URL", "http://localhost:8123"),
                username: getEnv("CLICKHOUSE_USERNAME", "default"),
                password: getEnv("CLICKHOUSE_PASSWORD", ""),
                database: getEnv("CLICKHOUSE_DATABASE", "cart_recovery"),
                // Connection settings (using correct property names for @clickhouse/client)
                request_timeout: getNumberEnv("CLICKHOUSE_REQUEST_TIMEOUT", 30000),
                max_open_connections: getNumberEnv("CLICKHOUSE_MAX_CONNECTIONS", 10),
                // Compression
                compression: {
                    response: getBooleanEnv("CLICKHOUSE_COMPRESSION", true),
                    request: getBooleanEnv("CLICKHOUSE_REQUEST_COMPRESSION", false),
                },
            });
            ClickHouseClient.isConnected = true;
        }
        return ClickHouseClient.instance;
    }
    static async disconnect() {
        if (ClickHouseClient.instance && ClickHouseClient.isConnected) {
            await ClickHouseClient.instance.close();
            ClickHouseClient.isConnected = false;
        }
    }
    static async ping() {
        try {
            const result = await ClickHouseClient.getInstance().ping();
            return result.success;
        }
        catch (error) {
            ClickHouseClient.logger.error("ClickHouse ping failed", error);
            return false;
        }
    }
    static async healthCheck() {
        try {
            const start = Date.now();
            const pingResult = await ClickHouseClient.getInstance().ping();
            const latency = Date.now() - start;
            if (pingResult.success) {
                // Get ClickHouse version for additional health info
                const versionResult = await ClickHouseClient.getInstance().query({
                    query: "SELECT version() as version",
                    format: "JSONEachRow",
                });
                const version = await versionResult.json();
                return {
                    status: "healthy",
                    latency,
                    ...(typeof version[0]?.version === "string" && {
                        version: version[0].version,
                    }),
                };
            }
            return { status: "unhealthy" };
        }
        catch (error) {
            ClickHouseClient.logger.error("ClickHouse health check failed", error);
            return { status: "unhealthy" };
        }
    }
    static isHealthy() {
        return ClickHouseClient.isConnected;
    }
    static async execute(query, values) {
        try {
            return await executeWithRetry(async () => {
                const result = await ClickHouseClient.getInstance().query({
                    query,
                    query_params: values ?? {},
                    format: "JSONEachRow",
                });
                return await result.json();
            }, (error) => {
                ClickHouseClient.logger.error("ClickHouse query failed", error);
            });
        }
        catch (error) {
            ClickHouseClient.logger.error("ClickHouse query failed (final)", error);
            throw error;
        }
    }
    static async insert(table, data, format = "JSONEachRow") {
        try {
            await executeWithRetry(async () => {
                await ClickHouseClient.getInstance().insert({
                    table,
                    values: data,
                    format: format,
                });
            }, (error) => ClickHouseClient.logger.error("ClickHouse insert failed", error));
        }
        catch (error) {
            ClickHouseClient.logger.error("ClickHouse insert failed (final)", error);
            throw error;
        }
    }
}
//# sourceMappingURL=clickhouseClient.js.map