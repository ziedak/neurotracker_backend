/**
 * Keycloak Configuration Management
 *
 * Centralized configuration management with validation, environment-specific settings,
 * and runtime configuration updates for production-ready deployments.
 */

import { z } from "@libs/utils";
import { type ILogger } from "@libs/monitoring";
import { KeycloakConfig, KeycloakError, KeycloakErrorType } from "./types";
import { getArrayEnv, getBooleanEnv, getEnv, getNumberEnv } from "@libs/config";

/**
 * Zod schema for Keycloak configuration validation
 */
const KeycloakConfigSchema = z
  .object({
    serverUrl: z.string().url("Invalid Keycloak server URL"),
    realm: z.string().min(1, "Realm is required"),
    clientId: z.string().min(1, "Client ID is required"),
    clientSecret: z.string().optional(),
    publicKey: z.string().optional(),
    jwksUri: z.string().url().optional(),
    rolesClaim: z.string().default("realm_access.roles"),
    usernameClaim: z.string().default("preferred_username"),
    emailClaim: z.string().default("email"),
    groupsClaim: z.string().default("groups"),
    skipPaths: z.array(z.string()).default([]),
    requireAuth: z.boolean().default(true),
    cacheTTL: z.number().min(60).max(3600).default(300), // 1 minute to 1 hour
    enableUserInfoEndpoint: z.boolean().default(false),
    verifyTokenLocally: z.boolean().default(true),
    connectTimeout: z.number().min(1000).max(30000).default(5000), // 1-30 seconds
    readTimeout: z.number().min(1000).max(30000).default(5000),
    maxRetries: z.number().min(0).max(10).default(3),
    retryDelay: z.number().min(100).max(10000).default(1000), // 100ms to 10s
    circuitBreakerThreshold: z.number().min(1).max(100).default(5),
    circuitBreakerResetTimeout: z.number().min(1000).max(300000).default(30000), // 1s to 5min
    enableMetrics: z.boolean().default(true),
    logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
    trustedProxies: z.array(z.string()).default([]),
    corsOrigins: z.array(z.string()).default([]),
  })
  .strict();

/**
 * Environment-specific configuration presets
 */
export const ENVIRONMENT_PRESETS = {
  development: {
    cacheTTL: 60,
    verifyTokenLocally: false, // Use remote verification in dev for testing
    connectTimeout: 10000,
    readTimeout: 10000,
    maxRetries: 1,
    enableMetrics: true,
    logLevel: "debug" as const,
  },
  staging: {
    cacheTTL: 180,
    verifyTokenLocally: true,
    connectTimeout: 8000,
    readTimeout: 8000,
    maxRetries: 2,
    enableMetrics: true,
    logLevel: "info" as const,
  },
  production: {
    cacheTTL: 300,
    verifyTokenLocally: true,
    connectTimeout: 5000,
    readTimeout: 5000,
    maxRetries: 3,
    enableMetrics: true,
    logLevel: "warn" as const,
    circuitBreakerThreshold: 3,
    circuitBreakerResetTimeout: 60000,
  },
} as const;

/**
 * Keycloak Configuration Manager
 */
export class KeycloakConfigManager {
  private readonly logger: ILogger;
  private config: KeycloakConfig | null = null;
  private readonly environment: keyof typeof ENVIRONMENT_PRESETS;
  private readonly configWatchers: Set<(config: KeycloakConfig) => void> =
    new Set();

  constructor(
    environment: keyof typeof ENVIRONMENT_PRESETS = "production",
    logger: ILogger
  ) {
    this.environment = environment;
    this.logger = logger?.child({ service: "KeycloakConfigManager" });
  }

  /**
   * Load and validate configuration from multiple sources
   */
  async loadConfig(
    baseConfig: Partial<KeycloakConfig>,
    overrides?: Partial<KeycloakConfig>
  ): Promise<KeycloakConfig> {
    try {
      // Merge base config with environment preset
      const envPreset = ENVIRONMENT_PRESETS[this.environment];
      const mergedConfig = {
        ...baseConfig,
        ...envPreset,
        ...overrides,
      };

      // Load from environment variables
      const envConfig = this.loadFromEnvironment();
      const finalConfig = {
        ...mergedConfig,
        ...envConfig,
      };

      // Validate configuration
      const validatedConfig = await this.validateConfig(finalConfig);

      // Enhance configuration with computed values
      const enhancedConfig = this.enhanceConfig(validatedConfig);

      this.config = enhancedConfig;
      this.logger.info("Keycloak configuration loaded successfully", {
        environment: this.environment,
        serverUrl: enhancedConfig.serverUrl,
        realm: enhancedConfig.realm,
        verifyTokenLocally: enhancedConfig.verifyTokenLocally,
        cacheTTL: enhancedConfig.cacheTTL,
      });

      // Notify watchers
      this.notifyWatchers(enhancedConfig);

      return enhancedConfig;
    } catch (error) {
      const configError = new KeycloakError(
        `Configuration loading failed: ${(error as Error).message}`,
        KeycloakErrorType.CONFIGURATION_ERROR
      );
      this.logger.error("Failed to load Keycloak configuration", configError);
      throw configError;
    }
  }

  /**
   * Load configuration from environment variables
   */
  private loadFromEnvironment(): Partial<KeycloakConfig> {
    const config: Partial<KeycloakConfig> = {};

    config.serverUrl = getEnv("KEYCLOAK_SERVER_URL", "http://localhost:8000");
    config.realm = getEnv("KEYCLOAK_REALM");
    config.clientId = getEnv("KEYCLOAK_CLIENT_ID");

    config.clientSecret = getEnv("KEYCLOAK_CLIENT_SECRET");
    config.publicKey = getEnv("KEYCLOAK_PUBLIC_KEY");
    config.jwksUri = getEnv("KEYCLOAK_JWKS_URI");

    config.requireAuth = getBooleanEnv("KEYCLOAK_REQUIRE_AUTH");

    config.verifyTokenLocally = getBooleanEnv("KEYCLOAK_VERIFY_LOCALLY");

    config.cacheTTL = getNumberEnv("KEYCLOAK_CACHE_TTL", 10);

    config.connectTimeout = getNumberEnv("KEYCLOAK_CONNECT_TIMEOUT", 10000);
    ["debug", "info", "warn", "error"].includes(getEnv("KEYCLOAK_LOG_LEVEL"));
    config.logLevel = getEnv("KEYCLOAK_LOG_LEVEL") as
      | "debug"
      | "info"
      | "warn"
      | "error";

    config.trustedProxies = getArrayEnv("KEYCLOAK_TRUSTED_PROXIES");

    config.corsOrigins = getArrayEnv("KEYCLOAK_CORS_ORIGINS");

    return config;
  }

  /**
   * Validate configuration using Zod schema
   */
  private async validateConfig(
    config: Partial<KeycloakConfig>
  ): Promise<KeycloakConfig> {
    try {
      return KeycloakConfigSchema.parse(config);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessages = error.errors
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join("; ");
        throw new KeycloakError(
          `Configuration validation failed: ${errorMessages}`,
          KeycloakErrorType.CONFIGURATION_ERROR
        );
      }
      throw error;
    }
  }

  /**
   * Enhance configuration with computed values
   */
  private enhanceConfig(config: KeycloakConfig): KeycloakConfig {
    const enhanced = { ...config };

    // Set JWKS URI if not provided
    if (!enhanced.jwksUri) {
      enhanced.jwksUri = `${enhanced.serverUrl}/realms/${enhanced.realm}/protocol/openid_connect/certs`;
    }

    // Normalize server URL (remove trailing slash)
    enhanced.serverUrl = enhanced.serverUrl.replace(/\/$/, "");

    return enhanced;
  }

  /**
   * Get current configuration
   */
  getConfig(): KeycloakConfig {
    if (!this.config) {
      throw new KeycloakError(
        "Configuration not loaded. Call loadConfig() first.",
        KeycloakErrorType.CONFIGURATION_ERROR
      );
    }
    return this.config;
  }

  /**
   * Update configuration at runtime
   */
  async updateConfig(
    updates: Partial<KeycloakConfig>
  ): Promise<KeycloakConfig> {
    if (!this.config) {
      throw new KeycloakError(
        "Cannot update configuration before initial load",
        KeycloakErrorType.CONFIGURATION_ERROR
      );
    }

    const updatedConfig = {
      ...this.config,
      ...updates,
    };

    // Re-validate the updated configuration
    const validatedConfig = await this.validateConfig(updatedConfig);
    const enhancedConfig = this.enhanceConfig(validatedConfig);

    this.config = enhancedConfig;
    this.logger.info("Keycloak configuration updated", {
      updates: Object.keys(updates),
    });

    // Notify watchers
    this.notifyWatchers(enhancedConfig);

    return enhancedConfig;
  }

  /**
   * Register a configuration change watcher
   */
  onConfigChange(callback: (config: KeycloakConfig) => void): () => void {
    this.configWatchers.add(callback);

    // Return unsubscribe function
    return () => {
      this.configWatchers.delete(callback);
    };
  }

  /**
   * Notify all configuration watchers
   */
  private notifyWatchers(config: KeycloakConfig): void {
    for (const watcher of this.configWatchers) {
      try {
        watcher(config);
      } catch (error) {
        this.logger.error("Configuration watcher error", error as Error);
      }
    }
  }

  /**
   * Validate connection to Keycloak server
   */
  async validateConnection(): Promise<boolean> {
    if (!this.config) {
      throw new KeycloakError(
        "Configuration not loaded",
        KeycloakErrorType.CONFIGURATION_ERROR
      );
    }

    try {
      const response = await fetch(this.config.jwksUri!, {
        method: "HEAD",
        signal: AbortSignal.timeout(this.config.connectTimeout!),
      });

      const isValid = response.ok;
      this.logger.info("Keycloak connection validation", {
        success: isValid,
        status: response.status,
        url: this.config.jwksUri,
      });

      return isValid;
    } catch (error) {
      this.logger.error(
        "Keycloak connection validation failed",
        error as Error
      );
      return false;
    }
  }

  /**
   * Get configuration summary for monitoring/debugging
   */
  getConfigSummary(): Record<string, any> {
    if (!this.config) {
      return { status: "not_loaded" };
    }

    return {
      status: "loaded",
      environment: this.environment,
      serverUrl: this.config.serverUrl,
      realm: this.config.realm,
      requireAuth: this.config.requireAuth,
      verifyTokenLocally: this.config.verifyTokenLocally,
      cacheTTL: this.config.cacheTTL,
      enableMetrics: this.config.enableMetrics,
      logLevel: this.config.logLevel,
      trustedProxiesCount: this.config.trustedProxies?.length || 0,
      corsOriginsCount: this.config.corsOrigins?.length || 0,
    };
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.configWatchers.clear();
    this.config = null;
    this.logger.info("Keycloak configuration manager destroyed");
  }
}

/**
 * Global configuration manager instance
 */
let globalConfigManager: KeycloakConfigManager | null = null;

/**
 * Get or create global configuration manager
 */
export function getKeycloakConfigManager(
  logger: ILogger,
  environment?: keyof typeof ENVIRONMENT_PRESETS
): KeycloakConfigManager {
  if (!globalConfigManager) {
    globalConfigManager = new KeycloakConfigManager(environment, logger);
  }
  return globalConfigManager;
}

/**
 * Reset global configuration manager (mainly for testing)
 */
export function resetKeycloakConfigManager(): void {
  if (globalConfigManager) {
    globalConfigManager.destroy();
    globalConfigManager = null;
  }
}
