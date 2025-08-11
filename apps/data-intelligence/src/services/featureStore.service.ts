import {
  RedisClient,
  ClickHouseClient,
  PostgreSQLClient,
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
   */
  async getFeatures(
    cartId: string,
    query?: FeatureQuery
  ): Promise<Record<string, any>> {
    const startTime = performance.now();
    const cacheKey = `features:${cartId}`;

    try {
      // Try Redis cache first unless explicitly disabled
      if (query?.fromCache !== false) {
        const cached = await this.getFromCache(cacheKey);
        if (cached) {
          await this.metrics.recordCounter("feature_cache_hit");
          this.logger.debug("Feature cache hit", { cartId });
          return cached;
        }
      }

      await this.metrics.recordCounter("feature_cache_miss");
      this.logger.debug("Feature cache miss, fetching from database", {
        cartId,
      });

      // Fetch from database with fallback strategy
      const features = await this.fetchFeaturesFromDatabase(cartId, query);

      // Cache the result for future requests
      if (Object.keys(features).length > 0) {
        await this.cacheFeatures(cacheKey, features);
      }

      const duration = performance.now() - startTime;
      await this.metrics.recordTiming("feature_retrieval_duration", duration);

      return features;
    } catch (error) {
      this.logger.error("Failed to get features", error as Error, { cartId });
      await this.metrics.recordCounter("feature_retrieval_error");
      throw error;
    }
  }

  /**
   * Compute and store features with versioning and validation
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

      // Prepare feature objects
      const featureObjects: Feature[] = Object.entries(features).map(
        ([name, value]) => ({
          cartId,
          name,
          value,
          version,
          computedAt: new Date().toISOString(),
          ttl: this.FEATURE_CACHE_TTL,
        })
      );

      // Store in parallel for performance
      const promises = [
        this.storeInCache(cartId, features, version),
        this.storeInClickHouse(featureObjects),
        this.storeInPostgreSQL(featureObjects),
      ];

      await Promise.allSettled(promises);

      const duration = performance.now() - startTime;
      await this.metrics.recordTiming("feature_computation_duration", duration);
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
      await this.metrics.recordTiming(
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
   * Get feature definitions with versioning support
   */
  async getFeatureDefinitions(version?: string): Promise<FeatureDefinition[]> {
    try {
      const prisma = PostgreSQLClient.getInstance();

      // Query for feature definitions, optionally filtered by version
      const query = version
        ? `SELECT DISTINCT name, type, description, version, computation_logic, dependencies 
           FROM feature_definitions WHERE version = $1 ORDER BY name`
        : `SELECT DISTINCT ON (name) name, type, description, version, computation_logic, dependencies 
           FROM feature_definitions ORDER BY name, version DESC`;

      const results = version
        ? await prisma.$queryRawUnsafe(query, version)
        : await prisma.$queryRawUnsafe(query);

      return (results as any[]).map((row) => ({
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
   * Export features with pagination and filtering
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

      // Build dynamic query based on filters
      let whereClause = "1=1";
      const params: any = {};

      if (cartIds && cartIds.length > 0) {
        whereClause += " AND cartId IN {cartIds:Array(String)}";
        params.cartIds = cartIds;
      }

      if (featureNames && featureNames.length > 0) {
        whereClause += " AND name IN {featureNames:Array(String)}";
        params.featureNames = featureNames;
      }

      if (dateFrom) {
        whereClause += " AND computedAt >= {dateFrom:String}";
        params.dateFrom = dateFrom;
      }

      if (dateTo) {
        whereClause += " AND computedAt <= {dateTo:String}";
        params.dateTo = dateTo;
      }

      const query = `
        SELECT cartId, name, value, version, computedAt 
        FROM features 
        WHERE ${whereClause}
        ORDER BY computedAt DESC
        LIMIT ${limit} OFFSET ${offset}
      `;

      const results = await ClickHouseClient.execute(query, params);

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

  private async getFromCache(key: string): Promise<any | null> {
    try {
      const cached = await RedisClient.getInstance().get(key);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      this.logger.warn("Cache retrieval failed", {
        key,
        error: (error as Error).message,
      });
      return null;
    }
  }

  private async cacheFeatures(key: string, features: any): Promise<void> {
    try {
      await RedisClient.getInstance().setex(
        key,
        this.FEATURE_CACHE_TTL,
        JSON.stringify(features)
      );
    } catch (error) {
      this.logger.warn("Cache storage failed", {
        key,
        error: (error as Error).message,
      });
    }
  }

  private async fetchFeaturesFromDatabase(
    cartId: string,
    query?: FeatureQuery
  ): Promise<Record<string, any>> {
    // Try ClickHouse first for analytical data
    try {
      let whereClause = `cartId = '${cartId}'`;

      if (query?.featureNames?.length) {
        whereClause += ` AND name IN (${query.featureNames
          .map((n) => `'${n}'`)
          .join(",")})`;
      }

      if (!query?.includeExpired) {
        whereClause += ` AND computedAt > subtractHours(now(), 24)`;
      }

      const chQuery = `SELECT name, value FROM features WHERE ${whereClause} ORDER BY computedAt DESC`;
      const results = await ClickHouseClient.execute(chQuery);

      if (results.length > 0) {
        const features: Record<string, any> = {};
        results.forEach((row: any) => {
          features[row.name] = row.value;
        });
        return features;
      }
    } catch (error) {
      this.logger.warn("ClickHouse feature fetch failed", {
        cartId,
        error: (error as Error).message,
      });
    }

    // Fallback to PostgreSQL
    try {
      const prisma = PostgreSQLClient.getInstance();
      const features = await prisma.feature.findMany({
        where: { cartId },
        select: { name: true, value: true },
        orderBy: { updatedAt: "desc" },
      });

      const result: Record<string, any> = {};
      features.forEach((feature) => {
        result[feature.name] = feature.value;
      });
      return result;
    } catch (error) {
      this.logger.warn("PostgreSQL feature fetch failed", {
        cartId,
        error: (error as Error).message,
      });
      return {};
    }
  }

  private async validateFeatures(
    features: Record<string, any>
  ): Promise<string[]> {
    const errors: string[] = [];

    try {
      const definitions = await this.getFeatureDefinitions();
      const definitionMap = new Map(definitions.map((d) => [d.name, d]));

      Object.entries(features).forEach(([name, value]) => {
        const definition = definitionMap.get(name);
        if (definition) {
          const expectedType = definition.type;
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

  private async storeInCache(
    cartId: string,
    features: any,
    version: string
  ): Promise<void> {
    const cacheKey = `features:${cartId}`;
    const cacheData = {
      ...features,
      _version: version,
      _cached_at: new Date().toISOString(),
    };
    await this.cacheFeatures(cacheKey, cacheData);
  }

  private async storeInClickHouse(features: Feature[]): Promise<void> {
    try {
      await ClickHouseClient.insert("features", features);
    } catch (error) {
      this.logger.error("ClickHouse storage failed", error as Error);
      throw error;
    }
  }

  private async storeInPostgreSQL(features: Feature[]): Promise<void> {
    try {
      const prisma = PostgreSQLClient.getInstance();

      // Use upsert to handle duplicates
      const upsertPromises = features.map((feature) =>
        prisma.feature.upsert({
          where: {
            cartId_name: {
              cartId: feature.cartId,
              name: feature.name,
            },
          },
          update: {
            value: feature.value,
            version: feature.version,
            updatedAt: new Date(feature.computedAt),
          },
          create: {
            cartId: feature.cartId,
            name: feature.name,
            value: feature.value,
            version: feature.version,
            createdAt: new Date(feature.computedAt),
            updatedAt: new Date(feature.computedAt),
          },
        })
      );

      await Promise.all(upsertPromises);
    } catch (error) {
      this.logger.error("PostgreSQL storage failed", error as Error);
      throw error;
    }
  }
}
