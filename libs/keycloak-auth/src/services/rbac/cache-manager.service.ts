import { LRUCache } from "lru-cache";
import { createLogger } from "@libs/utils";

const logger = createLogger("CacheManager");

export interface ICacheManager {
  get(key: string): Promise<{ data: any } | undefined>;
  set(key: string, value: any, ttl: number): Promise<void>;
  invalidatePattern(pattern: string): Promise<void>;
}

export class CacheManager implements ICacheManager {
  private cache: LRUCache<string, { data: any; timestamp: number }>;
  private readonly maxSize: number;
  private readonly defaultTTL: number;

  constructor(maxSize = 50, defaultTTL = 15 * 60 * 1000) {
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTL;
    this.cache = new LRUCache({
      max: this.maxSize,
      ttl: this.defaultTTL,
      allowStale: false,
    });
    logger.info("CacheManager initialized", { maxSize, defaultTTL });
  }

  async get(key: string): Promise<{ data: any } | undefined> {
    const entry = this.cache.get(key);
    if (entry) {
      logger.debug("Cache hit", { key });
      return { data: entry.data };
    }
    logger.debug("Cache miss", { key });
    return undefined;
  }

  async set(key: string, value: any, ttl: number): Promise<void> {
    this.cache.set(key, { data: value, timestamp: Date.now() }, { ttl });
    logger.debug("Cache set", { key, ttl });
  }

  async invalidatePattern(pattern: string): Promise<void> {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(pattern.replace("*", ""))) {
        this.cache.delete(key);
        count++;
      }
    }
    logger.info("Cache invalidated by pattern", { pattern, count });
  }
}
