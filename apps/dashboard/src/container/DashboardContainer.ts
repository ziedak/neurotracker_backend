import { ServiceRegistry, IServiceRegistry } from "@libs/utils";
import {
  RedisClient,
  ClickHouseClient,
  PostgreSQLClient,
} from "@libs/database";
import { Logger, MetricsCollector, HealthChecker } from "@libs/monitoring";

// Services
import { AnalyticsService } from "../services/AnalyticsService";
import { UserService } from "../services/UserService";
import { StoreService } from "../services/StoreService";
import { MetricsService } from "../services/MetricsService";
import { CacheService } from "../services/CacheService";
import { APIGatewayService } from "../services/APIGatewayService";

// Middleware
import { AuthMiddleware } from "../middleware/auth.middleware";
import { ValidationMiddleware } from "../middleware/validation.middleware";
import { RateLimitMiddleware } from "../middleware/rateLimit.middleware";
import { LoggingMiddleware } from "../middleware/logging.middleware";
import { ErrorMiddleware } from "../middleware/error.middleware";

export class DashboardContainer {
  private readonly _registry: IServiceRegistry;

  constructor() {
    this._registry = ServiceRegistry;
    this.registerInfrastructure();
    this.registerDatabaseClients();
    this.registerServices();
    this.registerMiddleware();
  }

  get registry(): IServiceRegistry {
    return this._registry;
  }

  private registerInfrastructure(): void {
    this._registry.registerSingleton("logger", () =>
      Logger.getInstance("dashboard")
    );
    this._registry.registerSingleton("metricsCollector", () =>
      MetricsCollector.getInstance()
    );
    this._registry.registerSingleton(
      "healthChecker",
      () => new HealthChecker()
    );
  }

  private registerDatabaseClients(): void {
    this._registry.registerSingleton("redisClient", () =>
      RedisClient.getInstance()
    );
    this._registry.registerSingleton("clickhouseClient", () =>
      ClickHouseClient.getInstance()
    );
    this._registry.registerSingleton("postgresClient", () =>
      PostgreSQLClient.getInstance()
    );
  }

  private registerServices(): void {
    this._registry.registerSingleton("cacheService", () => {
      const redis = this._registry.resolve<RedisClient>("redisClient");
      const logger = this._registry.resolve<Logger>("logger");
      const metrics =
        this._registry.resolve<MetricsCollector>("metricsCollector");
      return new CacheService(redis, logger, metrics);
    });

    this._registry.registerSingleton("apiGatewayService", () => {
      const cache = this._registry.resolve<CacheService>("cacheService");
      const logger = this._registry.resolve<Logger>("logger");
      const metrics =
        this._registry.resolve<MetricsCollector>("metricsCollector");
      return new APIGatewayService(cache, logger, metrics);
    });

    this._registry.registerSingleton("analyticsService", () => {
      const clickhouse =
        this._registry.resolve<ClickHouseClient>("clickhouseClient");
      const postgres =
        this._registry.resolve<PostgreSQLClient>("postgresClient");
      const cache = this._registry.resolve<CacheService>("cacheService");
      const apiGateway =
        this._registry.resolve<APIGatewayService>("apiGatewayService");
      const logger = this._registry.resolve<Logger>("logger");
      const metrics =
        this._registry.resolve<MetricsCollector>("metricsCollector");
      return new AnalyticsService(
        clickhouse,
        postgres,
        cache,
        apiGateway,
        logger,
        metrics
      );
    });

    this._registry.registerSingleton("userService", () => {
      const cache = this._registry.resolve<CacheService>("cacheService");
      const apiGateway =
        this._registry.resolve<APIGatewayService>("apiGatewayService");
      const logger = this._registry.resolve<Logger>("logger");
      const metrics =
        this._registry.resolve<MetricsCollector>("metricsCollector");
      return new UserService(cache, apiGateway, logger, metrics);
    });

    this._registry.registerSingleton("storeService", () => {
      const cache = this._registry.resolve<CacheService>("cacheService");
      const apiGateway =
        this._registry.resolve<APIGatewayService>("apiGatewayService");
      const logger = this._registry.resolve<Logger>("logger");
      const metrics =
        this._registry.resolve<MetricsCollector>("metricsCollector");
      return new StoreService(cache, apiGateway, logger, metrics);
    });

    this._registry.registerSingleton("metricsService", () => {
      const cache = this._registry.resolve<CacheService>("cacheService");
      const apiGateway =
        this._registry.resolve<APIGatewayService>("apiGatewayService");
      const logger = this._registry.resolve<Logger>("logger");
      const metrics =
        this._registry.resolve<MetricsCollector>("metricsCollector");
      return new MetricsService(cache, apiGateway, logger, metrics);
    });
  }

  private registerMiddleware(): void {
    this._registry.registerSingleton("authMiddleware", () => {
      const logger = this._registry.resolve<Logger>("logger");
      return new AuthMiddleware(logger);
    });

    this._registry.registerSingleton("validationMiddleware", () => {
      const logger = this._registry.resolve<Logger>("logger");
      return new ValidationMiddleware(logger);
    });

    this._registry.registerSingleton("rateLimitMiddleware", () => {
      const logger = this._registry.resolve<Logger>("logger");
      return new RateLimitMiddleware(logger);
    });

    this._registry.registerSingleton("loggingMiddleware", () => {
      const logger = this._registry.resolve<Logger>("logger");
      return new LoggingMiddleware(logger);
    });

    this._registry.registerSingleton("errorMiddleware", () => {
      const logger = this._registry.resolve<Logger>("logger");
      return new ErrorMiddleware(logger);
    });
  }

  resolve<T>(serviceName: string): T {
    return this._registry.resolve<T>(serviceName);
  }

  isRegistered(serviceName: string): boolean {
    return this._registry.isRegistered(serviceName);
  }
}
