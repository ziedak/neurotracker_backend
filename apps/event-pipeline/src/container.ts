import { ValidationService } from "./ingestion/validation.service";
import { RoutingService } from "./processing/routing.service";
import { RedisClient, ClickHouseClient } from "@libs/database";
import { Logger } from "@libs/monitoring";

/**
 * Service Container for Dependency Injection
 * Consolidates service creation and manages dependencies
 */
export class ServiceContainer {
  private static instance: ServiceContainer;
  private services: Map<string, any> = new Map();

  private constructor() {}

  static getInstance(): ServiceContainer {
    if (!ServiceContainer.instance) {
      ServiceContainer.instance = new ServiceContainer();
    }
    return ServiceContainer.instance;
  }

  /**
   * Initialize all services with proper dependency injection
   */
  initializeServices() {
    // Shared resources
    const redis = RedisClient.getInstance();
    const clickhouse = ClickHouseClient.getInstance();
    const logger = new Logger("service-container");

    // Core services (no dependencies)
    this.services.set("ValidationService", new ValidationService());
    this.services.set("Logger", logger);
    this.services.set("RedisClient", redis);
    this.services.set("ClickHouseClient", clickhouse);

    // Services with dependencies
    const routingService = new RoutingService();
    this.services.set("RoutingService", routingService);

    logger.info("Service container initialized", {
      serviceCount: this.services.size,
      services: Array.from(this.services.keys()),
    });
  }

  /**
   * Get service instance by name
   */
  getService<T>(serviceName: string): T {
    const service = this.services.get(serviceName);
    if (!service) {
      throw new Error(`Service ${serviceName} not found in container`);
    }
    return service;
  }

  /**
   * Check if service exists
   */
  hasService(serviceName: string): boolean {
    return this.services.has(serviceName);
  }

  /**
   * Get all service names
   */
  getServiceNames(): string[] {
    return Array.from(this.services.keys());
  }

  /**
   * Clean up all services (for graceful shutdown)
   */
  cleanup() {
    const logger = this.getService<Logger>("Logger");
    logger.info("Cleaning up service container");

    // Clear all service references
    this.services.clear();
  }
}
