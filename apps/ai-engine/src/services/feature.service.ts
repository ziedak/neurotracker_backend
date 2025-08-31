import { Logger, MetricsCollector } from "@libs/monitoring";
import { DataIntelligenceClient } from "./dataIntelligence.client";
import { CacheService } from "./cache.service";
import {
  FeatureSet,
  FeatureComputationRequest,
  FeatureDefinition,
  FeatureEvent,
} from "../types";
import { performance } from "perf_hooks";

/**
 * Feature Service for AI Engine
 * Manages feature computation, caching, and integration with data-intelligence service
 */
export class FeatureService {
  private readonly dataIntelligenceClient: DataIntelligenceClient;
  private readonly cacheService: CacheService;
  private readonly logger: ILogger;
  private readonly metrics: MetricsCollector;

  // Feature configuration
  private readonly FEATURE_CONFIG = {
    DEFAULT_TTL: 1800, // 30 minutes
    BATCH_SIZE: 100,
    MAX_RETRIES: 3,
    TIMEOUT_MS: 10000,
  };

  // Feature definitions cache
  private featureDefinitions: FeatureDefinition[] = [];
  private lastDefinitionUpdate: number = 0;
  private readonly DEFINITION_CACHE_TTL = 3600000; // 1 hour

  constructor(
    dataIntelligenceClient: DataIntelligenceClient,
    cacheService: CacheService,
    logger: ILogger,
    metrics: MetricsCollector
  ) {
    this.dataIntelligenceClient = dataIntelligenceClient;
    this.cacheService = cacheService;
    this.logger = logger;
    this.metrics = metrics;

    this.logger.info("Feature Service initialized");
  }

  /**
   * Get features for a cart with intelligent caching
   */
  async getFeatures(request: FeatureComputationRequest): Promise<FeatureSet> {
    const startTime = performance.now();
    const { cartId, forceRecompute = false } = request;

    try {
      // Check cache first unless force recompute is requested
      if (!forceRecompute) {
        const cached = await this.cacheService.getFeatures(cartId);
        if (cached) {
          const duration = performance.now() - startTime;
          await this.metrics.recordTimer(
            "feature_retrieval_cache_hit_duration",
            duration
          );
          await this.metrics.recordCounter("feature_cache_hit");

          this.logger.debug("Features retrieved from cache", {
            cartId,
            duration: Math.round(duration),
            source: "cache",
          });

          await this.recordFeatureEvent({
            type: "features_cached",
            cartId,
            timestamp: new Date().toISOString(),
            duration,
            featureCount: Object.keys(cached.data.features || {}).length,
          });

          return cached.data;
        }
      }

      // Compute features from data-intelligence service
      const featureSet = await this.computeFeatures(request);

      // Cache the computed features
      await this.cacheService.setFeatures(
        cartId,
        featureSet,
        this.FEATURE_CONFIG.DEFAULT_TTL
      );

      const duration = performance.now() - startTime;
      await this.metrics.recordTimer(
        "feature_retrieval_total_duration",
        duration
      );
      await this.metrics.recordCounter("feature_computation_success");

      this.logger.info("Features computed and cached", {
        cartId,
        duration: Math.round(duration),
        featureCount: Object.keys(featureSet.features).length,
        source: "data-intelligence",
      });

      await this.recordFeatureEvent({
        type: "features_computed",
        cartId,
        timestamp: new Date().toISOString(),
        duration,
        featureCount: Object.keys(featureSet.features).length,
      });

      return featureSet;
    } catch (error) {
      const duration = performance.now() - startTime;
      await this.metrics.recordTimer(
        "feature_retrieval_error_duration",
        duration
      );
      await this.metrics.recordCounter("feature_computation_error");

      this.logger.error("Feature computation failed", error as Error, {
        cartId,
        duration: Math.round(duration),
      });

      await this.recordFeatureEvent({
        type: "features_failed",
        cartId,
        timestamp: new Date().toISOString(),
        duration,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      throw new Error(
        `Feature computation failed for cart ${cartId}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Compute features from data-intelligence service
   */
  private async computeFeatures(
    request: FeatureComputationRequest
  ): Promise<FeatureSet> {
    const startTime = performance.now();

    try {
      const featureSet = await this.dataIntelligenceClient.getFeatures(request);

      // Validate features
      await this.validateFeatures(featureSet);

      const duration = performance.now() - startTime;
      await this.metrics.recordTimer("feature_computation_duration", duration);

      this.logger.debug("Features computed successfully", {
        cartId: request.cartId,
        duration: Math.round(duration),
        featureCount: Object.keys(featureSet.features).length,
      });

      return featureSet;
    } catch (error) {
      const duration = performance.now() - startTime;
      await this.metrics.recordTimer(
        "feature_computation_error_duration",
        duration
      );

      this.logger.error(
        "Data intelligence feature computation failed",
        error as Error,
        {
          cartId: request.cartId,
          duration: Math.round(duration),
        }
      );

      throw error;
    }
  }

  /**
   * Get features for multiple carts (batch processing)
   */
  async getBatchFeatures(
    requests: FeatureComputationRequest[]
  ): Promise<FeatureSet[]> {
    const startTime = performance.now();

    try {
      // Check cache for all requests
      const cachedResults: FeatureSet[] = [];
      const uncachedRequests: FeatureComputationRequest[] = [];

      for (const request of requests) {
        if (!request.forceRecompute) {
          const cached = await this.cacheService.getFeatures(request.cartId);
          if (cached) {
            cachedResults.push(cached.data);
            continue;
          }
        }
        uncachedRequests.push(request);
      }

      // Compute uncached features
      let computedResults: FeatureSet[] = [];
      if (uncachedRequests.length > 0) {
        computedResults = await this.dataIntelligenceClient.getBatchFeatures(
          uncachedRequests
        );

        // Cache computed results
        await Promise.all(
          computedResults.map((result) =>
            this.cacheService.setFeatures(
              result.cartId,
              result,
              this.FEATURE_CONFIG.DEFAULT_TTL
            )
          )
        );
      }

      // Combine results
      const allResults = [...cachedResults, ...computedResults];

      const duration = performance.now() - startTime;
      await this.metrics.recordTimer(
        "batch_feature_computation_duration",
        duration
      );
      await this.metrics.recordCounter("batch_feature_computation_success");

      this.logger.info("Batch features computed", {
        totalRequests: requests.length,
        cachedResults: cachedResults.length,
        computedResults: computedResults.length,
        duration: Math.round(duration),
      });

      return allResults;
    } catch (error) {
      const duration = performance.now() - startTime;
      await this.metrics.recordTimer(
        "batch_feature_computation_error_duration",
        duration
      );
      await this.metrics.recordCounter("batch_feature_computation_error");

      this.logger.error("Batch feature computation failed", error as Error, {
        requestCount: requests.length,
        duration: Math.round(duration),
      });

      throw new Error(
        `Batch feature computation failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Validate features against known definitions
   */
  private async validateFeatures(featureSet: FeatureSet): Promise<void> {
    try {
      // Ensure we have current feature definitions
      await this.ensureFeatureDefinitions();

      const { features } = featureSet;
      const issues: string[] = [];

      // Validate against known feature definitions
      for (const [featureName, value] of Object.entries(features)) {
        const definition = this.featureDefinitions.find(
          (def) => def.name === featureName
        );

        if (!definition) {
          // Log unknown features but don't fail
          this.logger.warn("Unknown feature detected", {
            featureName,
            cartId: featureSet.cartId,
          });
          continue;
        }

        // Type validation
        const expectedType = definition.type;
        const actualType = typeof value;

        if (expectedType === "number" && actualType !== "number") {
          issues.push(
            `Feature ${featureName}: expected number, got ${actualType}`
          );
        } else if (expectedType === "string" && actualType !== "string") {
          issues.push(
            `Feature ${featureName}: expected string, got ${actualType}`
          );
        } else if (expectedType === "boolean" && actualType !== "boolean") {
          issues.push(
            `Feature ${featureName}: expected boolean, got ${actualType}`
          );
        }

        // Range validation for numbers
        if (expectedType === "number" && actualType === "number") {
          if (isNaN(value as number) || !isFinite(value as number)) {
            issues.push(`Feature ${featureName}: invalid number value`);
          }
        }
      }

      if (issues.length > 0) {
        this.logger.warn("Feature validation issues detected", {
          cartId: featureSet.cartId,
          issues,
        });

        await this.metrics.recordCounter("feature_validation_warning");
      }

      // Optional: Call data-intelligence service for additional validation
      const isValid = await this.dataIntelligenceClient.validateDataQuality(
        featureSet.cartId,
        features
      );

      if (!isValid) {
        this.logger.warn("Data quality validation failed", {
          cartId: featureSet.cartId,
        });
        await this.metrics.recordCounter("data_quality_validation_failed");
      }
    } catch (error) {
      this.logger.error("Feature validation error", error as Error, {
        cartId: featureSet.cartId,
      });
      // Don't throw - validation failures shouldn't break feature computation
    }
  }

  /**
   * Ensure we have current feature definitions
   */
  private async ensureFeatureDefinitions(): Promise<void> {
    const now = Date.now();

    if (
      this.featureDefinitions.length === 0 ||
      now - this.lastDefinitionUpdate > this.DEFINITION_CACHE_TTL
    ) {
      try {
        this.featureDefinitions =
          await this.dataIntelligenceClient.getFeatureDefinitions();
        this.lastDefinitionUpdate = now;

        this.logger.info("Feature definitions updated", {
          count: this.featureDefinitions.length,
        });
      } catch (error) {
        this.logger.error(
          "Failed to update feature definitions",
          error as Error
        );
        // Continue with cached definitions if available
      }
    }
  }

  /**
   * Invalidate feature cache for a cart
   */
  async invalidateFeatures(cartId: string): Promise<void> {
    try {
      await this.cacheService.setFeatures(cartId, null as any, 0); // Expire immediately

      this.logger.info("Features invalidated", { cartId });
      await this.metrics.recordCounter("feature_cache_invalidation");
    } catch (error) {
      this.logger.error("Failed to invalidate features", error as Error, {
        cartId,
      });
    }
  }

  /**
   * Get feature definitions
   */
  async getFeatureDefinitions(): Promise<FeatureDefinition[]> {
    await this.ensureFeatureDefinitions();
    return [...this.featureDefinitions];
  }

  /**
   * Warm feature cache with batch computation
   */
  async warmFeatureCache(cartIds: string[]): Promise<void> {
    const startTime = performance.now();

    try {
      const requests = cartIds.map((cartId) => ({ cartId }));
      await this.getBatchFeatures(requests);

      const duration = performance.now() - startTime;
      this.logger.info("Feature cache warmed", {
        cartCount: cartIds.length,
        duration: Math.round(duration),
      });

      await this.metrics.recordCounter("feature_cache_warm_completed");
    } catch (error) {
      this.logger.error("Feature cache warming failed", error as Error, {
        cartCount: cartIds.length,
      });
    }
  }

  /**
   * Get feature service health status
   */
  async getHealthStatus(): Promise<any> {
    try {
      // Check data-intelligence connectivity
      const dataIntelligenceHealthy =
        await this.dataIntelligenceClient.healthCheck();

      return {
        status: dataIntelligenceHealthy ? "healthy" : "degraded",
        dataIntelligenceConnection: dataIntelligenceHealthy,
        featureDefinitionsLoaded: this.featureDefinitions.length > 0,
        lastDefinitionUpdate: new Date(this.lastDefinitionUpdate).toISOString(),
      };
    } catch (error) {
      return {
        status: "unhealthy",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Record feature event for monitoring
   */
  private async recordFeatureEvent(event: FeatureEvent): Promise<void> {
    try {
      // Record event in metrics
      await this.metrics.recordCounter(`feature_event_${event.type}`);

      // Could also send to event pipeline or audit log
      this.logger.debug("Feature event recorded", event);
    } catch (error) {
      this.logger.error("Failed to record feature event", error as Error, {
        event,
      });
    }
  }
}
