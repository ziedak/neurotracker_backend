/**
 * Keycloak Middleware Interfaces
 * Following industry standards with proper interface segregation
 */

import {
  KeycloakConfig,
  KeycloakTokenVerification,
  KeycloakUserInfo,
  KeycloakServiceResponse,
} from "./types";

/**
 * Core Keycloak authentication service interface
 * Follows Interface Segregation Principle
 */
export interface IKeycloakAuthService {
  /**
   * Verify JWT token
   */
  verifyToken(token: string): Promise<KeycloakTokenVerification>;

  /**
   * Get user information
   */
  getUserInfo(
    token: string
  ): Promise<KeycloakServiceResponse<KeycloakUserInfo>>;
}

/**
 * Cache management interface for Keycloak service
 */
export interface IKeycloakCacheService {
  /**
   * Get cache statistics
   */
  getCacheStats(): Promise<Record<string, number>>;

  /**
   * Clear all caches
   */
  clearCache(): Promise<void>;

  /**
   * Clean up expired cache entries
   */
  cleanupExpiredEntries(): void;
}

/**
 * Health monitoring interface for Keycloak service
 */
export interface IKeycloakHealthService {
  /**
   * Get health status
   */
  getHealthStatus(): Promise<{
    status: "healthy" | "unhealthy" | "degraded";
    details: Record<string, any>;
  }>;
}

/**
 * Resource management interface
 */
export interface IDisposable {
  /**
   * Clean up resources
   */
  destroy(): Promise<void>;
}

/**
 * Complete Keycloak service interface combining all capabilities
 */
export interface IKeycloakService
  extends IKeycloakAuthService,
    IKeycloakCacheService,
    IKeycloakHealthService,
    IDisposable {}

/**
 * Factory interface for creating Keycloak service instances
 */
export interface IKeycloakServiceFactory {
  /**
   * Create a new Keycloak service instance
   */
  create(config: KeycloakConfig): Promise<IKeycloakService>;

  /**
   * Create a singleton instance (if supported)
   */
  createSingleton(config: KeycloakConfig): Promise<IKeycloakService>;
}

/**
 * Configuration validation interface
 */
export interface IKeycloakConfigValidator {
  /**
   * Validate configuration
   */
  validate(config: Partial<KeycloakConfig>): KeycloakConfig;

  /**
   * Check if configuration is valid
   */
  isValid(config: Partial<KeycloakConfig>): boolean;
}

/**
 * Token validation strategy interface
 */
export interface ITokenValidationStrategy {
  /**
   * Validate token using this strategy
   */
  validate(token: string): Promise<KeycloakTokenVerification>;

  /**
   * Check if this strategy can handle the token
   */
  canHandle(token: string): boolean;

  /**
   * Get strategy name
   */
  getName(): string;
}

/**
 * Dependency injection container interface for Keycloak middleware
 */
export interface IKeycloakContainer {
  /**
   * Register a service
   */
  register<T>(token: string | symbol, implementation: T): void;

  /**
   * Resolve a service
   */
  resolve<T>(token: string | symbol): T;

  /**
   * Check if service is registered
   */
  isRegistered(token: string | symbol): boolean;
}

/**
 * Keycloak middleware dependencies interface
 */
export interface IKeycloakMiddlewareDependencies {
  keycloakService: IKeycloakService;
  configValidator: IKeycloakConfigValidator;
  container?: IKeycloakContainer;
}

/**
 * Keycloak middleware options with proper dependency injection
 */
export interface IKeycloakMiddlewareOptions {
  config: KeycloakConfig;
  dependencies: IKeycloakMiddlewareDependencies;
  name?: string;
  enabled?: boolean;
  priority?: number;
}
