import { RedisClient, type RedisConfig } from "../redis/redisClient";
import { ClickHouseClient } from "../clickhouse/clickhouseClient";
import { type IMetricsCollector } from "@libs/monitoring";

/**
 * Service Factory for creating database clients with clean interfaces.
 * Provides simple factory methods without framework coupling.
 */
export class DatabaseFactory {
  /**
   * Create Redis client instance.
   */
  static createRedis(
    config: RedisConfig = {},
    metrics?: IMetricsCollector
  ): RedisClient {
    return RedisClient.create(config, metrics);
  }

  /**
   * Create ClickHouse client instance.
   */
  static createClickHouse(metrics?: IMetricsCollector): ClickHouseClient {
    return ClickHouseClient.create(metrics);
  }
}
