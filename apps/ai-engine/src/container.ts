import { ServiceRegistry, IServiceRegistry } from "@libs/utils";
import {
  RedisClient,
  ClickHouseClient,
  PostgreSQLClient,
} from "@libs/database";
import { Logger, MetricsCollector, HealthChecker } from "@libs/monitoring";
import { ModelService } from "./services/model.service";
import { FeatureService } from "./services/feature.service";
import { PredictionService } from "./services/prediction.service";
import { CacheService } from "./services/cache.service";
import { DataIntelligenceClient } from "./services/dataIntelligence.client";
import { AuthMiddleware } from "./middleware/auth.middleware";
import { ValidationMiddleware } from "./middleware/validation.middleware";
import { RateLimitMiddleware } from "./middleware/rateLimit.middleware";
import { AuditMiddleware } from "./middleware/audit.middleware";

/**
 * AI Engine Container
 * Manages all services and dependencies for the AI Engine service
 * Follows the established pattern from data-intelligence service
 */
export class AIEngineContainer {
  private readonly _registry: IServiceRegistry;
  private _initialized: boolean = false;

  constructor() {
    this._registry = ServiceRegistry; // Use the singleton instance
  }

  /**
   * Initialize all services in dependency order
   */
  public async initialize(): Promise<void> {
    if (this._initialized) {
      return;
    }

    try {
      // Register infrastructure services
      this.registerInfrastructure();

      // Register database clients
      this.registerDatabaseClients();

      // Register external clients
      this.registerExternalClients();

      // Register business services
      this.registerBusinessServices();

      // Register middleware components
      this.registerMiddleware();

      // Initialize core services in order
      this._registry.initializeCore([
        "logger",
        "metricsCollector",
        "healthChecker",
      ]);

      this._initialized = true;

      const logger = this._registry.resolve<Logger>("logger");
      logger.info("AI Engine Container initialized successfully");
    } catch (error) {
      const logger = this._registry.resolve<Logger>("logger");
      logger.error("Failed to initialize AI Engine Container", error as Error);
      throw error;
    }
  }

  /**
   * Register infrastructure services (logging, monitoring, health checks)
   */
  private registerInfrastructure(): void {
    // Logger - singleton
    this._registry.registerSingleton("logger", () =>
      Logger.getInstance("ai-engine")
    );

    // Metrics collector - singleton (using getInstance pattern)
    this._registry.registerSingleton("metricsCollector", () =>
      MetricsCollector.getInstance()
    );

    // Health checker - singleton
    this._registry.registerSingleton("healthChecker", () => {
      return new HealthChecker();
    });
  }

  /**
   * Register database clients with proper dependency injection
   */
  private registerDatabaseClients(): void {
    // Redis client - using static getInstance (legacy pattern)
    this._registry.registerSingleton("redisClient", () =>
      RedisClient.getInstance()
    );

    // ClickHouse client - using static getInstance (legacy pattern for analytics and logging)
    this._registry.registerSingleton("clickhouseClient", () =>
      ClickHouseClient.getInstance()
    );

    // PostgreSQL client - using proper TSyringe DI (for model metadata)
    this._registry.registerSingleton("postgresClient", () => {
      const logger = this._registry.resolve<Logger>("logger");
      const metrics =
        this._registry.resolve<MetricsCollector>("metricsCollector");
      const cacheService = this._registry.resolve<CacheService>("cacheService");

      return new PostgreSQLClient(logger, metrics, cacheService);
    });
  }

  /**
   * Register external service clients
   */
  private registerExternalClients(): void {
    // Data Intelligence Service Client
    this._registry.registerSingleton("dataIntelligenceClient", () => {
      const logger = this._registry.resolve<Logger>("logger");
      const metrics =
        this._registry.resolve<MetricsCollector>("metricsCollector");

      return new DataIntelligenceClient(logger, metrics);
    });
  }

  /**
   * Register business services with proper dependency injection
   */
  private registerBusinessServices(): void {
    // Cache Service - singleton (provides caching layer for all services)
    this._registry.registerSingleton("cacheService", () => {
      const redisInstance = RedisClient.getInstance();
      const logger = this._registry.resolve<Logger>("logger");
      const metrics =
        this._registry.resolve<MetricsCollector>("metricsCollector");

      return new CacheService(redisInstance, logger, metrics);
    });

    // Feature Service - singleton (integrates with data-intelligence)
    this._registry.registerSingleton("featureService", () => {
      const dataIntelligenceClient =
        this._registry.resolve<DataIntelligenceClient>(
          "dataIntelligenceClient"
        );
      const cacheService = this._registry.resolve<CacheService>("cacheService");
      const logger = this._registry.resolve<Logger>("logger");
      const metrics =
        this._registry.resolve<MetricsCollector>("metricsCollector");

      return new FeatureService(
        dataIntelligenceClient,
        cacheService,
        logger,
        metrics
      );
    });

    // Model Service - singleton (manages ML models and versioning)
    this._registry.registerSingleton("modelService", () => {
      const cacheService = this._registry.resolve<CacheService>("cacheService");
      const logger = this._registry.resolve<Logger>("logger");
      const metrics =
        this._registry.resolve<MetricsCollector>("metricsCollector");

      return new ModelService(cacheService, logger, metrics);
    });

    // Prediction Service - singleton (core prediction orchestration)
    this._registry.registerSingleton("predictionService", () => {
      const modelService = this._registry.resolve<ModelService>("modelService");
      const featureService =
        this._registry.resolve<FeatureService>("featureService");
      const cacheService = this._registry.resolve<CacheService>("cacheService");
      const logger = this._registry.resolve<Logger>("logger");
      const metrics =
        this._registry.resolve<MetricsCollector>("metricsCollector");

      return new PredictionService(
        modelService,
        featureService,
        cacheService,
        logger,
        metrics
      );
    });
  }

  /**
   * Register middleware components with proper dependency injection
   */
  private registerMiddleware(): void {
    // Authentication Middleware - singleton
    this._registry.registerSingleton("authMiddleware", () => {
      const logger = this._registry.resolve<Logger>("logger");
      const metrics =
        this._registry.resolve<MetricsCollector>("metricsCollector");

      return new AuthMiddleware(logger, metrics);
    });

    // Validation Middleware - singleton
    this._registry.registerSingleton("validationMiddleware", () => {
      const logger = this._registry.resolve<Logger>("logger");
      const metrics =
        this._registry.resolve<MetricsCollector>("metricsCollector");

      return new ValidationMiddleware(logger, metrics);
    });

    // Rate Limit Middleware - singleton
    this._registry.registerSingleton("rateLimitMiddleware", () => {
      const redis = RedisClient.getInstance(); // Get the Redis instance directly
      const logger = this._registry.resolve<Logger>("logger");
      const metrics =
        this._registry.resolve<MetricsCollector>("metricsCollector");

      return new RateLimitMiddleware(redis, logger, metrics);
    });

    // Audit Middleware - singleton
    this._registry.registerSingleton("auditMiddleware", () => {
      const logger = this._registry.resolve<Logger>("logger");
      const metrics =
        this._registry.resolve<MetricsCollector>("metricsCollector");

      return new AuditMiddleware(logger, metrics);
    });
  }

  /**
   * Get service instance with type safety
   */
  public getService<T>(key: string): T {
    return this._registry.safeResolve<T>(key);
  }

  /**
   * Get async service instance with type safety
   */
  public async getAsyncService<T>(key: string): Promise<T> {
    return this._registry.resolveAsync<T>(key);
  }

  /**
   * Connect all database services
   */
  public async connectDatabases(): Promise<void> {
    try {
      // Only connect Redis if not already connected
      if (!RedisClient.isHealthy()) {
        await RedisClient.connect();
      }

      // ClickHouse connects automatically on first query
      await PostgreSQLClient.connect();

      const logger = this._registry.resolve<Logger>("logger");
      logger.info("Database connections established");
    } catch (error) {
      const logger = this._registry.resolve<Logger>("logger");
      logger.error("Failed to connect databases", error as Error);
      throw error;
    }
  }

  /**
   * Initialize models (load default models and validate)
   */
  public async initializeModels(): Promise<void> {
    try {
      const modelService = this.getService<ModelService>("modelService");
      await modelService.initializeDefaultModels();

      const logger = this._registry.resolve<Logger>("logger");
      logger.info("Models initialized successfully");
    } catch (error) {
      const logger = this._registry.resolve<Logger>("logger");
      logger.error("Failed to initialize models", error as Error);
      throw error;
    }
  }

  /**
   * Validate all service dependencies
   */
  public async validateServices(): Promise<void> {
    try {
      const healthChecker = this.getService<HealthChecker>("healthChecker");

      // Check database connections
      await this.connectDatabases();

      // Check external service connections
      const dataIntelligenceClient = this.getService<DataIntelligenceClient>(
        "dataIntelligenceClient"
      );
      await dataIntelligenceClient.healthCheck();

      // Validate models
      await this.initializeModels();

      const logger = this._registry.resolve<Logger>("logger");
      logger.info("All services validated successfully");
    } catch (error) {
      const logger = this._registry.resolve<Logger>("logger");
      logger.error("Service validation failed", error as Error);
      throw error;
    }
  }

  /**
   * Graceful shutdown - dispose of all resources
   */
  public async dispose(): Promise<void> {
    try {
      const logger = this._registry.resolve<Logger>("logger");
      logger.info("Disposing AI Engine Container");

      // Dispose services in reverse order
      const modelService = this.getService<ModelService>("modelService");
      await modelService.dispose();

      // Close database connections using static methods
      await Promise.all([
        RedisClient.disconnect(),
        ClickHouseClient.disconnect(),
        PostgreSQLClient.disconnect(),
      ]);

      // Dispose registry
      this._registry.dispose();

      this._initialized = false;
      logger.info("AI Engine Container disposed successfully");
    } catch (error) {
      const logger = this._registry.resolve<Logger>("logger");
      logger.error("Error during container disposal", error as Error);
      throw error;
    }
  }
}

// Export singleton instance
export const container = new AIEngineContainer();
