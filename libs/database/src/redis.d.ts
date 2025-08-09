import Redis from "ioredis";
export declare class RedisClient {
    private static instance;
    private static isConnected;
    static getInstance(): Redis;
    static connect(): Promise<void>;
    static disconnect(): Promise<void>;
    static ping(): Promise<boolean>;
    static healthCheck(): Promise<{
        status: string;
        latency?: number;
    }>;
    static isHealthy(): boolean;
}
