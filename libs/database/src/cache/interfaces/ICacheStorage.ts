import type { RedisKey, ChainableCommander, Callback } from "ioredis";
import type { Redis } from "ioredis";

/**
 * Interface for cache storage backend
 * This allows dependency inversion - CacheService doesn't depend on specific Redis implementation
 */
export interface ICacheStorage {
  // Basic operations
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<boolean>;
  del(...keys: RedisKey[]): Promise<number>;
  setex(key: string, ttl: number, value: string): Promise<boolean>;

  // Pattern operations
  keys(pattern: string): Promise<string[]>;
  scan(
    cursor: string | number,
    patternToken: "MATCH",
    pattern: string,
    countToken: "COUNT",
    count: string | number,
    callback?: Callback<[cursor: string, elements: string[]]>
  ): Promise<[cursor: string, elements: string[]]>;

  // Batch operations
  pipeline(): Promise<ChainableCommander>;

  // Pub/Sub operations
  publish(channel: string, message: string): Promise<number>;

  // Connection management
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  ping(): Promise<boolean>;
  isHealthy(): boolean;
  isAvailable(): Promise<boolean>;

  // Health and stats
  healthCheck(): Promise<{
    status: string;
    latency?: number;
    connectionState?: string;
    retryCount?: number;
  }>;

  getStats(): {
    isConnected: boolean;
    retryCount: number;
    connectionStatus: string;
  };

  // For services that need the raw Redis client
  getRawClient(): Redis;
}
