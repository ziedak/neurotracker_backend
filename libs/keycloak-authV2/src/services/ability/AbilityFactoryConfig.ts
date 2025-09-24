/**
 * Configuration management for AbilityFactory
 * Handles validation, normalization, and constants management
 */

export interface AbilityFactoryConfig {
  readonly enableCaching?: boolean;
  readonly cacheTimeout?: number;
  readonly defaultRole?: string;
  readonly strictMode?: boolean;
  readonly auditEnabled?: boolean;
}

/**
 * Configuration constants to replace magic numbers
 */
export interface AbilityFactoryConstants {
  readonly CLEANUP_INTERVAL_MS: number;
  readonly STALE_COMPUTATION_THRESHOLD_MS: number;
  readonly MAX_PENDING_COMPUTATIONS: number;
  readonly MAX_TEMPLATE_DEPTH: number;
  readonly CACHE_ROTATION_INTERVAL_MS: number;
  readonly MIN_CACHE_TIMEOUT_MS: number;
  readonly MAX_CACHE_TIMEOUT_MS: number;
}

export const DEFAULT_CONSTANTS: AbilityFactoryConstants = {
  CLEANUP_INTERVAL_MS: 5 * 60 * 1000,
  STALE_COMPUTATION_THRESHOLD_MS: 30_000,
  MAX_PENDING_COMPUTATIONS: 100,
  MAX_TEMPLATE_DEPTH: 5,
  CACHE_ROTATION_INTERVAL_MS: 5 * 60 * 1000,
  MIN_CACHE_TIMEOUT_MS: 60_000,
  MAX_CACHE_TIMEOUT_MS: 3_600_000,
};

/**
 * Configuration manager with validation and normalization
 */
export class AbilityConfigManager {
  private readonly config: Required<AbilityFactoryConfig>;

  constructor(
    config: AbilityFactoryConfig = {},
    private readonly constants: AbilityFactoryConstants = DEFAULT_CONSTANTS
  ) {
    this.config = this.validateAndNormalizeConfig(config);
  }

  private validateAndNormalizeConfig(
    config: AbilityFactoryConfig
  ): Required<AbilityFactoryConfig> {
    return {
      enableCaching: config.enableCaching ?? true,
      cacheTimeout: Math.min(
        Math.max(
          config.cacheTimeout ?? 300_000,
          this.constants.MIN_CACHE_TIMEOUT_MS
        ),
        this.constants.MAX_CACHE_TIMEOUT_MS
      ),
      defaultRole: config.defaultRole ?? "guest",
      strictMode: config.strictMode ?? true,
      auditEnabled: config.auditEnabled ?? true,
    };
  }

  getConfig(): Required<AbilityFactoryConfig> {
    return this.config;
  }

  getConstants(): AbilityFactoryConstants {
    return this.constants;
  }

  isCachingEnabled(): boolean {
    return this.config.enableCaching;
  }

  getCacheTimeout(): number {
    return this.config.cacheTimeout;
  }

  getDefaultRole(): string {
    return this.config.defaultRole;
  }

  isStrictMode(): boolean {
    return this.config.strictMode;
  }

  isAuditEnabled(): boolean {
    return this.config.auditEnabled;
  }
}
