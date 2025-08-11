import {
  RedisClient,
  ClickHouseClient,
  PostgreSQLClient,
  DatabaseUtils,
  ClickHouseQueryBuilder,
} from "@libs/database";
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
  ttl?: number;
}

export interface FeatureComputationRequest {
  cartId: string;
  features: Record<string, any>;
  version?: string;
  computeRealtime?: boolean;
}

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
  private readonly redis: RedisClient;
  private readonly clickhouse: ClickHouseClient;
  private readonly postgres: PostgreSQLClient;
  private readonly logger: Logger;
  private readonly metrics: MetricsCollector;

  // Cache configuration
  private readonly FEATURE_CACHE_TTL = 3600; // 1 hour in seconds
  private readonly BATCH_SIZE = 1000;
  private readonly VERSION = "1.0.0";

  constructor(
    redis: RedisClient,
    clickhouse: ClickHouseClient,
    postgres: PostgreSQLClient,
    logger: Logger,
    metrics: MetricsCollector
  ) {
    this.redis = redis;
    this.clickhouse = clickhouse;
    this.postgres = postgres;
    this.logger = logger;
    this.metrics = metrics;
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

    try {
      // Use secure DatabaseUtils for feature retrieval
      const features = await DatabaseUtils.getFeatures(cartId, {
        featureNames: query?.featureNames,
        includeExpired: query?.includeExpired,
        fromCache: query?.fromCache,
        cacheKeyPrefix: "features",
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
    request: FeatureComputationRequest
  ): Promise<{ success: boolean; version: string; errors?: string[] }> {
    const startTime = performance.now();
    const {
      cartId,
      features,
      version = this.VERSION,
      computeRealtime = false,
    } = request;
    const errors: string[] = [];

    try {
      this.logger.info("Computing features", {
        cartId,
        featureCount: Object.keys(features).length,
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
        cacheTTL: this.FEATURE_CACHE_TTL,
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
  async batchComputeFeatures(requests: FeatureComputationRequest[]): Promise<{
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
          try {
            await this.computeFeatures(request);
            results.successful++;
          } catch (error) {
            results.failed++;
            results.errors.push({
              cartId: request.cartId,
              error: (error as Error).message,
            });
          }
          results.processed++;
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
    try {
      // Use static call - this is the current design pattern
      const prisma = PostgreSQLClient.getInstance();

      // Use parameterized query for security
      const results = version
        ? await prisma.$queryRaw<
            Array<{
              name: string;
              type: string;
              description?: string;
              version: string;
              computation_logic?: string;
              dependencies?: string;
            }>
          >`
            SELECT DISTINCT name, type, description, version, computation_logic, dependencies 
            FROM feature_definitions 
            WHERE version = ${version}
            ORDER BY name
          `
        : await prisma.$queryRaw<
            Array<{
              name: string;
              type: string;
              description?: string;
              version: string;
              computation_logic?: string;
              dependencies?: string;
            }>
          >`
            SELECT DISTINCT ON (name) name, type, description, version, computation_logic, dependencies 
            FROM feature_definitions 
            ORDER BY name, version DESC
          `;

      return results.map((row: any) => ({
        name: row.name,
        type: row.type,
        description: row.description,
        version: row.version,
        computationLogic: row.computation_logic,
        dependencies: row.dependencies ? JSON.parse(row.dependencies) : [],
      }));
    } catch (error) {
      this.logger.error("Failed to get feature definitions", error as Error, {
        version,
      });
      throw error;
    }
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
    const errors: string[] = [];

    try {
      // Use secure query to get feature definitions
      const prisma = PostgreSQLClient.getInstance();
      const definitions = await prisma.$queryRaw<
        Array<{
          name: string;
          type: string;
          description?: string;
          version: string;
        }>
      >`
        SELECT DISTINCT ON (name) name, type, description, version 
        FROM feature_definitions 
        ORDER BY name, version DESC
      `;

      const definitionMap = new Map(definitions.map((d: any) => [d.name, d]));

      Object.entries(features).forEach(([name, value]) => {
        const definition = definitionMap.get(name);
        if (definition) {
          const expectedType = (definition as any).type;
          const actualType = typeof value;

          if (
            expectedType !== actualType &&
            !(expectedType === "object" && value !== null)
          ) {
            errors.push(
              `Feature ${name}: expected ${expectedType}, got ${actualType}`
            );
          }
        }
      });
    } catch (error) {
      // If validation fails, log but don't block computation
      this.logger.warn("Feature validation failed", {
        error: (error as Error).message,
      });
    }

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
