import { ValidationService } from "../src/ingestion/validation.service";
import { RoutingService } from "../src/processing/routing.service";
import { RedisClient } from "@libs/database";
import { createLogger } from "@libs/utils";
/**
 * Service Container for Dependency Injection
 * Consolidates service creation and manages dependencies
 */
export class ServiceContainer {
    static instance;
    services = new Map();
    logger = createLogger("service-container");
    constructor() { }
    static getInstance() {
        if (!ServiceContainer.instance) {
            ServiceContainer.instance = new ServiceContainer();
        }
        return ServiceContainer.instance;
    }
    /**
     * Initialize all services with proper dependency injection
     */
    initializeServices() {
        // Shared resources - TODO: Migrate to TSyringe container
        const redis = RedisClient.getInstance();
        // const clickhouse = container.resolve(ClickHouseClient); // After TSyringe migration
        // Core services (no dependencies)
        this.services.set("ValidationService", new ValidationService());
        this.services.set("RedisClient", redis);
        // TODO: Add ClickHouseClient after TSyringe migration
        // this.services.set("ClickHouseClient", container.resolve(ClickHouseClient));
        // Services with dependencies
        const routingService = new RoutingService();
        this.services.set("RoutingService", routingService);
        this.logger.info("Service container initialized", {
            serviceCount: this.services.size,
            services: Array.from(this.services.keys()),
        });
    }
    /**
     * Get service instance by name
     */
    getService(serviceName) {
        const service = this.services.get(serviceName);
        if (!service) {
            throw new Error(`Service ${serviceName} not found in container`);
        }
        return service;
    }
    /**
     * Check if service exists
     */
    hasService(serviceName) {
        return this.services.has(serviceName);
    }
    /**
     * Get all service names
     */
    getServiceNames() {
        return Array.from(this.services.keys());
    }
    /**
     * Clean up all services (for graceful shutdown)
     */
    cleanup() {
        this.logger.info("Cleaning up service container");
        // Clear all service references
        this.services.clear();
    }
}
//# sourceMappingURL=container.js.map