import { ClickHouseClient as CHClient } from "@clickhouse/client";
export declare class ClickHouseClient {
    private static instance;
    private static isConnected;
    static getInstance(): CHClient;
    static disconnect(): Promise<void>;
    static ping(): Promise<boolean>;
    static healthCheck(): Promise<{
        status: string;
        latency?: number;
        version?: string;
    }>;
    static isHealthy(): boolean;
    static execute(query: string, values?: Record<string, unknown>): Promise<any>;
    static insert(table: string, data: any[], format?: string): Promise<void>;
}
