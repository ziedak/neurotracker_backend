import {
  RedisClient,
  ClickHouseClient,
  PostgreSQLClient,
  DatabaseUtils,
  ClickHouseQueryBuilder,
} from "@libs/database";
import {
  FeatureStoreComputeBody,
  FeatureStoreBatchComputeBody,
} from "../types";
import { Logger, MetricsCollector } from "@libs/monitoring";
import { performance } from "perf_hooks";

export interface FeatureDefinition {
  name: string;
  type: "number" | "string" | "boolean" | "object";
  description?: string;
  version: string;
  computationLogic?: string;
  dependencies?: string[];
}

export interface Feature {
  cartId: string;
  name: string;
  value: any;
  version: string;
  computedAt: string;
  description?: string;
  ttl?: number;
}

// Deprecated: use FeatureStoreComputeBody from types
export type FeatureComputationRequest = FeatureStoreComputeBody;

export interface FeatureQuery {
  cartId?: string;
  featureNames?: string[];
  fromCache?: boolean;
  includeExpired?: boolean;
}

/**
 * Enhanced Feature Store Service with enterprise-grade capabilities
 * Implements caching, versioning, monitoring, and performance optimization
 * Uses secure database utilities to prevent SQL injection
 */
export class FeatureStoreService {
  /**
   * Update features for a cart
   */
  async updateFeatures(
    cartId: string,
    features: any[]
  ): Promise<{ success: boolean; updated: number }> {
    const prisma = PostgreSQLClient.getInstance();
    let updated = 0;
    for (const feature of features) {
      if (!feature.name || typeof feature.value === "undefined") continue;
      await prisma.feature.updateMany({
        where: { cartId, name: feature.name },
        data: {
          value: feature.value,
          version: feature.version ?? "1.0.0",
          updatedAt: new Date(),
          description: feature.description,
          metadata: feature.metadata ? feature.metadata : undefined,
        },
      });
      updated++;
    }
    this.logger.info("Features updated", { cartId, updated });
    return { success: true, updated };
  }

  /**
   * Delete features for a cart
   */
  async deleteFeatures(
    cartId: string
  ): Promise<{ success: boolean; deleted: number }> {
    const prisma = PostgreSQLClient.getInstance();
    const result = await prisma.feature.deleteMany({ where: { cartId } });
    this.logger.info("Features deleted", { cartId, deleted: result.count });
    return { success: true, deleted: result.count };
  }

  /**
   * Create a new feature version
   */
  async createFeatureVersion(
    version: string,
    features: any[]
  ): Promise<{ success: boolean; version: string }> {
    const prisma = PostgreSQLClient.getInstance();
    let created = 0;
    for (const feature of features) {
      if (!feature.name || typeof feature.value === "undefined") continue;
      await prisma.feature.create({
        data: {
          cartId: feature.cartId ?? "unknown",
          name: feature.name,
          value: feature.value,
          version,
          ttl: feature.ttl,
          description: feature.description,
          metadata: feature.metadata ? feature.metadata : undefined,
        },
      });
      created++;
    }
    this.logger.info("Feature version created", { version, count: created });
    return { success: true, version };
  }

  /**
   * Get all feature versions
   */
  async getFeatureVersions(): Promise<string[]> {
    const prisma = PostgreSQLClient.getInstance();
    const versions = await prisma.feature.findMany({
      select: { version: true },
      orderBy: { version: "desc" },
    });
    const uniqueVersions = Array.from(
      new Set(versions.map((v: any) => v.version))
    );
    return uniqueVersions;
  }
  private readonly redis: RedisClient;
  private readonly clickhouse: ClickHouseClient;
  private readonly postgres: PostgreSQLClient;
  private readonly logger: Logger;
  private readonly metrics: MetricsCollector;
  private readonly circuitBreaker: import("@libs/utils").CircuitBreaker;
  private readonly lruCache: import("@libs/utils").LRUCache<
    string,
    Record<string, any>
  >;

  // Cache configuration
  private readonly FEATURE_CACHE_TTL = 3600; // 1 hour in seconds
  private readonly BATCH_SIZE = 1000;
  private readonly VERSION = "1.0.0";

  constructor(
    redis: RedisClient,
    clickhouse: ClickHouseClient,
    postgres: PostgreSQLClient,
    logger: Logger,
    metrics: MetricsCollector,
    circuitBreaker: import("@libs/utils").CircuitBreaker,
    lruCache: import("@libs/utils").LRUCache<string, Record<string, any>>
  ) {
    this.redis = redis;
    this.clickhouse = clickhouse;
    this.postgres = postgres;
    this.logger = logger;
    this.metrics = metrics;
    this.circuitBreaker = circuitBreaker;
    this.lruCache = lruCache;
  }

  /**
   * Get features for a cart with intelligent caching strategy
   * Uses secure DatabaseUtils to prevent SQL injection
   */
  async getFeatures(
    cartId: string,
    query?: FeatureQuery
  ): Promise<Record<string, any>> {
    const startTime = performance.now();

    // Try LRU cache first
    const lruKey = `${cartId}:${JSON.stringify(query?.featureNames || [])}`;
    const cached = this.lruCache.peek(lruKey);
    if (cached) {
      await this.metrics.recordCounter("feature_lru_cache_hit");
      return cached;
    }

    try {
      // Use circuit breaker for feature retrieval
      const features = await this.circuitBreaker.execute(() =>
        DatabaseUtils.getFeatures(cartId, {
          featureNames: query?.featureNames,
          includeExpired: query?.includeExpired,
          fromCache: query?.fromCache,
          cacheKeyPrefix: "features",
        })
      );

      // Store in LRU cache
      this.lruCache.set(lruKey, features, {
        ttl: this.FEATURE_CACHE_TTL * 1000,
      });

      await this.metrics.recordCounter(
        features ? "feature_cache_hit" : "feature_cache_miss"
      );

      const duration = performance.now() - startTime;
      await this.metrics.recordTimer("feature_retrieval_duration", duration);

      this.logger.debug("Features retrieved successfully", {
        cartId,
        featureCount: Object.keys(features).length,
        duration: Math.round(duration),
      });

      return features;
    } catch (error) {
      this.logger.error("Failed to get features", error as Error, { cartId });
      await this.metrics.recordCounter("feature_retrieval_error");
      throw error;
    }
  }

  /**
   * Compute and store features with versioning and validation
   * Uses secure DatabaseUtils for storage operations
   */
  async computeFeatures(
    request: FeatureStoreComputeBody
  ): Promise<{ success: boolean; version: string; errors?: string[] }> {
    const startTime = performance.now();
    const {
      cartId,
      features,
      version = this.VERSION,
      ttl,
      computeRealtime = false,
    } = request;
    const errors: string[] = [];

    try {
      this.logger.info("Computing features", {
        cartId,
        featureCount: Object.keys(features).length,
        version,
        ttl,
      });

      // Validate features against schema
      const validationErrors = await this.validateFeatures(features);
      if (validationErrors.length > 0) {
        errors.push(...validationErrors);
        if (!computeRealtime) {
          return { success: false, version, errors };
        }
      }

      // Use secure DatabaseUtils for storage
      await DatabaseUtils.storeFeatures(cartId, features, {
        version,
        cacheKeyPrefix: "features",
        cacheTTL: ttl ?? this.FEATURE_CACHE_TTL,
      });

      // Also store in ClickHouse for analytics (using secure query builder)
      await this.storeInClickHouse(cartId, features, version);

      const duration = performance.now() - startTime;
      await this.metrics.recordTimer("feature_computation_duration", duration);
      await this.metrics.recordCounter(
        "features_computed",
        Object.keys(features).length
      );

      this.logger.info("Features computed successfully", {
        cartId,
        version,
        ttl,
        duration: Math.round(duration),
        errors: errors.length,
      });

      return {
        success: true,
        version,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error) {
      this.logger.error("Feature computation failed", error as Error, {
        cartId,
      });
      await this.metrics.recordCounter("feature_computation_error");
      throw error;
    }
  }

  /**
   * Batch compute features for multiple carts with optimized processing
   */
  async batchComputeFeatures(
    requests: FeatureStoreBatchComputeBody[]
  ): Promise<{
    processed: number;
    successful: number;
    failed: number;
    errors: Array<{ cartId: string; error: string }>;
  }> {
    const startTime = performance.now();
    const results = {
      processed: 0,
      successful: 0,
      failed: 0,
      errors: [] as Array<{ cartId: string; error: string }>,
    };

    try {
      this.logger.info("Starting batch feature computation", {
        batchSize: requests.length,
      });

      // Process in batches to avoid overwhelming the system
      for (let i = 0; i < requests.length; i += this.BATCH_SIZE) {
        const batch = requests.slice(i, i + this.BATCH_SIZE);

        const batchPromises = batch.map(async (request) => {
          // request: FeatureStoreBatchComputeBody
          if (!request.cartIds || !request.features) return;
          for (let idx = 0; idx < request.cartIds.length; idx++) {
            const cartId = request.cartIds[idx];
            const featureObj = request.features[idx] || {};
            try {
              await this.computeFeatures({
                cartId,
                features: featureObj,
                version: featureObj.version,
                ttl: featureObj.ttl,
              });
              results.successful++;
            } catch (error) {
              results.failed++;
              results.errors.push({
                cartId,
                error: (error as Error).message,
              });
            }
            results.processed++;
          }
        });

        await Promise.allSettled(batchPromises);

        // Brief pause between batches to prevent resource exhaustion
        if (i + this.BATCH_SIZE < requests.length) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      const duration = performance.now() - startTime;
      await this.metrics.recordTimer(
        "batch_feature_computation_duration",
        duration
      );

      this.logger.info("Batch feature computation completed", {
        ...results,
        duration: Math.round(duration),
      });

      return results;
    } catch (error) {
      this.logger.error("Batch feature computation failed", error as Error);
      throw error;
    }
  }

  /**
   * Get feature definitions with versioning support using secure queries
   */
  async getFeatureDefinitions(version?: string): Promise<FeatureDefinition[]> {
    const prisma = PostgreSQLClient.getInstance();
    const whereClause = version ? { version } : {};
    const features = await prisma.feature.findMany({
      where: whereClause,
      select: {
        name: true,
        version: true,
        metadata: true,
        description: true,
      },
      orderBy: { name: "asc" },
    });

    // Map to FeatureDefinition type
    return features.map((f: any) => ({
      name: f.name,
      type: f.metadata?.type ?? "unknown",
      description: f.metadata?.description ?? "",
      version: f.version,
      computationLogic: f.metadata?.computationLogic,
      dependencies: f.metadata?.dependencies ?? [],
    }));
  }
  /**
   * Export features with pagination and filtering using secure query builder
   */
  async exportFeatures(
    options: {
      format?: "json" | "csv" | "parquet";
      limit?: number;
      offset?: number;
      cartIds?: string[];
      featureNames?: string[];
      dateFrom?: string;
      dateTo?: string;
    } = {}
  ): Promise<any> {
    const {
      format = "json",
      limit = 10000,
      offset = 0,
      cartIds,
      featureNames,
      dateFrom,
      dateTo,
    } = options;

    try {
      this.logger.info("Starting feature export", { format, limit, offset });

      // Build secure filters
      const filters: Record<string, any> = {};

      if (cartIds && cartIds.length > 0) {
        filters.cartId = cartIds;
      }

      if (featureNames && featureNames.length > 0) {
        filters.name = featureNames;
      }

      // Use secure DatabaseUtils for export
      const results = await DatabaseUtils.exportData("features", filters, {
        select: ["cartId", "name", "value", "createdAt", "updatedAt"],
        limit: Math.min(limit, 100000), // Max 100k records
        offset,
        orderBy: [{ field: "updatedAt", direction: "DESC" }],
        format: "json",
      });

      // Additional date filtering for ClickHouse if needed
      if (dateFrom || dateTo) {
        // Use ClickHouse time series query for date-based filtering
        const { query, params } = ClickHouseQueryBuilder.buildTimeSeriesQuery(
          "features",
          "createdAt",
          "day",
          {
            select: ["cartId", "name", "value"],
            where: filters,
            dateFrom,
            dateTo,
            allowedTables: ["features"],
            allowedFields: [
              "cartId",
              "name",
              "value",
              "createdAt",
              "updatedAt",
            ],
          }
        );

        const timeSeriesData = await ClickHouseClient.execute(query, params);
        await this.metrics.recordCounter("feature_export_timeseries");
        return timeSeriesData;
      }

      await this.metrics.recordCounter("feature_export_requests");
      this.logger.info("Feature export completed", {
        recordCount: results.length,
        format,
      });

      return results;
    } catch (error) {
      this.logger.error("Feature export failed", error as Error, { format });
      throw error;
    }
  }

  // === Private Helper Methods ===

  private async validateFeatures(
    features: Record<string, any>
  ): Promise<string[]> {
    const prisma = PostgreSQLClient.getInstance();
    const featureNames = Object.keys(features);
    const definitions = await prisma.feature.findMany({
      where: { name: { in: featureNames } },
      select: { name: true, metadata: true },
    });

    const definitionMap = new Map(
      definitions.map((d: any) => [d.name, d.metadata?.type])
    );

    const errors: string[] = [];
    Object.entries(features).forEach(([name, value]) => {
      const expectedType = definitionMap.get(name);
      const actualType = typeof value;
      if (
        expectedType &&
        expectedType !== actualType &&
        !(expectedType === "object" && value !== null)
      ) {
        errors.push(
          `Feature ${name}: expected ${expectedType}, got ${actualType}`
        );
      }
    });

    return errors;
  }
  private async storeInClickHouse(
    cartId: string,
    features: Record<string, any>,
    version: string
  ): Promise<void> {
    try {
      // Convert features to ClickHouse format
      const featureData = Object.entries(features).map(([name, value]) => ({
        cartId,
        name,
        value: JSON.stringify(value),
        version,
        computedAt: new Date().toISOString(),
      }));

      // Use secure insert method
      const { table, data } = ClickHouseQueryBuilder.buildInsertQuery(
        "features",
        featureData,
        {
          allowedTables: ["features"],
          allowedFields: ["cartId", "name", "value", "version", "computedAt"],
        }
      );

      await ClickHouseClient.insert(table, data);
    } catch (error) {
      this.logger.error("ClickHouse storage failed", error as Error);
      throw error;
    }
  }
}
