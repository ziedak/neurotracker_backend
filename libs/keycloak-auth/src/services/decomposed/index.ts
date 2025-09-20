/**
 * Decomposed Token Services
 *
 * This module contains the decomposed services from the original TokenIntrospectionService.
 * Each service has a specific responsibility and can be used independently or together.
 */

// Core services
export {
  TokenMetricsService,
  createTokenMetricsService,
} from "./token-metrics.service";
export type {
  ITokenMetricsService,
  TokenMetricsData,
  TokenMetricsStats,
  MetricsOperation,
} from "./token-metrics.service";

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
  TokenCacheService,
  createTokenCacheService,
} from "./token-cache.service";
export type {
  ITokenCacheService,
  CacheEntry,
  CacheResult,
  CacheStats,
  TokenCacheConfig,
} from "./token-cache.service";

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
import type { ITokenMetricsService } from "./token-metrics.service";
import type { ITokenIntrospectionClient } from "./token-introspection-client";
import type { ITokenCacheService } from "./token-cache.service";
import type { IPublicKeyService } from "./public-key.service";
import type { ITokenValidationOrchestrator } from "./token-validation-orchestrator";
import type { IWebSocketTokenExtractor } from "./websocket-token-extractor.service";

// Import factory functions
import { createTokenMetricsService } from "./token-metrics.service";
import { createTokenIntrospectionClient } from "./token-introspection-client";
import { createTokenCacheService } from "./token-cache.service";
import { createPublicKeyService } from "./public-key.service";
import { createTokenValidationOrchestrator } from "./token-validation-orchestrator";
import { createWebSocketTokenExtractor } from "./websocket-token-extractor.service";

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
    public readonly metrics: ITokenMetricsService,
    public readonly client: ITokenIntrospectionClient,
    public readonly cache: ITokenCacheService,
    public readonly publicKey: IPublicKeyService,
    public readonly orchestrator: ITokenValidationOrchestrator,
    public readonly tokenExtractor: IWebSocketTokenExtractor
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
      this.cache.clear(),
    ]);
  }

  /**
   * Get combined statistics
   */
  public getCombinedStats() {
    return {
      metrics: this.metrics.getStats(),
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
  keycloakClientFactory: any,
  cacheService: any
) => {
  // Create individual services
  const metrics = createTokenMetricsService();
  const client = createTokenIntrospectionClient(keycloakClientFactory);
  const cache = createTokenCacheService(cacheService);
  const publicKey = createPublicKeyService(keycloakClientFactory, cacheService);
  const orchestrator = createTokenValidationOrchestrator(
    keycloakClientFactory,
    cache
  );
  const tokenExtractor = createWebSocketTokenExtractor();

  // Return collection
  return new TokenServiceCollection(
    metrics,
    client,
    cache,
    publicKey,
    orchestrator,
    tokenExtractor
  );
};
