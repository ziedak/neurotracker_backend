import "reflect-metadata";
import { container } from "tsyringe";
import { ValidationService } from "./ingestion/validation.service";
import { RoutingService } from "./processing/routing.service";
import { WebSocketGateway } from "./ingestion/websocket.gateway";
import { BatchController } from "./ingestion/batch.controller";
import { MetricsService } from "./monitoring/metrics.service";
import {
  RedisClient,
  PostgreSQLClient,
  ClickHouseClient,
} from "@libs/database";
import { MetricsCollector } from "@libs/monitoring";
import { createLogger } from "@libs/utils";

/**
 * TSyringe-based DI Container for Event Pipeline Service
 * Replaces the custom ServiceContainer with battle-tested tsyringe
 */
export class EventPipelineTsyringeContainer {
  private static initialized = false;

  /**
   * Initialize all services with tsyringe DI container
   */
  static async initialize(): Promise<void> {
    if (this.initialized) return;

    // Register infrastructure services
    this.registerInfrastructure();

    // Register database clients
    this.registerDatabaseClients();

    // Register business services
    this.registerBusinessServices();

    this.initialized = true;

    const logger = createLogger("EventPipelineContainer");
    logger.info("TSyringe container initialized successfully", {
      servicesRegistered: [
        "ValidationService",
        "RoutingService",
        "RedisClient",
        "PostgreSQLClient",
        "MetricsCollector",
      ],
    });
  }

  /**
   * Register infrastructure services (logging, monitoring)
   */
  private static registerInfrastructure(): void {
    // Register MetricsCollector as singleton with string token
    container.registerSingleton("MetricsCollector", MetricsCollector);
  }

  /**
   * Register database clients as singletons
   */
  private static registerDatabaseClients(): void {
    // Register database clients using string tokens to match @inject decorators
    container.registerSingleton("RedisClient", RedisClient);
    container.registerSingleton("PostgreSQLClient", PostgreSQLClient);
    container.registerSingleton("ClickHouseClient", ClickHouseClient);
  }

  /**
   * Register business services
   */
  private static registerBusinessServices(): void {
    // Register validation service as singleton with string token
    container.registerSingleton("ValidationService", ValidationService);

    // Register routing service as singleton with string token
    container.registerSingleton("RoutingService", RoutingService);

    // Register services with @inject dependencies
    container.registerSingleton("WebSocketGateway", WebSocketGateway);
    container.registerSingleton("BatchController", BatchController);
    container.registerSingleton("MetricsService", MetricsService);
  }

  /**
   * Get service instance with type safety
   */
  static getService<T>(serviceClass: new (...args: any[]) => T): T {
    return container.resolve(serviceClass);
  }

  /**
   * Get service by token
   */
  static getServiceByToken<T>(token: string): T {
    return container.resolve<T>(token);
  }

  /**
   * Clear container (for testing)
   */
  static clear(): void {
    container.clearInstances();
    this.initialized = false;
  }
}

// Export the container for backwards compatibility
export const tsyringeContainer = EventPipelineTsyringeContainer;
