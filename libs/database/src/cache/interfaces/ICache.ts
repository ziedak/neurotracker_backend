export interface CacheConfig {
  readonly defaultTTL: number; // seconds
  readonly enable: boolean;
  readonly warmupOnStart?: boolean;
  readonly warmingConfig?: CacheWarmingConfig;
}

export interface CacheWarmingConfig {
  readonly enableBackgroundWarming?: boolean;
  readonly backgroundWarmingInterval?: number; // seconds
  readonly adaptiveWarming?: boolean;
  readonly maxWarmupKeys?: number;
  readonly warmupBatchSize?: number;
  readonly enablePatternLearning?: boolean;
}

export interface WarmupDataProvider<T = any> {
  getWarmupKeys(): Promise<string[]>;
  loadDataForKey(key: string): Promise<T | null>;
  getKeyPriority(key: string): number; // Higher number = higher priority
}

export interface CacheWarmingStrategy {
  readonly name: string;
  warmup(
    cache: ICache,
    provider: WarmupDataProvider
  ): Promise<CacheWarmingResult>;
  getRecommendedKeys(): string[];
}

export interface CacheWarmingResult {
  success: boolean;
  keysProcessed: number;
  keysFailed: number;
  duration: number;
  errors: string[];
}

export interface AccessPattern {
  key: string;
  accessCount: number;
  lastAccessed: number;
  averageLatency: number;
  priority: number;
}
export interface CacheOperationResult<T> {
  data: T | null;
  source: string | "miss";
  latency: number;
  compressed: boolean;
}

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
  hits: number;
  compressed: boolean;
  compressionAlgorithm?: string; // Algorithm used for compression
}

export interface CacheStats {
  Hits: number;
  Misses: number;
  totalRequests: number;
  hitRate: number;
  memoryUsage: number;
  entryCount: number;
  invalidations: number;
  compressions: number;
}

// Statistics
export const DEFAULT_CACHE_STATS: CacheStats = {
  Hits: 0,
  Misses: 0,
  totalRequests: 0,
  hitRate: 0,
  memoryUsage: 0,
  entryCount: 0,
  invalidations: 0,
  compressions: 0,
};

export interface CacheHealth {
  status: "healthy" | "degraded" | "critical";
  capacity: "ok" | "full" | "error";
  hitRate: number;
  entryCount: number;
}

export interface ICache {
  isEnabled(): Promise<boolean>;
  get<T>(key: string): Promise<CacheOperationResult<T>>;
  set<T>(key: string, data: T, ttl?: number): Promise<void>;
  invalidate(key: string): Promise<void>;
  invalidatePattern(pattern: string): Promise<number>;
  getStats(): CacheStats;
  healthCheck(): Promise<CacheHealth>;
  dispose?(): Promise<void>; // Optional cleanup method
}
