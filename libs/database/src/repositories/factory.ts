/**
 * @fileoverview Repository Factory for Clean Architecture
 * @module database/repositories/factory
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { DatabaseClient } from "../types/DatabaseClient";
import type { IMetricsCollector } from "@libs/monitoring";
import type { ICache } from "../cache";

/**
 * Repository factory configuration
 */
export interface RepositoryFactoryConfig {
  /** Database client instance */
  db: DatabaseClient;
  /** Metrics collector for monitoring */
  metricsCollector?: IMetricsCollector;
  /** Cache service for performance optimization */
  cacheService?: ICache;
  /** Default query timeout in milliseconds */
  defaultTimeout?: number;
  /** Enable caching for read operations */
  enableCaching?: boolean;
  /** Default cache TTL in seconds */
  defaultCacheTTL?: number;
}

/**
 * Repository factory for creating and managing repository instances
 * Provides centralized configuration and dependency injection
 */
export class RepositoryFactory {
  private static instance: RepositoryFactory;
  private readonly config: RepositoryFactoryConfig;
  private readonly repositoryCache = new Map<string, unknown>();

  private constructor(config: RepositoryFactoryConfig) {
    this.config = {
      defaultTimeout: 30000,
      enableCaching: true,
      defaultCacheTTL: 300,
      ...config,
    };
  }

  /**
   * Get singleton instance of repository factory
   */
  static getInstance(config?: RepositoryFactoryConfig): RepositoryFactory {
    if (!RepositoryFactory.instance) {
      if (!config) {
        throw new Error(
          "RepositoryFactory must be initialized with config first"
        );
      }
      RepositoryFactory.instance = new RepositoryFactory(config);
    }
    return RepositoryFactory.instance;
  }

  /**
   * Reset factory instance (mainly for testing)
   */
  static resetInstance(): void {
    RepositoryFactory.instance = undefined as unknown as RepositoryFactory;
  }

  /**
   * Get or create repository instance with caching
   */
  getRepository<T>(
    RepositoryClass: new (config: RepositoryFactoryConfig) => T
  ): T {
    const key = RepositoryClass.name;

    if (this.repositoryCache.has(key)) {
      return this.repositoryCache.get(key) as T;
    }

    const repository = new RepositoryClass(this.config);
    this.repositoryCache.set(key, repository);

    return repository;
  }

  /**
   * Get factory configuration
   */
  getConfig(): Readonly<RepositoryFactoryConfig> {
    return { ...this.config };
  }

  /**
   * Clear repository cache
   */
  clearCache(): void {
    this.repositoryCache.clear();
  }

  /**
   * Get repository cache statistics
   */
  getCacheStats(): { size: number; repositories: string[] } {
    return {
      size: this.repositoryCache.size,
      repositories: Array.from(this.repositoryCache.keys()),
    };
  }
}

/**
 * Helper function to create repository factory with common configuration
 */
export function createRepositoryFactory(
  db: DatabaseClient,
  metricsCollector?: IMetricsCollector,
  cacheService?: ICache
): RepositoryFactory {
  const config: RepositoryFactoryConfig = { db };

  if (metricsCollector) {
    config.metricsCollector = metricsCollector;
  }

  if (cacheService) {
    config.cacheService = cacheService;
  }

  return RepositoryFactory.getInstance(config);
}
