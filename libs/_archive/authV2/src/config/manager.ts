/**
 * @fileoverview Enterprise configuration management for authV2
 * @module config/manager
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import { AuthConfigSchema } from "./schema";
import {
  DEFAULT_CONFIG,
  type IAuthConfig,
  type IConfigValidationResult,
} from "./types";
import { ConfigurationError } from "../errors/core";

/**
 * Configuration loading strategies
 */
export interface IConfigLoader {
  load(): Promise<Record<string, unknown>>;
  watch?(callback: (config: Record<string, unknown>) => void): void;
}

/**
 * Environment variable configuration loader
 */
export class EnvironmentConfigLoader implements IConfigLoader {
  public async load(): Promise<Record<string, unknown>> {
    return {
      jwt: {
        secret: process.env["JWT_SECRET"],
        accessTokenExpiry: process.env["JWT_ACCESS_TOKEN_EXPIRY"],
        refreshTokenExpiry: process.env["JWT_REFRESH_TOKEN_EXPIRY"],
        algorithm: process.env["JWT_ALGORITHM"],
        issuer: process.env["JWT_ISSUER"],
        audience: process.env["JWT_AUDIENCE"],
      },
      session: {
        defaultExpiry: process.env["SESSION_DEFAULT_EXPIRY"]
          ? parseInt(process.env["SESSION_DEFAULT_EXPIRY"])
          : undefined,
        maxConcurrentSessions: process.env["SESSION_MAX_CONCURRENT"]
          ? parseInt(process.env["SESSION_MAX_CONCURRENT"])
          : undefined,
        cleanupInterval: process.env["SESSION_CLEANUP_INTERVAL"]
          ? parseInt(process.env["SESSION_CLEANUP_INTERVAL"])
          : undefined,
        extendOnActivity: process.env["SESSION_EXTEND_ON_ACTIVITY"] === "true",
        cookieName: process.env["SESSION_COOKIE_NAME"],
        cookieOptions: {
          httpOnly: process.env["SESSION_HTTP_ONLY"] === "true",
          secure: process.env["SESSION_SECURE"] === "true",
          sameSite: process.env["SESSION_SAME_SITE"] as
            | "strict"
            | "lax"
            | "none",
          domain: process.env["SESSION_DOMAIN"],
          path: process.env["SESSION_PATH"],
        },
      },
      cache: {
        redis: {
          host: process.env["REDIS_HOST"],
          port: process.env["REDIS_PORT"]
            ? parseInt(process.env["REDIS_PORT"])
            : undefined,
          password: process.env["REDIS_PASSWORD"],
          db: process.env["REDIS_DB"]
            ? parseInt(process.env["REDIS_DB"])
            : undefined,
          keyPrefix: process.env["REDIS_KEY_PREFIX"],
        },
      },
      database: {
        connectionString: process.env["DATABASE_URL"],
        pool: {
          min: process.env["DB_POOL_MIN"]
            ? parseInt(process.env["DB_POOL_MIN"])
            : undefined,
          max: process.env["DB_POOL_MAX"]
            ? parseInt(process.env["DB_POOL_MAX"])
            : undefined,
        },
      },
      environment: process.env["NODE_ENV"],
      debug: process.env["DEBUG"] === "true",
    };
  }
}

/**
 * File-based configuration loader
 */
export class FileConfigLoader implements IConfigLoader {
  constructor(private readonly filePath: string) {}

  public async load(): Promise<Record<string, unknown>> {
    try {
      const fs = await import("fs/promises");
      const path = await import("path");

      const fullPath = path.resolve(this.filePath);
      const fileContent = await fs.readFile(fullPath, "utf-8");

      if (this.filePath.endsWith(".json")) {
        return JSON.parse(fileContent);
      }

      if (this.filePath.endsWith(".js") || this.filePath.endsWith(".ts")) {
        // Dynamic import for JS/TS config files
        const module = await import(fullPath);
        return module.default || module;
      }

      throw new ConfigurationError(`Unsupported file type: ${this.filePath}`);
    } catch (error) {
      throw new ConfigurationError(
        `Failed to load configuration file: ${this.filePath}`,
        {
          originalError: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  public watch(_callback: (config: Record<string, unknown>) => void): void {
    // File watching implementation would go here
    // Using fs.watchFile or chokidar for better file watching
    console.log(`Watching ${this.filePath} for changes...`);
    // Implementation placeholder
  }
}

/**
 * Configuration manager with validation and hot reloading
 */
export class AuthConfigManager {
  private config: IAuthConfig | null = null;
  private readonly loaders: IConfigLoader[] = [];
  private readonly watchers: Array<(config: IAuthConfig) => void> = [];
  private isInitialized = false;

  /**
   * Add a configuration loader
   */
  public addLoader(loader: IConfigLoader): void {
    this.loaders.push(loader);
  }

  /**
   * Initialize configuration from all loaders
   */
  public async initialize(): Promise<IAuthConfig> {
    try {
      // Start with default configuration
      let mergedConfig: Record<string, unknown> =
        structuredClone(DEFAULT_CONFIG);

      // Load and merge configuration from all loaders
      for (const loader of this.loaders) {
        try {
          const loaderConfig = await loader.load();
          mergedConfig = this.deepMerge(mergedConfig, loaderConfig);
        } catch (error) {
          console.warn("Configuration loader failed:", error);
          // Continue with other loaders
        }
      }

      // Validate the merged configuration
      const validationResult = this.validate(mergedConfig);
      if (!validationResult.success || !validationResult.config) {
        throw new ConfigurationError("Configuration validation failed", {
          errors: validationResult.errors,
        });
      }

      this.config = validationResult.config;
      this.isInitialized = true;

      // Set up watchers for hot reloading
      this.setupWatchers();

      return this.config;
    } catch (error) {
      throw new ConfigurationError("Failed to initialize configuration", {
        originalError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get current configuration
   */
  public getConfig(): IAuthConfig {
    if (!this.isInitialized || !this.config) {
      throw new ConfigurationError("Configuration not initialized");
    }
    return this.config;
  }

  /**
   * Watch for configuration changes
   */
  public onChange(callback: (config: IAuthConfig) => void): void {
    this.watchers.push(callback);
  }

  /**
   * Reload configuration
   */
  public async reload(): Promise<IAuthConfig> {
    const newConfig = await this.initialize();

    // Notify watchers
    for (const callback of this.watchers) {
      try {
        callback(newConfig);
      } catch (error) {
        console.error("Configuration change callback failed:", error);
      }
    }

    return newConfig;
  }

  /**
   * Validate configuration against schema
   */
  public validate(config: unknown): IConfigValidationResult {
    try {
      const validatedConfig = AuthConfigSchema.parse(config);
      return {
        success: true,
        config: validatedConfig,
      };
    } catch (error) {
      if (error instanceof Error && "issues" in error) {
        const zodError = error as any;
        const errors = zodError.issues.map((issue: any) => ({
          path: issue.path,
          message: issue.message,
          code: issue.code,
          received: issue.received,
          expected: issue.expected,
        }));

        return {
          success: false,
          errors,
        };
      }

      return {
        success: false,
        errors: [
          {
            path: [],
            message: error instanceof Error ? error.message : String(error),
            code: "VALIDATION_ERROR",
          },
        ],
      };
    }
  }

  /**
   * Get configuration summary for debugging
   */
  public getSummary(): Record<string, unknown> {
    const config = this.getConfig();

    return {
      environment: config.environment,
      debug: config.debug,
      jwtAlgorithm: config.jwt.algorithm,
      sessionExpiry: config.session.defaultExpiry,
      cacheEnabled: config.cache.redis.host !== undefined,
      monitoringEnabled: config.monitoring.metrics.enabled,
      loadersCount: this.loaders.length,
      watchersCount: this.watchers.length,
      initialized: this.isInitialized,
    };
  }

  /**
   * Check if configuration is valid
   */
  public isValid(): boolean {
    try {
      this.getConfig();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Deep merge configuration objects
   */
  private deepMerge(
    target: Record<string, unknown>,
    source: Record<string, unknown>
  ): Record<string, unknown> {
    const result = { ...target };

    for (const [key, value] of Object.entries(source)) {
      if (value === undefined || value === null) {
        continue;
      }

      if (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        key in result &&
        typeof result[key] === "object" &&
        result[key] !== null &&
        !Array.isArray(result[key])
      ) {
        result[key] = this.deepMerge(
          result[key] as Record<string, unknown>,
          value as Record<string, unknown>
        );
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Setup configuration watchers for hot reloading
   */
  private setupWatchers(): void {
    for (const loader of this.loaders) {
      if (loader.watch) {
        loader.watch(async () => {
          try {
            await this.reload();
          } catch (error) {
            console.error("Configuration reload failed:", error);
          }
        });
      }
    }
  }
}

/**
 * Global configuration manager instance
 */
let globalConfigManager: AuthConfigManager | null = null;

/**
 * Get or create global configuration manager
 */
export function getConfigManager(): AuthConfigManager {
  if (!globalConfigManager) {
    globalConfigManager = new AuthConfigManager();

    // Add default loaders
    globalConfigManager.addLoader(new EnvironmentConfigLoader());

    // Add file loader if config file exists
    const configPaths = [
      "auth.config.js",
      "auth.config.json",
      "config/auth.js",
      "config/auth.json",
    ];

    for (const configPath of configPaths) {
      try {
        const fs = require("fs");
        if (fs.existsSync(configPath)) {
          globalConfigManager.addLoader(new FileConfigLoader(configPath));
          break;
        }
      } catch {
        // File doesn't exist, continue
      }
    }
  }

  return globalConfigManager;
}

/**
 * Initialize global configuration
 */
export async function initializeConfig(): Promise<IAuthConfig> {
  const manager = getConfigManager();
  return await manager.initialize();
}

/**
 * Get global configuration
 */
export function getConfig(): IAuthConfig {
  const manager = getConfigManager();
  return manager.getConfig();
}

/**
 * Configuration utilities
 */
export const ConfigUtils = {
  /**
   * Check if running in production
   */
  isProduction(config?: IAuthConfig): boolean {
    const cfg = config || getConfig();
    return cfg.environment === "production";
  },

  /**
   * Check if running in development
   */
  isDevelopment(config?: IAuthConfig): boolean {
    const cfg = config || getConfig();
    return cfg.environment === "development";
  },

  /**
   * Check if debugging is enabled
   */
  isDebugEnabled(config?: IAuthConfig): boolean {
    const cfg = config || getConfig();
    return cfg.debug;
  },

  /**
   * Get database connection string with fallback
   */
  getDatabaseUrl(config?: IAuthConfig): string {
    const cfg = config || getConfig();
    return cfg.database.connectionString;
  },

  /**
   * Get Redis connection info
   */
  getRedisConfig(config?: IAuthConfig) {
    const cfg = config || getConfig();
    return cfg.cache.redis;
  },

  /**
   * Validate required secrets are set
   */
  validateSecrets(config?: IAuthConfig): void {
    const cfg = config || getConfig();

    if (this.isProduction(cfg)) {
      const defaultSecrets = [
        "your-secret-key-change-in-production-minimum-32-chars-required",
      ];

      if (defaultSecrets.includes(cfg.jwt.secret)) {
        throw new ConfigurationError(
          "Default JWT secret detected in production environment"
        );
      }
    }
  },
} as const;
