import { ServiceRegistry, IServiceRegistry } from "@libs/utils";
import { Logger, MetricsCollector } from "@libs/monitoring";
import { AuthService } from "./services/authService";
import { JWTService } from "@libs/auth";
import { EndpointRegistryService } from "./services/EndpointRegistryService";
// Import middleware factories if needed
// import { RequestMiddleware } from "./middleware/request-middleware";
// import { ErrorMiddleware } from "./middleware/error-middleware";

/**
 * GatewayContainer for API Gateway
 * Registers all gateway-relevant services and middleware for DI
 */
export class GatewayContainer {
  private readonly _registry: IServiceRegistry;
  private _initialized: boolean = false;

  constructor() {
    this._registry = ServiceRegistry; // Use the singleton instance
  }

  /**
   * Initialize all services in dependency order
   */
  public initialize(): void {
    if (this._initialized) return;

    // Logger - singleton
    this._registry.registerSingleton("logger", () => new Logger("api-gateway"));

    // Metrics collector - singleton (using getInstance pattern)
    this._registry.registerSingleton("metricsCollector", () =>
      MetricsCollector.getInstance()
    );

    // JWT Service - singleton
    this._registry.registerSingleton("JWTService", () =>
      JWTService.getInstance()
    );

    // Auth Service - singleton
    this._registry.registerSingleton("AuthService", () => {
      const logger = this._registry.resolve<Logger>("logger");
      const metrics =
        this._registry.resolve<MetricsCollector>("metricsCollector");
      const jwtService = this._registry.resolve<JWTService>("JWTService");

      return new AuthService(logger, metrics, jwtService);
    });

    // Endpoint Registry Service - singleton
    this._registry.registerSingleton("EndpointRegistryService", () => {
      const logger = this._registry.resolve<Logger>("logger");

      return new EndpointRegistryService(logger);
    });

    // Request Middleware - singleton (if needed)
    // this._registry.registerSingleton("requestMiddleware", () => RequestMiddleware());
    // Error Middleware - singleton (if needed)
    // this._registry.registerSingleton("errorMiddleware", () => ErrorMiddleware());

    this._initialized = true;

    this._registry
      .resolve<Logger>("logger")
      .info("API Gateway Container initialized");
  }

  /**
   * Get service instance with type safety
   */
  public getService<T>(key: string): T {
    return this._registry.safeResolve<T>(key);
  }
}

// Export singleton instance
export const container = new GatewayContainer();
