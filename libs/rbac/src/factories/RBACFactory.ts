/**
 * @fileoverview RBAC Service Factory
 * @module rbac/factories
 * @version 1.0.0
 * @description Factory for creating RBAC service instances with various configurations
 */

import { RBACService } from "../services/RBACService";
import type { IRBACService, IRBACFactory } from "../contracts/services";
import type { IRBACConfig } from "../types/core";
import { DEFAULT_RBAC_CONFIG } from "../types/core";

/**
 * RBAC Factory Implementation
 *
 * Provides preset configurations and easy instantiation patterns
 */
export class RBACFactory implements IRBACFactory {
  /**
   * Create default RBAC service instance
   */
  async createDefault(): Promise<IRBACService> {
    return new RBACService(DEFAULT_RBAC_CONFIG);
  }

  /**
   * Create RBAC service with custom configuration
   */
  async create(config: IRBACConfig): Promise<IRBACService> {
    return new RBACService(config);
  }

  /**
   * Create high-performance RBAC service with optimized caching
   */
  async createHighPerformance(): Promise<IRBACService> {
    const config: IRBACConfig = {
      ...DEFAULT_RBAC_CONFIG,
      cache: {
        defaultTtl: 10 * 60 * 1000, // 10 minutes
        permissionCheckTtl: 5 * 60 * 1000, // 5 minutes
        hierarchyTtl: 30 * 60 * 1000, // 30 minutes
        maxSize: 100000, // Larger cache
        cleanupThreshold: 0.9, // Less aggressive cleanup
      },
      maintenance: {
        enabled: true,
        intervalMs: 5 * 60 * 1000, // More frequent maintenance
      },
    };

    return new RBACService(config);
  }

  /**
   * Create security-focused RBAC service with enhanced auditing
   */
  async createSecurityFocused(): Promise<IRBACService> {
    const config: IRBACConfig = {
      ...DEFAULT_RBAC_CONFIG,
      cache: {
        defaultTtl: 2 * 60 * 1000, // 2 minutes - shorter cache
        permissionCheckTtl: 1 * 60 * 1000, // 1 minute
        hierarchyTtl: 5 * 60 * 1000, // 5 minutes
        maxSize: 10000, // Smaller cache
        cleanupThreshold: 0.7, // More aggressive cleanup
      },
      analytics: {
        enabled: true,
        retentionDays: 90, // Longer retention for security auditing
      },
    };

    return new RBACService(config);
  }

  /**
   * Create RBAC service for testing with minimal caching
   */
  async createForTesting(): Promise<IRBACService> {
    const config: IRBACConfig = {
      ...DEFAULT_RBAC_CONFIG,
      cache: {
        defaultTtl: 1000, // 1 second
        permissionCheckTtl: 500, // 500ms
        hierarchyTtl: 2000, // 2 seconds
        maxSize: 100, // Very small cache
        cleanupThreshold: 0.5,
      },
      maintenance: {
        enabled: false, // No background maintenance in tests
        intervalMs: 0,
      },
      analytics: {
        enabled: false, // No analytics in tests
        retentionDays: 1,
      },
    };

    return new RBACService(config);
  }
}

/**
 * Convenience function to create default RBAC service
 */
export const createRBACService = async (
  config?: Partial<IRBACConfig>
): Promise<IRBACService> => {
  const factory = new RBACFactory();

  if (!config) {
    return factory.createDefault();
  }

  const finalConfig: IRBACConfig = {
    ...DEFAULT_RBAC_CONFIG,
    ...config,
    cache: {
      ...DEFAULT_RBAC_CONFIG.cache,
      ...(config.cache || {}),
    },
    permissions: {
      ...DEFAULT_RBAC_CONFIG.permissions,
      ...(config.permissions || {}),
    },
    analytics: {
      ...DEFAULT_RBAC_CONFIG.analytics,
      ...(config.analytics || {}),
    },
    maintenance: {
      ...DEFAULT_RBAC_CONFIG.maintenance,
      ...(config.maintenance || {}),
    },
  };

  return factory.create(finalConfig);
};

/**
 * Preset configurations export for easy access
 */
export const RBACPresets = {
  /**
   * Default balanced configuration
   */
  DEFAULT: DEFAULT_RBAC_CONFIG,

  /**
   * High performance configuration
   */
  HIGH_PERFORMANCE: {
    ...DEFAULT_RBAC_CONFIG,
    cache: {
      defaultTtl: 10 * 60 * 1000,
      permissionCheckTtl: 5 * 60 * 1000,
      hierarchyTtl: 30 * 60 * 1000,
      maxSize: 100000,
      cleanupThreshold: 0.9,
    },
  } as IRBACConfig,

  /**
   * Security focused configuration
   */
  SECURITY_FOCUSED: {
    ...DEFAULT_RBAC_CONFIG,
    cache: {
      defaultTtl: 2 * 60 * 1000,
      permissionCheckTtl: 1 * 60 * 1000,
      hierarchyTtl: 5 * 60 * 1000,
      maxSize: 10000,
      cleanupThreshold: 0.7,
    },
    analytics: {
      enabled: true,
      retentionDays: 90,
    },
  } as IRBACConfig,

  /**
   * Testing configuration
   */
  TESTING: {
    ...DEFAULT_RBAC_CONFIG,
    cache: {
      defaultTtl: 1000,
      permissionCheckTtl: 500,
      hierarchyTtl: 2000,
      maxSize: 100,
      cleanupThreshold: 0.5,
    },
    maintenance: {
      enabled: false,
      intervalMs: 0,
    },
    analytics: {
      enabled: false,
      retentionDays: 1,
    },
  } as IRBACConfig,
} as const;
