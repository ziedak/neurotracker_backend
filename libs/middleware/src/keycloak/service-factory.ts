/**
 * Keycloak Service Factory
 * Follows industry standards for service creation and dependency injection
 */

import { ILogger, MetricsCollector } from "@libs/monitoring";
import { RedisClient } from "@libs/database";
import { KeycloakService } from "./Keycloak.service";
import { KeycloakConfigValidator } from "./config-validator";
import {
  IKeycloakService,
  IKeycloakServiceFactory,
  IKeycloakConfigValidator,
} from "./interfaces";
import { KeycloakConfig, KeycloakError, KeycloakErrorType } from "./types";

/**
 * Dependencies required to create Keycloak service instances
 */
export interface KeycloakServiceDependencies {
  readonly redis: RedisClient;
  readonly logger: ILogger;
  readonly metrics: MetricsCollector;
  readonly configValidator?: IKeycloakConfigValidator;
}

/**
 * Production-grade Keycloak service factory
 * Implements proper dependency injection and service creation patterns
 */
export class KeycloakServiceFactory implements IKeycloakServiceFactory {
  private static instance: KeycloakServiceFactory;
  private readonly singletonInstances = new Map<string, IKeycloakService>();

  private constructor(
    private readonly dependencies: KeycloakServiceDependencies
  ) {}

  /**
   * Create factory instance with dependencies
   */
  static create(
    dependencies: KeycloakServiceDependencies
  ): KeycloakServiceFactory {
    return new KeycloakServiceFactory(dependencies);
  }

  /**
   * Get or create singleton factory instance
   */
  static getInstance(
    dependencies?: KeycloakServiceDependencies
  ): KeycloakServiceFactory {
    if (!KeycloakServiceFactory.instance) {
      if (!dependencies) {
        throw new KeycloakError(
          "Dependencies required for first factory instantiation",
          KeycloakErrorType.CONFIGURATION_ERROR
        );
      }
      KeycloakServiceFactory.instance = new KeycloakServiceFactory(
        dependencies
      );
    }
    return KeycloakServiceFactory.instance;
  }

  /**
   * Create a new Keycloak service instance
   */
  async create(config: KeycloakConfig): Promise<IKeycloakService> {
    const validator =
      this.dependencies.configValidator || new KeycloakConfigValidator();
    const validatedConfig = validator.validate(config);

    const service = new KeycloakService(
      this.dependencies.redis,
      this.dependencies.logger,
      this.dependencies.metrics,
      validatedConfig
    );

    // Initialize the service
    await this.initializeService(service, validatedConfig);

    return service;
  }

  /**
   * Create or get singleton instance for the given configuration
   */
  async createSingleton(config: KeycloakConfig): Promise<IKeycloakService> {
    const configKey = this.generateConfigKey(config);

    if (this.singletonInstances.has(configKey)) {
      return this.singletonInstances.get(configKey)!;
    }

    const service = await this.create(config);
    this.singletonInstances.set(configKey, service);

    return service;
  }

  /**
   * Create service with development defaults
   */
  async createForDevelopment(
    overrides: Partial<KeycloakConfig> = {}
  ): Promise<IKeycloakService> {
    const config = KeycloakConfigValidator.createDevConfig(overrides);
    return this.create(config);
  }

  /**
   * Create service with production defaults
   */
  async createForProduction(
    config: Partial<KeycloakConfig>
  ): Promise<IKeycloakService> {
    const prodConfig = KeycloakConfigValidator.createProductionConfig(config);
    return this.create(prodConfig);
  }

  /**
   * Create multiple services for different realms/clients
   */
  async createMultiple(
    configs: KeycloakConfig[]
  ): Promise<Map<string, IKeycloakService>> {
    const services = new Map<string, IKeycloakService>();

    const creationPromises = configs.map(async (config) => {
      const key = `${config.realm}:${config.clientId}`;
      const service = await this.create(config);
      return { key, service };
    });

    const results = await Promise.all(creationPromises);

    for (const { key, service } of results) {
      services.set(key, service);
    }

    return services;
  }

  /**
   * Destroy all singleton instances
   */
  async destroyAllSingletons(): Promise<void> {
    const destroyPromises = Array.from(this.singletonInstances.values()).map(
      (service) => service.destroy()
    );

    await Promise.all(destroyPromises);
    this.singletonInstances.clear();
  }

  /**
   * Get factory statistics
   */
  getStatistics(): {
    singletonCount: number;
    singletonKeys: string[];
    factoryInfo: {
      hasRedis: boolean;
      hasLogger: boolean;
      hasMetrics: boolean;
      hasValidator: boolean;
    };
  } {
    return {
      singletonCount: this.singletonInstances.size,
      singletonKeys: Array.from(this.singletonInstances.keys()),
      factoryInfo: {
        hasRedis: !!this.dependencies.redis,
        hasLogger: !!this.dependencies.logger,
        hasMetrics: !!this.dependencies.metrics,
        hasValidator: !!this.dependencies.configValidator,
      },
    };
  }

  /**
   * Initialize service with health checks and validation
   */
  private async initializeService(
    service: IKeycloakService,
    config: KeycloakConfig
  ): Promise<void> {
    try {
      // Perform health check to ensure service is working
      const health = await service.getHealthStatus();

      if (health.status === "unhealthy") {
        throw new KeycloakError(
          `Service initialization failed: ${JSON.stringify(health.details)}`,
          KeycloakErrorType.CONNECTION_ERROR
        );
      }

      this.dependencies.logger.info(
        "Keycloak service initialized successfully",
        {
          realm: config.realm,
          clientId: config.clientId,
          verifyTokenLocally: config.verifyTokenLocally,
          healthStatus: health.status,
        }
      );
    } catch (error) {
      this.dependencies.logger.error(
        "Service initialization failed",
        error as Error
      );
      throw error;
    }
  }

  /**
   * Generate unique key for configuration caching
   */
  private generateConfigKey(config: KeycloakConfig): string {
    const keyParts = [
      config.serverUrl,
      config.realm,
      config.clientId,
      config.verifyTokenLocally ? "local" : "remote",
    ];

    return keyParts.join(":");
  }
}

/**
 * Convenience function to create a service factory
 */
export function createKeycloakServiceFactory(
  dependencies: KeycloakServiceDependencies
): KeycloakServiceFactory {
  return KeycloakServiceFactory.create(dependencies);
}

/**
 * Convenience function to create a service directly
 */
export async function createKeycloakService(
  config: KeycloakConfig,
  dependencies: KeycloakServiceDependencies
): Promise<IKeycloakService> {
  const factory = KeycloakServiceFactory.create(dependencies);
  return factory.create(config);
}
