import Redis from "ioredis";
import { getEnv, getNumberEnv, getBooleanEnv } from "@libs/config";
export class RedisClient {
    static instance;
    static isConnected = false;
    static getInstance() {
        if (!RedisClient.instance) {
            RedisClient.instance = new Redis({
                host: getEnv("REDIS_HOST", "localhost"),
                port: getNumberEnv("REDIS_PORT", 6379),
                password: getEnv("REDIS_PASSWORD"),
                db: getNumberEnv("REDIS_DB", 0),
                username: getEnv("REDIS_USERNAME"),
                // Connection and retry settings
                maxRetriesPerRequest: getNumberEnv("REDIS_MAX_RETRIES", 3),
                connectTimeout: getNumberEnv("REDIS_CONNECT_TIMEOUT", 10000),
                commandTimeout: getNumberEnv("REDIS_COMMAND_TIMEOUT", 5000),
                // Performance optimizations
                lazyConnect: true,
                keepAlive: getNumberEnv("REDIS_KEEP_ALIVE", 30000),
                // TLS support
                tls: getBooleanEnv("REDIS_TLS") ? {} : undefined,
            });
            // Connection event handlers
            RedisClient.instance.on("connect", () => {
                console.log("Redis connected");
                RedisClient.isConnected = true;
            });
            RedisClient.instance.on("error", (error) => {
                console.error("Redis error:", error);
                RedisClient.isConnected = false;
            });
            RedisClient.instance.on("close", () => {
                console.log("Redis connection closed");
                RedisClient.isConnected = false;
            });
        }
        return RedisClient.instance;
    }
    static async connect() {
        if (!RedisClient.isConnected) {
            await RedisClient.getInstance().connect();
        }
    }
    static async disconnect() {
        if (RedisClient.instance && RedisClient.isConnected) {
            await RedisClient.instance.quit();
            RedisClient.isConnected = false;
        }
    }
    static async ping() {
        try {
            const result = await RedisClient.getInstance().ping();
            return result === "PONG";
        }
        catch (error) {
            console.error("Redis ping failed:", error);
            return false;
        }
    }
    static async healthCheck() {
        try {
            const start = Date.now();
            await RedisClient.getInstance().ping();
            const latency = Date.now() - start;
            return { status: "healthy", latency };
        }
        catch (error) {
            return { status: "unhealthy" };
        }
    }
    static isHealthy() {
        return RedisClient.isConnected;
    }
}
//# sourceMappingURL=redis.js.map