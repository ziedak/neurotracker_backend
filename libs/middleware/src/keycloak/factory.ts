/**
 * Industry-Standard Keycloak Middleware Factory
 * Creates middleware instances with proper dependency injection
 */

import { ILogger, IMetricsCollector } from "@libs/monitoring";
import { RedisClient } from "@libs/database";
import { KeycloakService } from "./Keycloak.service";
import { KeycloakServiceFactory } from "./service-factory";
import { KeycloakConfigValidator } from "./config-validator";
import { IndustryStandardKeycloakMiddleware } from "./industry-standard-middleware";
import {
  IKeycloakMiddlewareOptions,
  IKeycloakMiddlewareDependencies,
} from "./interfaces";
import { KeycloakConfig } from "./types";

/**
 * Factory function to create industry-standard Keycloak middleware
 */
export async function createKeycloakMiddleware(
  logger: ILogger,
  metrics: IMetricsCollector,
  redis: RedisClient,
  config: KeycloakConfig,
  options: Partial<IKeycloakMiddlewareOptions> = {}
): Promise<IndustryStandardKeycloakMiddleware> {
  // Create service factory
  const factory = KeycloakServiceFactory.create({
    redis,
    logger,
    metrics: metrics as any, // Type compatibility
  });
  const keycloakService = await factory.create(config);

  // Setup dependencies
  const dependencies: IKeycloakMiddlewareDependencies = {
    keycloakService,
    configValidator: new KeycloakConfigValidator(),
  };

  // Create middleware options
  const middlewareOptions: IKeycloakMiddlewareOptions = {
    name: options.name || "keycloak-auth",
    enabled: options.enabled ?? true,
    config,
    dependencies,
    ...options,
  };

  return new IndustryStandardKeycloakMiddleware(
    logger,
    metrics,
    middlewareOptions
  );
}

/**
 * Factory function for creating middleware with existing service
 */
export function createKeycloakMiddlewareWithService(
  logger: ILogger,
  metrics: IMetricsCollector,
  keycloakService: KeycloakService,
  config: KeycloakConfig,
  options: Partial<IKeycloakMiddlewareOptions> = {}
): IndustryStandardKeycloakMiddleware {
  const dependencies: IKeycloakMiddlewareDependencies = {
    keycloakService,
    configValidator: new KeycloakConfigValidator(),
  };

  const middlewareOptions: IKeycloakMiddlewareOptions = {
    name: options.name || "keycloak-auth",
    enabled: options.enabled ?? true,
    config,
    dependencies,
    ...options,
  };

  return new IndustryStandardKeycloakMiddleware(
    logger,
    metrics,
    middlewareOptions
  );
}

/**
 * Create middleware for development with default configuration
 */
export async function createDevKeycloakMiddleware(
  logger: ILogger,
  metrics: IMetricsCollector,
  redis: RedisClient,
  overrides: Partial<KeycloakConfig> = {}
): Promise<IndustryStandardKeycloakMiddleware> {
  const { KeycloakConfigValidator } = await import("./config-validator");

  const devConfig = KeycloakConfigValidator.createDevConfig(overrides);

  return createKeycloakMiddleware(logger, metrics, redis, devConfig, {
    name: "keycloak-dev",
  });
}

/**
 * Create middleware for production with validated configuration
 */
export async function createProdKeycloakMiddleware(
  logger: ILogger,
  metrics: IMetricsCollector,
  redis: RedisClient,
  config: KeycloakConfig,
  options: Partial<IKeycloakMiddlewareOptions> = {}
): Promise<IndustryStandardKeycloakMiddleware> {
  const { KeycloakConfigValidator } = await import("./config-validator");

  // Validate production configuration
  const validatedConfig =
    KeycloakConfigValidator.createProductionConfig(config);

  return createKeycloakMiddleware(logger, metrics, redis, validatedConfig, {
    ...options,
    name: options.name || "keycloak-prod",
  });
}
