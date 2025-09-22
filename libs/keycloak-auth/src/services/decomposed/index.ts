/**
 * Decomposed Token Services
 *
 * This module contains the decomposed services from the original TokenIntrospectionService.
 * Each service has a specific responsibility and can be used independently or together.
 */

export {
  TokenIntrospectionClient,
  createTokenIntrospectionClient,
} from "./token-introspection-client";
export type {
  ITokenIntrospectionClient,
  IntrospectionRequest,
  IntrospectionResult,
  DiscoveryDocument,
} from "./token-introspection-client";

export {
  SecureCacheService,
  createSecureCacheService,
} from "./secure-cache.service";

export { PublicKeyService, createPublicKeyService } from "./public-key.service";
export type {
  IPublicKeyService,
  PublicKeyEntry,
  PublicKeyResult,
  PublicKeyServiceConfig,
} from "./public-key.service";

export {
  TokenValidationOrchestrator,
  createTokenValidationOrchestrator,
} from "./token-validation-orchestrator";
export type {
  ITokenValidationOrchestrator,
  JWTValidationContext,
  ValidationStepResult,
  TokenValidationOrchestratorConfig,
} from "./token-validation-orchestrator";

export {
  WebSocketTokenExtractor,
  createWebSocketTokenExtractor,
} from "./websocket-token-extractor.service";
export type {
  IWebSocketTokenExtractor,
  TokenExtractionResult,
  TokenExtractionConfig,
} from "./websocket-token-extractor.service";

// Import types for internal use
import type { ITokenIntrospectionClient } from "./token-introspection-client";
import type { IPublicKeyService } from "./public-key.service";
import type { ITokenValidationOrchestrator } from "./token-validation-orchestrator";
import type { IWebSocketTokenExtractor } from "./websocket-token-extractor.service";

// Import factory functions
import { createTokenIntrospectionClient } from "./token-introspection-client";
import { createPublicKeyService } from "./public-key.service";
import { createTokenValidationOrchestrator } from "./token-validation-orchestrator";
import { createWebSocketTokenExtractor } from "./websocket-token-extractor.service";
import {
  createSecureCacheService,
  type SecureCacheConfig,
  type SecureCacheService,
} from "./secure-cache.service";
import type { IMetricsCollector } from "libs/monitoring/src/MetricsCollector";
import type { KeycloakClientFactory } from "../../client/keycloak-client-factory";

// Shared interfaces and types
export type {
  ServiceHealth,
  ServiceConfig,
  OperationResult,
  CacheOperation,
  MetricsOperationType,
  ErrorSeverity,
  ServiceState,
  IBaseService,
  ValidationResult,
  ServiceInfo,
  ErrorContext,
  PerformanceMetrics,
  ResourceMetrics,
  ServiceMetrics,
  ConfigChangeEvent,
  ServiceEvent,
  ServiceEventType,
  ServiceEventHandler,
  IServiceRegistry,
  CircuitState,
  CircuitBreakerConfig,
  ICircuitBreaker,
  RetryConfig,
  TimeoutConfig,
  ServiceFactory,
  IServiceContainer,
} from "./interfaces";

/**
 * Service Collection
 *
 * Utility class for managing multiple decomposed services together
 */
export class TokenServiceCollection {
  constructor(
    public readonly client: ITokenIntrospectionClient,
    public readonly cache: SecureCacheService,
    public readonly publicKey: IPublicKeyService,
    public readonly orchestrator: ITokenValidationOrchestrator,
    public readonly tokenExtractor: IWebSocketTokenExtractor,
    public readonly metric?: IMetricsCollector
  ) {}

  /**
   * Get health status of services that support it
   */
  public getHealthStatus() {
    return {
      publicKey: this.publicKey.getHealthStatus(),
      orchestrator: this.orchestrator.getHealthStatus(),
      // cache: this.cache.getHealthStatus(), // Not available in ITokenCacheService
    };
  }

  /**
   * Shutdown services that support it
   */
  public async shutdown(): Promise<void> {
    await Promise.all([
      this.publicKey.shutdown(),
      this.orchestrator.shutdown(),
      this.cache.dispose(),
    ]);
  }

  /**
   * Get combined statistics
   */
  public getCombinedStats() {
    return {
      cache: this.cache.getStats(),
      publicKey: this.publicKey.getCacheStats(),
      validation: this.orchestrator.getValidationStats(),
    };
  }
}

/**
 * Factory function to create all decomposed services
 */
export const createDecomposedTokenServices = (
  keycloakClientFactory: KeycloakClientFactory,
  secureCacheConfig: SecureCacheConfig
) => {
  // Create individual services
  const client = createTokenIntrospectionClient(keycloakClientFactory);
  const cache = createSecureCacheService(secureCacheConfig);
  const publicKey = createPublicKeyService(keycloakClientFactory, cache);
  const orchestrator = createTokenValidationOrchestrator(
    keycloakClientFactory,
    cache
  );
  const tokenExtractor = createWebSocketTokenExtractor();

  // Return collection
  return new TokenServiceCollection(
    client,
    cache,
    publicKey,
    orchestrator,
    tokenExtractor
  );
};
