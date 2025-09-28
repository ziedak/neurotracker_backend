/**
 * Resource Manager Component
 * Single Responsibility: Resource initialization, cleanup, and monitoring
 */

import { createLogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import type { PostgreSQLClient } from "@libs/database";
import type { IResourceManager } from "./interfaces";
import type { KeycloakClient } from "../../client/KeycloakClient";

/**
 * Resource Manager Component
 * Handles resource lifecycle management and monitoring
 */
export class ResourceManager implements IResourceManager {
  private readonly logger = createLogger("ResourceManager");

  constructor(
    private readonly keycloakClient: KeycloakClient,
    private readonly dbClient: PostgreSQLClient,
    private readonly metrics?: IMetricsCollector
  ) {}

  /**
   * Initialize all resources
   */
  async initialize(): Promise<void> {
    const startTime = performance.now();

    try {
      await this.keycloakClient.initialize();
      this.logger.info("Keycloak integration initialized successfully");

      this.metrics?.recordCounter("keycloak.integration.initialized", 1);
      this.metrics?.recordTimer(
        "keycloak.integration.init_duration",
        performance.now() - startTime
      );
    } catch (error) {
      const errorDetails = this.categorizeInitializationError(error);

      this.logger.error("Failed to initialize Keycloak integration", {
        error: error instanceof Error ? error.message : String(error),
        errorType:
          error instanceof Error ? error.constructor.name : typeof error,
        category: errorDetails.category,
      });

      this.metrics?.recordCounter(
        `keycloak.integration.${errorDetails.metricSuffix}`,
        1
      );
      throw new Error(errorDetails.message);
    }
  }

  /**
   * Cleanup all resources and connections
   */
  async cleanup(): Promise<void> {
    this.logger.info("Starting Keycloak Integration Service cleanup");
    const cleanupErrors: Error[] = [];
    const startTime = performance.now();

    try {
      // Cleanup Keycloak client - no persistent connections to close
      try {
        this.logger.debug(
          "Keycloak client cleanup - no persistent connections"
        );
      } catch (error) {
        cleanupErrors.push(error as Error);
        this.logger.error("Failed to cleanup Keycloak client", { error });
      }

      // Cleanup database connection using the actual disconnect method
      try {
        await this.dbClient.disconnect();
        this.logger.debug("Database client disconnected successfully");
      } catch (error) {
        cleanupErrors.push(error as Error);
        this.logger.error("Failed to cleanup database client", { error });
      }

      this.logger.info("Keycloak Integration Service cleanup completed", {
        errors: cleanupErrors.length,
        duration: performance.now() - startTime,
      });

      // Record cleanup metrics
      this.metrics?.recordCounter("keycloak.integration.cleanup_completed", 1);
      this.metrics?.recordTimer(
        "keycloak.integration.cleanup_duration",
        performance.now() - startTime
      );

      if (cleanupErrors.length > 0) {
        this.metrics?.recordCounter(
          "keycloak.integration.cleanup_errors",
          cleanupErrors.length
        );
      }

      // If there were cleanup errors, throw them
      if (cleanupErrors.length === 1) {
        throw cleanupErrors[0];
      } else if (cleanupErrors.length > 1) {
        throw new Error(
          `Multiple cleanup errors: ${cleanupErrors
            .map((e) => e.message)
            .join(", ")}`
        );
      }
    } catch (error) {
      this.logger.error("Critical error during cleanup", { error });
      this.metrics?.recordCounter(
        "keycloak.integration.cleanup_critical_error",
        1
      );
      throw error;
    }
  }

  /**
   * Get resource usage statistics for monitoring memory leaks
   */
  getResourceStats(): {
    connections: {
      keycloak: boolean;
      database: boolean;
      sessions: number;
    };
    memory: {
      heapUsed: number;
      heapTotal: number;
    };
    uptime: number;
  } {
    const memUsage = process.memoryUsage();

    return {
      connections: {
        keycloak: !!this.keycloakClient,
        database: !!this.dbClient,
        sessions: 0, // Would need to implement session counting in session manager
      },
      memory: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
      },
      uptime: process.uptime(),
    };
  }

  /**
   * Check system health
   */
  async checkHealth(): Promise<{
    status: "healthy" | "degraded" | "unhealthy";
    details: Record<string, any>;
    timestamp: Date;
  }> {
    const startTime = performance.now();
    const details: Record<string, any> = {};
    let status: "healthy" | "degraded" | "unhealthy" = "healthy";

    try {
      // Check Keycloak client health
      try {
        // Basic check - if client exists and has discovery data
        const hasDiscovery =
          this.keycloakClient.getStats?.()?.discoveryLoaded || false;
        details["keycloak"] = {
          status: hasDiscovery ? "healthy" : "degraded",
          discoveryLoaded: hasDiscovery,
        };
        if (!hasDiscovery) {
          status = "degraded";
        }
      } catch (error) {
        details["keycloak"] = {
          status: "unhealthy",
          error: error instanceof Error ? error.message : String(error),
        };
        status = "unhealthy";
      }

      // Check database health
      try {
        // Simple check - if client exists (more complex health checks would require actual queries)
        details["database"] = {
          status: this.dbClient ? "healthy" : "unhealthy",
          connected: !!this.dbClient,
        };
        if (!this.dbClient) {
          status = "unhealthy";
        }
      } catch (error) {
        details["database"] = {
          status: "unhealthy",
          error: error instanceof Error ? error.message : String(error),
        };
        status = "unhealthy";
      }

      // Check memory usage
      const memUsage = process.memoryUsage();
      const memoryUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
      details["memory"] = {
        status: memoryUsagePercent > 90 ? "degraded" : "healthy",
        usagePercent: memoryUsagePercent,
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
      };

      if (memoryUsagePercent > 90 && status === "healthy") {
        status = "degraded";
      }

      details["checkDuration"] = performance.now() - startTime;

      this.metrics?.recordCounter(
        `keycloak.integration.health_check_${status}`,
        1
      );
      this.metrics?.recordTimer(
        "keycloak.integration.health_check_duration",
        details["checkDuration"] as number
      );

      return {
        status,
        details,
        timestamp: new Date(),
      };
    } catch (error) {
      this.logger.error("Health check failed", {
        error: error instanceof Error ? error.message : String(error),
      });

      this.metrics?.recordCounter("keycloak.integration.health_check_error", 1);

      return {
        status: "unhealthy",
        details: {
          error: error instanceof Error ? error.message : String(error),
          ["checkDuration"]: performance.now() - startTime,
        },
        timestamp: new Date(),
      };
    }
  }

  /**
   * Categorize initialization errors for better error handling
   */
  private categorizeInitializationError(error: unknown): {
    message: string;
    metricSuffix: string;
    category: string;
  } {
    let message = "Failed to initialize Keycloak integration";
    let metricSuffix = "init_error";
    let category = "unknown";

    if (error instanceof Error) {
      if (
        error.message.includes("network") ||
        error.message.includes("ENOTFOUND")
      ) {
        message = "Cannot connect to Keycloak server";
        metricSuffix = "init_connection_failed";
        category = "network";
      } else if (error.message.includes("timeout")) {
        message = "Keycloak server timeout during initialization";
        metricSuffix = "init_timeout";
        category = "timeout";
      } else if (
        error.message.includes("401") ||
        error.message.includes("403")
      ) {
        message = "Invalid Keycloak credentials";
        metricSuffix = "init_auth_failed";
        category = "authentication";
      } else if (error.message.includes("404")) {
        message = "Keycloak realm or configuration not found";
        metricSuffix = "init_config_not_found";
        category = "configuration";
      } else if (
        error.message.includes("certificate") ||
        error.message.includes("SSL")
      ) {
        message = "SSL/TLS certificate validation failed";
        metricSuffix = "init_ssl_failed";
        category = "ssl";
      }
    }

    return { message, metricSuffix, category };
  }
}
