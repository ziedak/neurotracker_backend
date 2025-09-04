import { Logger } from "@libs/monitoring";
import { AuthConfig, MiddlewareContext } from "../../types";
import { AuthResult } from "./types";

/**
 * API Key authentication implementation
 */
export class ApiKeyAuth {
  private readonly config: AuthConfig;
  private readonly logger: ILogger;

  // In production, these would be loaded from environment/database
  private readonly keyPermissions: Record<string, string[]> = {
    "ai-engine-key-prod-2024": ["predict", "batch_predict", "explain", "admin"],
    "ai-engine-key-dev-2024": ["predict", "batch_predict", "explain"],
    "dashboard-service-key": ["predict", "explain", "metrics"],
    "data-intelligence-key": [
      "predict",
      "batch_predict",
      "features",
      "data_export",
    ],
    "event-pipeline-key": ["event_ingest", "event_process"],
    "api-gateway-key": ["*"], // Full access for gateway
  };

  private readonly keyUsers: Record<string, string> = {
    "ai-engine-key-prod-2024": "ai-engine-prod",
    "ai-engine-key-dev-2024": "ai-engine-dev",
    "dashboard-service-key": "dashboard-service",
    "data-intelligence-key": "data-intelligence-service",
    "event-pipeline-key": "event-pipeline-service",
    "api-gateway-key": "api-gateway-service",
  };

  private readonly keyRoles: Record<string, string[]> = {
    "ai-engine-key-prod-2024": ["service", "admin"],
    "ai-engine-key-dev-2024": ["service"],
    "dashboard-service-key": ["service"],
    "data-intelligence-key": ["service", "data_processor"],
    "event-pipeline-key": ["service", "event_processor"],
    "api-gateway-key": ["service", "gateway"],
  };

  constructor(config: AuthConfig, logger: ILogger) {
    this.config = config;
    this.logger = logger.child({ component: "ApiKeyAuth" });
  }

  /**
   * Authenticate using API key
   */
  async authenticate(
    apiKey: string,
    context: MiddlewareContext
  ): Promise<AuthResult> {
    const startTime = performance.now();

    try {
      // Validate API key format
      if (!apiKey || apiKey.length < 10) {
        return {
          authenticated: false,
          error: "Invalid API key format",
        };
      }

      // Check if API key is in allowed set
      const isValid =
        this.config.apiKeys?.has(apiKey) || this.keyPermissions[apiKey];

      if (!isValid) {
        this.logger.warn("Invalid API key attempted", {
          apiKeyPrefix: this.maskApiKey(apiKey),
          clientIp: this.getClientIp(context),
          userAgent: context.request.headers["user-agent"],
        });

        return {
          authenticated: false,
          error: "Invalid API key",
        };
      }

      // Get permissions and user info for this key
      const permissions = this.getApiKeyPermissions(apiKey);
      const userId = this.getApiKeyUserId(apiKey);
      const roles = this.getApiKeyRoles(apiKey);

      const duration = performance.now() - startTime;
      this.logger.debug("API key authentication successful", {
        apiKeyPrefix: this.maskApiKey(apiKey),
        userId,
        permissions: permissions.length,
        roles: roles.length,
        duration: Math.round(duration),
      });

      return {
        authenticated: true,
        user: {
          id: userId,
          roles,
          permissions,
          apiKey: this.maskApiKey(apiKey),
          authMethod: "api_key",
        },
      };
    } catch (error) {
      this.logger.error("API key authentication error", error as Error, {
        apiKeyPrefix: this.maskApiKey(apiKey),
      });

      return {
        authenticated: false,
        error: "API key authentication failed",
      };
    }
  }

  /**
   * Get permissions for an API key
   */
  private getApiKeyPermissions(apiKey: string): string[] {
    return this.keyPermissions[apiKey] || ["basic"];
  }

  /**
   * Get user ID for an API key
   */
  private getApiKeyUserId(apiKey: string): string {
    return this.keyUsers[apiKey] || `api-user-${apiKey.substring(0, 8)}`;
  }

  /**
   * Get roles for an API key
   */
  private getApiKeyRoles(apiKey: string): string[] {
    return this.keyRoles[apiKey] || ["user"];
  }

  /**
   * Mask API key for logging
   */
  private maskApiKey(apiKey: string): string {
    if (!apiKey || apiKey.length <= 8) {
      return "***";
    }
    return `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`;
  }

  /**
   * Extract client IP from context
   */
  private getClientIp(context: MiddlewareContext): string {
    const headers = context.request.headers;
    return (
      headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      headers["x-real-ip"] ||
      headers["cf-connecting-ip"] ||
      context.request.ip ||
      "unknown"
    );
  }

  /**
   * Validate API key exists and is active
   * In production, this would check database/cache
   */
  public async validateKey(apiKey: string): Promise<boolean> {
    return !!(this.config.apiKeys?.has(apiKey) || this.keyPermissions[apiKey]);
  }

  /**
   * Add a new API key (for testing/development)
   */
  public addKey(
    apiKey: string,
    userId: string,
    permissions: string[],
    roles: string[] = ["user"]
  ): void {
    if (this.config.apiKeys) {
      this.config.apiKeys.add(apiKey);
    }
    this.keyPermissions[apiKey] = permissions;
    this.keyUsers[apiKey] = userId;
    this.keyRoles[apiKey] = roles;

    this.logger.info("API key added", {
      apiKeyPrefix: this.maskApiKey(apiKey),
      userId,
      permissions: permissions.length,
      roles: roles.length,
    });
  }

  /**
   * Remove an API key
   */
  public removeKey(apiKey: string): void {
    if (this.config.apiKeys) {
      this.config.apiKeys.delete(apiKey);
    }
    delete this.keyPermissions[apiKey];
    delete this.keyUsers[apiKey];
    delete this.keyRoles[apiKey];

    this.logger.info("API key removed", {
      apiKeyPrefix: this.maskApiKey(apiKey),
    });
  }

  /**
   * Get all registered API keys (masked)
   */
  public getKeys(): string[] {
    const keys = this.config.apiKeys
      ? Array.from(this.config.apiKeys)
      : Object.keys(this.keyPermissions);
    return keys.map((key) => this.maskApiKey(key));
  }
}
