import { ServiceRegistry, IServiceRegistry } from "@libs/utils";
import {
  RedisClient,
  ClickHouseClient,
  PostgreSQLClient,
} from "@libs/database";
import { Logger, MetricsCollector, HealthChecker } from "@libs/monitoring";
import { FeatureStoreService } from "./services/featureStore.service";
import { DataExportService } from "./services/dataExport.service";
import { BusinessIntelligenceService } from "./services/businessIntelligence.service";
import { DataQualityService } from "./services/dataQuality.service";
import { DataReconciliationService } from "./services/dataReconciliation.service";
import { SecurityService } from "./services/security.service";
import { AuthMiddleware } from "./middleware/auth.middleware";
import { ValidationMiddleware } from "./middleware/validation.middleware";
import { RateLimitMiddleware } from "./middleware/rateLimit.middleware";
import { AuditMiddleware } from "./middleware/audit.middleware";

/**
 * Data Intelligence Container
 * Manages all services and dependencies for the data intelligence service
 */
export class DataIntelligenceContainer {
  private readonly _registry: IServiceRegistry;
  private _initialized: boolean = false;

  // Add circuit breaker and LRU cache keys
  private readonly CIRCUIT_BREAKER_KEY = "circuitBreaker";
  private readonly LRU_CACHE_KEY = "featureLruCache";

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
      logger.info("Data Intelligence Container initialized successfully");
    } catch (error) {
      const logger = this._registry.resolve<Logger>("logger");
      logger.error(
        "Failed to initialize Data Intelligence Container",
        error as Error
      );
      throw error;
    }
  }

  /**
   * Register infrastructure services (logging, monitoring, health checks)
   */
  private registerInfrastructure(): void {
    // Logger - singleton
    this._registry.registerSingleton(
      "logger",
      () => new Logger("data-intelligence")
    );

    // Metrics collector - singleton (using getInstance pattern)
    this._registry.registerSingleton("metricsCollector", () =>
      MetricsCollector.getInstance()
    );

    // Health checker - singleton
    this._registry.registerSingleton("healthChecker", () => {
      return new HealthChecker();
    });

    // Circuit breaker - singleton
    this._registry.registerSingleton(
      this.CIRCUIT_BREAKER_KEY,
      () =>
        new (require("@libs/utils").CircuitBreaker)({
          threshold: 5,
          timeout: 30000,
          resetTimeout: 60000,
        })
    );

    // LRU cache for features - singleton
    this._registry.registerSingleton(
      this.LRU_CACHE_KEY,
      () =>
        new (require("@libs/utils").LRUCache)({
          max: 10000,
          ttl: 3600 * 1000, // 1 hour
          allowStale: true,
          ttlAutopurge: true,
        })
    );
  }

  /**
   * Register database clients as singletons using static getInstance() patterns
   */
  private registerDatabaseClients(): void {
    // Redis client - using static getInstance
    this._registry.registerSingleton("redisClient", () =>
      RedisClient.getInstance()
    );

    // ClickHouse client - using static getInstance
    this._registry.registerSingleton("clickhouseClient", () =>
      ClickHouseClient.getInstance()
    );

    // PostgreSQL client - using static getInstance
    this._registry.registerSingleton("postgresClient", () =>
      PostgreSQLClient.getInstance()
    );
  }

  /**
   * Register business services with proper dependency injection
   */
  private registerBusinessServices(): void {
    // Enhanced Feature Store Service - singleton
    this._registry.registerSingleton("featureStoreService", () => {
      const redis = this._registry.resolve<RedisClient>("redisClient");
      const clickhouse =
        this._registry.resolve<ClickHouseClient>("clickhouseClient");
      const postgres =
        this._registry.resolve<PostgreSQLClient>("postgresClient");
      const logger = this._registry.resolve<Logger>("logger");
      const metrics =
        this._registry.resolve<MetricsCollector>("metricsCollector");
      const circuitBreaker = this._registry.resolve<any>(
        this.CIRCUIT_BREAKER_KEY
      );
      const lruCache = this._registry.resolve<any>(this.LRU_CACHE_KEY);

      return new FeatureStoreService(
        redis,
        clickhouse,
        postgres,
        logger,
        metrics,
        circuitBreaker,
        lruCache
      );
    });

    // Data Export Service - singleton
    this._registry.registerSingleton("dataExportService", () => {
      const logger = this._registry.resolve<Logger>("logger");
      const metrics =
        this._registry.resolve<MetricsCollector>("metricsCollector");

      return new DataExportService(logger, metrics);
    });

    // Business Intelligence Service - singleton
    this._registry.registerSingleton("businessIntelligenceService", () => {
      const clickhouse =
        this._registry.resolve<ClickHouseClient>("clickhouseClient");
      const postgres =
        this._registry.resolve<PostgreSQLClient>("postgresClient");
      const redis = this._registry.resolve<RedisClient>("redisClient");
      const logger = this._registry.resolve<Logger>("logger");
      const metrics =
        this._registry.resolve<MetricsCollector>("metricsCollector");

      return new BusinessIntelligenceService(
        redis,
        clickhouse,
        postgres,
        logger,
        metrics
      );
    });

    // Data Quality Service - singleton
    this._registry.registerSingleton("dataQualityService", () => {
      const clickhouse =
        this._registry.resolve<ClickHouseClient>("clickhouseClient");
      const postgres =
        this._registry.resolve<PostgreSQLClient>("postgresClient");
      const redis = this._registry.resolve<RedisClient>("redisClient");
      const logger = this._registry.resolve<Logger>("logger");
      const metrics =
        this._registry.resolve<MetricsCollector>("metricsCollector");

      return new DataQualityService(
        clickhouse,
        postgres,
        redis,
        logger,
        metrics
      );
    });

    // Data Reconciliation Service - singleton
    this._registry.registerSingleton("dataReconciliationService", () => {
      const clickhouse =
        this._registry.resolve<ClickHouseClient>("clickhouseClient");
      const postgres =
        this._registry.resolve<PostgreSQLClient>("postgresClient");
      const redis = this._registry.resolve<RedisClient>("redisClient");
      const logger = this._registry.resolve<Logger>("logger");
      const metrics =
        this._registry.resolve<MetricsCollector>("metricsCollector");

      return new DataReconciliationService(
        redis,
        clickhouse,
        postgres,
        logger,
        metrics
      );
    });

    // Security Service - singleton
    this._registry.registerSingleton("securityService", () => {
      const postgres =
        this._registry.resolve<PostgreSQLClient>("postgresClient");
      const redis = this._registry.resolve<RedisClient>("redisClient");
      const logger = this._registry.resolve<Logger>("logger");
      const metrics =
        this._registry.resolve<MetricsCollector>("metricsCollector");

      return new SecurityService(redis, postgres, logger, metrics);
    });
  }

  /**
   * Register middleware components with proper dependency injection
   */
  private registerMiddleware(): void {
    // Authentication Middleware - singleton
    this._registry.registerSingleton("authMiddleware", () => {
      const securityService =
        this._registry.resolve<SecurityService>("securityService");
      const logger = this._registry.resolve<Logger>("logger");

      return new AuthMiddleware(securityService, logger);
    });

    // Validation Middleware - singleton
    this._registry.registerSingleton("validationMiddleware", () => {
      const logger = this._registry.resolve<Logger>("logger");

      return new ValidationMiddleware(logger);
    });

    // Rate Limit Middleware - singleton
    this._registry.registerSingleton("rateLimitMiddleware", () => {
      const redis = this._registry.resolve<RedisClient>("redisClient");
      const logger = this._registry.resolve<Logger>("logger");
      const metrics =
        this._registry.resolve<MetricsCollector>("metricsCollector");

      return new RateLimitMiddleware(redis, logger, metrics);
    });

    // Audit Middleware - singleton
    this._registry.registerSingleton("auditMiddleware", () => {
      const redis = this._registry.resolve<RedisClient>("redisClient");
      const clickhouse =
        this._registry.resolve<ClickHouseClient>("clickhouseClient");
      const logger = this._registry.resolve<Logger>("logger");
      const metrics =
        this._registry.resolve<MetricsCollector>("metricsCollector");

      return new AuditMiddleware(redis, clickhouse, logger, metrics);
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
      await RedisClient.connect();
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
   * Graceful shutdown - dispose of all resources
   */
  public async dispose(): Promise<void> {
    try {
      const logger = this._registry.resolve<Logger>("logger");
      logger.info("Disposing Data Intelligence Container");

      // Close database connections using static methods
      await Promise.all([
        RedisClient.disconnect(),
        ClickHouseClient.disconnect(),
        PostgreSQLClient.disconnect(),
      ]);

      // Dispose registry
      this._registry.dispose();

      this._initialized = false;
      logger.info("Data Intelligence Container disposed successfully");
    } catch (error) {
      const logger = this._registry.resolve<Logger>("logger");
      logger.error("Error during container disposal", error as Error);
      throw error;
    }
  }
}

// Export singleton instance
export const container = new DataIntelligenceContainer();
