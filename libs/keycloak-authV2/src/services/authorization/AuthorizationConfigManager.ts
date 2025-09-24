/**
 * Authorization service configuration and validation
 */

/**
 * Configuration for the Authorization Service
 */
export interface AuthorizationServiceConfig {
  enableAuditLog?: boolean;
  enableMetrics?: boolean;
  cachePermissionResults?: boolean;
  permissionCacheTtl?: number;
  strictMode?: boolean;
}

/**
 * Configuration manager with validation and normalization
 */
export class AuthorizationConfigManager {
  private readonly config: Required<AuthorizationServiceConfig>;

  constructor(config: AuthorizationServiceConfig = {}) {
    this.validateConfiguration(config);
    this.config = this.normalizeConfiguration(config);
  }

  /**
   * Validate configuration parameters with bounds checking
   */
  private validateConfiguration(config: AuthorizationServiceConfig): void {
    if (config.permissionCacheTtl !== undefined) {
      if (
        typeof config.permissionCacheTtl !== "number" ||
        isNaN(config.permissionCacheTtl) ||
        config.permissionCacheTtl < 0
      ) {
        throw new Error("permissionCacheTtl must be a non-negative number");
      }
      if (config.permissionCacheTtl > 86400) {
        // 24 hours max
        throw new Error(
          "permissionCacheTtl cannot exceed 86400 seconds (24 hours)"
        );
      }
    }

    // Validate boolean configurations
    const booleanFields: (keyof AuthorizationServiceConfig)[] = [
      "enableAuditLog",
      "enableMetrics",
      "cachePermissionResults",
      "strictMode",
    ];

    for (const field of booleanFields) {
      if (config[field] !== undefined && typeof config[field] !== "boolean") {
        throw new Error(`${field} must be a boolean value`);
      }
    }
  }

  /**
   * Normalize configuration with bounds checking
   */
  private normalizeConfiguration(
    config: AuthorizationServiceConfig
  ): Required<AuthorizationServiceConfig> {
    return {
      enableAuditLog: config.enableAuditLog ?? true,
      enableMetrics: config.enableMetrics ?? true,
      cachePermissionResults: config.cachePermissionResults ?? true,
      permissionCacheTtl: Math.min(
        Math.max(config.permissionCacheTtl ?? 300, 60),
        3600
      ), // 1min - 1hour
      strictMode: config.strictMode ?? true,
    };
  }

  getConfig(): Required<AuthorizationServiceConfig> {
    return this.config;
  }

  isAuditEnabled(): boolean {
    return this.config.enableAuditLog;
  }

  isMetricsEnabled(): boolean {
    return this.config.enableMetrics;
  }

  isCacheEnabled(): boolean {
    return this.config.cachePermissionResults;
  }

  getCacheTtl(): number {
    return this.config.permissionCacheTtl;
  }

  isStrictMode(): boolean {
    return this.config.strictMode;
  }
}
