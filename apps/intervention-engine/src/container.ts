import { ServiceRegistry, IServiceRegistry } from "@libs/utils";
import { RedisClient, PostgreSQLClient } from "@libs/database";
import { Logger, MetricsCollector, HealthChecker } from "@libs/monitoring";

/**
 * Intervention Engine Container
 * Manages all services and dependencies for the Intervention Engine service
 * Follows the established pattern from ai-engine and data-intelligence services
 */
export class InterventionEngineContainer {
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

      // Register business services (to be implemented)
      // this.registerBusinessServices();

      // Initialize core services in order
      this._registry.initializeCore([
        "logger",
        "metricsCollector",
        "healthChecker",
      ]);

      this._initialized = true;

      const logger = this._registry.resolve<Logger>("logger");
      logger.info("Intervention Engine Container initialized successfully");
    } catch (error) {
      const logger = this._registry.resolve<Logger>("logger");
      logger.error(
        "Failed to initialize Intervention Engine Container",
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
      () => new Logger("intervention-engine")
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
   * Register database clients as singletons using static getInstance() patterns
   */
  private registerDatabaseClients(): void {
    // Redis client - using static getInstance
    this._registry.registerSingleton("redisClient", () =>
      RedisClient.getInstance()
    );

    // PostgreSQL client - using static getInstance (for intervention data)
    this._registry.registerSingleton("postgresClient", () =>
      PostgreSQLClient.getInstance()
    );
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
   * Validate all service dependencies
   */
  public async validateServices(): Promise<void> {
    try {
      const healthChecker = this.getService<HealthChecker>("healthChecker");

      // Check database connections
      await this.connectDatabases();

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
      logger.info("Disposing Intervention Engine Container");

      // Close database connections using static methods
      await Promise.all([
        RedisClient.disconnect(),
        PostgreSQLClient.disconnect(),
      ]);

      // Dispose registry
      this._registry.dispose();

      this._initialized = false;
      logger.info("Intervention Engine Container disposed successfully");
    } catch (error) {
      const logger = this._registry.resolve<Logger>("logger");
      logger.error("Error during container disposal", error as Error);
      throw error;
    }
  }
}

// Export singleton instance
export const container = new InterventionEngineContainer();
