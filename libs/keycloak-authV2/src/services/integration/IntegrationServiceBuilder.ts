/**
 * Builder Pattern for KeycloakIntegrationService
 * Provides fluent API for progressive service configuration
 *
 * Usage:
 * ```typescript
 * const service = new KeycloakIntegrationServiceBuilder()
 *   .withKeycloakConfig({
 *     serverUrl: 'http://localhost:8080',
 *     realm: 'my-realm',
 *     clientId: 'my-client',
 *   })
 *   .withDatabase(dbClient)
 *   .withCache(cacheService)
 *   .withMetrics(metricsCollector)
 *   .withSync(syncService)
 *   .build();
 * ```
 */

import type { PostgreSQLClient, CacheService } from "@libs/database";
import type { IMetricsCollector } from "@libs/monitoring";
import type { UserSyncService } from "../user/sync/UserSyncService";
import type { KeycloakConnectionOptions } from "./interfaces";
import { KeycloakIntegrationService } from "./KeycloakIntegrationService";

/**
 * Builder configuration interface
 */
export interface BuilderConfig {
  keycloakOptions?: KeycloakConnectionOptions;
  dbClient?: PostgreSQLClient;
  cacheService?: CacheService;
  metrics?: IMetricsCollector;
  syncService?: UserSyncService;
}

/**
 * Validation result interface
 */
interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Builder class for KeycloakIntegrationService
 * Implements fluent API pattern with progressive validation
 */
export class KeycloakIntegrationServiceBuilder {
  private config: BuilderConfig = {};
  private validationErrors: string[] = [];
  private isBuilt = false;

  /**
   * Configure Keycloak connection options
   * @param options - Keycloak server connection details
   * @returns Builder instance for method chaining
   */
  withKeycloakConfig(options: KeycloakConnectionOptions): this {
    this.ensureNotBuilt();

    // Validate options
    if (!options.serverUrl) {
      this.validationErrors.push("serverUrl is required");
    }
    if (!options.realm) {
      this.validationErrors.push("realm is required");
    }
    if (!options.clientId) {
      this.validationErrors.push("clientId is required");
    }

    this.config.keycloakOptions = options;
    return this;
  }

  /**
   * Configure database client
   * @param dbClient - PostgreSQL database client
   * @returns Builder instance for method chaining
   */
  withDatabase(dbClient: PostgreSQLClient): this {
    this.ensureNotBuilt();

    if (!dbClient) {
      this.validationErrors.push("dbClient cannot be null or undefined");
    }

    this.config.dbClient = dbClient;
    return this;
  }

  /**
   * Configure cache service (optional)
   * @param cacheService - Redis cache service
   * @returns Builder instance for method chaining
   */
  withCache(cacheService?: CacheService): this {
    this.ensureNotBuilt();
    if (cacheService) {
      this.config.cacheService = cacheService;
    }
    return this;
  }

  /**
   * Configure metrics collector (optional)
   * @param metrics - Metrics collector instance
   * @returns Builder instance for method chaining
   */
  withMetrics(metrics?: IMetricsCollector): this {
    this.ensureNotBuilt();
    if (metrics) {
      this.config.metrics = metrics;
    }
    return this;
  }

  /**
   * Configure user sync service (optional)
   * @param syncService - User synchronization service
   * @returns Builder instance for method chaining
   */
  withSync(syncService?: UserSyncService): this {
    this.ensureNotBuilt();
    if (syncService) {
      this.config.syncService = syncService;
    }
    return this;
  }

  /**
   * Validate the current configuration
   * @returns Validation result with errors and warnings
   */
  validate(): ValidationResult {
    const errors: string[] = [...this.validationErrors];
    const warnings: string[] = [];

    // Check required fields
    if (!this.config.keycloakOptions) {
      errors.push("Keycloak configuration is required");
    }
    if (!this.config.dbClient) {
      errors.push("Database client is required");
    }

    // Check optional but recommended fields
    if (!this.config.metrics) {
      warnings.push(
        "Metrics collector not configured - monitoring will be limited"
      );
    }
    if (!this.config.cacheService) {
      warnings.push(
        "Cache service not configured - performance may be impacted"
      );
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Build and return the KeycloakIntegrationService instance
   * @throws Error if validation fails
   * @returns Configured KeycloakIntegrationService instance
   */
  build(): KeycloakIntegrationService {
    this.ensureNotBuilt();

    // Validate configuration
    const validation = this.validate();
    if (!validation.valid) {
      throw new Error(
        `Cannot build KeycloakIntegrationService: ${validation.errors.join(
          ", "
        )}`
      );
    }

    // Log warnings
    if (validation.warnings.length > 0) {
      console.warn("KeycloakIntegrationService builder warnings:");
      validation.warnings.forEach((warning) => console.warn(`- ${warning}`));
    }

    // Mark as built to prevent reuse
    this.isBuilt = true;

    // Create and return service instance
    return new KeycloakIntegrationService(
      this.config.keycloakOptions!,
      this.config.dbClient!,
      this.config.cacheService,
      this.config.metrics,
      this.config.syncService
    );
  }

  /**
   * Build with default configurations for common scenarios
   * @param scenario - Configuration scenario ('development', 'production', 'testing')
   * @returns Configured KeycloakIntegrationService instance
   */
  buildWithDefaults(
    scenario: "development" | "production" | "testing"
  ): KeycloakIntegrationService {
    switch (scenario) {
      case "development":
        // Development: Less strict, more logging
        if (!this.config.keycloakOptions) {
          const clientSecret = process.env["KEYCLOAK_CLIENT_SECRET"];
          this.withKeycloakConfig({
            serverUrl:
              process.env["KEYCLOAK_SERVER_URL"] || "http://localhost:8080",
            realm: process.env["KEYCLOAK_REALM"] || "dev-realm",
            clientId: process.env["KEYCLOAK_CLIENT_ID"] || "dev-client",
            ...(clientSecret && { clientSecret }),
          });
        }
        break;

      case "production":
        // Production: Strict requirements
        const validation = this.validate();
        if (!validation.valid) {
          throw new Error(
            `Production build requires all validations to pass: ${validation.errors.join(
              ", "
            )}`
          );
        }
        if (!this.config.cacheService) {
          throw new Error("Cache service is required for production");
        }
        if (!this.config.metrics) {
          throw new Error("Metrics collector is required for production");
        }
        break;

      case "testing":
        // Testing: Use mocks if not provided
        if (!this.config.keycloakOptions) {
          this.withKeycloakConfig({
            serverUrl: "http://localhost:8080",
            realm: "test-realm",
            clientId: "test-client",
          });
        }
        break;
    }

    return this.build();
  }

  /**
   * Reset the builder to its initial state
   * @returns Builder instance for method chaining
   */
  reset(): this {
    this.config = {};
    this.validationErrors = [];
    this.isBuilt = false;
    return this;
  }

  /**
   * Get the current configuration (for debugging)
   * @returns Current builder configuration
   */
  getConfig(): Readonly<BuilderConfig> {
    return {
      ...this.config,
    };
  }

  /**
   * Ensure the builder hasn't been used yet
   * @throws Error if builder has already been used
   */
  private ensureNotBuilt(): void {
    if (this.isBuilt) {
      throw new Error(
        "Builder has already been used. Create a new builder instance or call reset()"
      );
    }
  }
}

/**
 * Factory function for creating a new builder instance
 * @returns New KeycloakIntegrationServiceBuilder instance
 */
export function createIntegrationServiceBuilder(): KeycloakIntegrationServiceBuilder {
  return new KeycloakIntegrationServiceBuilder();
}

/**
 * Quick builder helper for common scenarios
 * @param options - Basic configuration options
 * @returns Configured KeycloakIntegrationService instance
 */
export function quickBuild(options: {
  keycloak: KeycloakConnectionOptions;
  database: PostgreSQLClient;
  cache?: CacheService;
  metrics?: IMetricsCollector;
  sync?: UserSyncService;
}): KeycloakIntegrationService {
  return new KeycloakIntegrationServiceBuilder()
    .withKeycloakConfig(options.keycloak)
    .withDatabase(options.database)
    .withCache(options.cache)
    .withMetrics(options.metrics)
    .withSync(options.sync)
    .build();
}
