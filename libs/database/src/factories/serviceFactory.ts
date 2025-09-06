import { container } from "tsyringe";
import { RedisClient } from "../redis/redisClient";
import { ClickHouseClient } from "../clickhouse/clickhouseClient";

/**
 * Service Factory for bridging TSyringe DI with existing ServiceContainer pattern.
 * Provides getInstance-style methods for backward compatibility.
 */
export class ServiceFactory {
  private static redisInstance: RedisClient;
  private static clickhouseInstance: ClickHouseClient;
  /**
   * Get Redis client instance (singleton).
   */
  static getRedisClient(): RedisClient {
    if (!this.redisInstance) {
      // Register dependencies if not already registered

      this.redisInstance = container.resolve(RedisClient);
    }
    return this.redisInstance;
  }

  /**
   * Get ClickHouse client instance (enterprise version).
   */
  static getClickHouseClient(): ClickHouseClient {
    if (!this.clickhouseInstance) {
      this.clickhouseInstance = container.resolve(ClickHouseClient);
    }
    return this.clickhouseInstance;
  }

  /**
   * Clean up all cached instances.
   * Useful for testing or graceful shutdown.
   */
  static cleanup() {
    this.redisInstance = undefined as any;
    this.clickhouseInstance = undefined as any;
  }
}
