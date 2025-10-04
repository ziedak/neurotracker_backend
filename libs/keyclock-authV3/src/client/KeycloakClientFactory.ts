/**
 * Keycloak Client Factory
 * Manages multiple Keycloak client configurations and provides client instances
 */

import { createLogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import {
  KeycloakClient,
  type KeycloakRealmConfig,
  type KeycloakClientOptions,
} from "./KeycloakClient";

/**
 * Multi-client configuration for different service types
 */
export interface KeycloakMultiClientConfig {
  realms: {
    [key: string]: KeycloakRealmConfig;
  };
  defaultOptions?: Partial<KeycloakClientOptions>;
}

/**
 * Client type identifiers
 */
export type ClientType =
  | "frontend" // Public client for frontend applications
  | "service" // Confidential client for backend services
  | "websocket" // Client for WebSocket connections
  | "admin" // Admin client for user management
  | "tracker"; // Limited client for tracking/analytics

/**
 * Environment configuration mapping
 */
export interface KeycloakEnvironmentConfig {
  KEYCLOAK_SERVER_URL: string;
  KEYCLOAK_REALM: string;

  // Frontend client (public)
  KEYCLOAK_FRONTEND_CLIENT_ID: string;

  // Service client (confidential)
  KEYCLOAK_SERVICE_CLIENT_ID: string;
  KEYCLOAK_SERVICE_CLIENT_SECRET: string;

  // WebSocket client
  KEYCLOAK_WEBSOCKET_CLIENT_ID: string;
  KEYCLOAK_WEBSOCKET_CLIENT_SECRET: string | undefined;

  // Admin client (for user management)
  KEYCLOAK_ADMIN_CLIENT_ID: string;
  KEYCLOAK_ADMIN_CLIENT_SECRET: string;

  // Tracker client (limited scope)
  KEYCLOAK_TRACKER_CLIENT_ID: string;
  KEYCLOAK_TRACKER_CLIENT_SECRET: string | undefined;

  // Redirect URIs
  FRONTEND_URL: string | undefined;
  API_BASE_URL: string | undefined;
}

export class KeycloakClientFactory {
  private readonly logger = createLogger("KeycloakClientFactory");
  private readonly clients = new Map<string, KeycloakClient>();
  private readonly config: KeycloakMultiClientConfig;
  private initialized = false;

  constructor(
    envConfig: KeycloakEnvironmentConfig,
    private readonly metrics?: IMetricsCollector
  ) {
    this.config = this.buildMultiClientConfig(envConfig);
  }

  /**
   * Initialize all configured clients
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.debug("Client factory already initialized");
      return;
    }

    const startTime = performance.now();

    try {
      this.logger.info("Initializing Keycloak client factory", {
        realmCount: Object.keys(this.config.realms).length,
      });

      // Initialize all clients in parallel with partial success handling
      const initPromises = Object.entries(this.config.realms).map(
        async ([clientType, realmConfig]) => {
          try {
            const clientOptions: KeycloakClientOptions = {
              realm: realmConfig,
              ...this.config.defaultOptions,
            };

            const client = new KeycloakClient(clientOptions, this.metrics);

            await client.initialize();
            this.clients.set(clientType, client);

            this.logger.debug("Client initialized", { clientType });
            return { clientType, success: true, error: null };
          } catch (error) {
            this.logger.error("Failed to initialize client", {
              clientType,
              error,
            });
            return {
              clientType,
              success: false,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        }
      );

      const results = await Promise.all(initPromises);

      // Check initialization results
      const failedClients = results.filter((result) => !result.success);
      const successfulClients = results.filter((result) => result.success);

      if (failedClients.length > 0) {
        this.logger.warn("Some clients failed to initialize", {
          failedClients: failedClients.map((f) => ({
            type: f.clientType,
            error: f.error,
          })),
          successfulClients: successfulClients.map((s) => s.clientType),
        });

        // If all clients failed, throw error
        if (successfulClients.length === 0) {
          throw new Error(
            `All clients failed to initialize: ${failedClients
              .map((f) => f.error)
              .join(", ")}`
          );
        }

        // Record partial initialization metrics
        this.metrics?.recordCounter(
          "keycloak.factory.partial_initialization",
          1
        );
      }

      this.initialized = true;

      this.metrics?.recordTimer(
        "keycloak.factory.initialization_duration",
        performance.now() - startTime
      );

      this.logger.info("Keycloak client factory initialized successfully", {
        clientCount: this.clients.size,
      });
    } catch (error) {
      this.logger.error("Failed to initialize client factory", { error });
      this.metrics?.recordCounter("keycloak.factory.initialization_error", 1);
      throw error;
    }
  }

  /**
   * Get a client by type
   */
  getClient(clientType: ClientType): KeycloakClient {
    if (!this.initialized) {
      throw new Error(
        "Client factory not initialized. Call initialize() first."
      );
    }

    const client = this.clients.get(clientType);
    if (!client) {
      throw new Error(`Client type '${clientType}' not configured`);
    }

    return client;
  }

  /**
   * Get frontend client for public applications
   */
  getFrontendClient(): KeycloakClient {
    return this.getClient("frontend");
  }

  /**
   * Get service client for backend authentication
   */
  getServiceClient(): KeycloakClient {
    return this.getClient("service");
  }

  /**
   * Get WebSocket client for real-time connections
   */
  getWebSocketClient(): KeycloakClient {
    return this.getClient("websocket");
  }

  /**
   * Get admin client for user management
   */
  getAdminClient(): KeycloakClient {
    return this.getClient("admin");
  }

  /**
   * Get tracker client for analytics
   */
  getTrackerClient(): KeycloakClient {
    return this.getClient("tracker");
  }

  /**
   * Get all available client types
   */
  getAvailableClientTypes(): ClientType[] {
    return Array.from(this.clients.keys()) as ClientType[];
  }

  /**
   * Check if a client type is available
   */
  hasClient(clientType: ClientType): boolean {
    return this.clients.has(clientType);
  }

  /**
   * Get configuration for a client type
   */
  getClientConfig(clientType: ClientType): KeycloakRealmConfig {
    const config = this.config.realms[clientType];
    if (!config) {
      throw new Error(`No configuration found for client type '${clientType}'`);
    }
    return config;
  }

  /**
   * Get factory status with health information
   */
  getStatus(): {
    initialized: boolean;
    clientCount: number;
    availableClients: ClientType[];
    healthStatus: {
      overall: "healthy" | "degraded" | "unhealthy";
      clients: Record<string, boolean>;
    };
  } {
    const clientHealth: Record<string, boolean> = {};
    let healthyClients = 0;

    // Check health of each client
    for (const [clientType, client] of this.clients.entries()) {
      const isHealthy = client.isReady();
      clientHealth[clientType] = isHealthy;
      if (isHealthy) healthyClients++;
    }

    // Determine overall health
    let overallHealth: "healthy" | "degraded" | "unhealthy";
    if (healthyClients === this.clients.size) {
      overallHealth = "healthy";
    } else if (healthyClients > 0) {
      overallHealth = "degraded";
    } else {
      overallHealth = "unhealthy";
    }

    return {
      initialized: this.initialized,
      clientCount: this.clients.size,
      availableClients: this.getAvailableClientTypes(),
      healthStatus: {
        overall: overallHealth,
        clients: clientHealth,
      },
    };
  }

  /**
   * Perform health check on all clients
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    results: Record<string, boolean>;
    errors: Record<string, string>;
  }> {
    const results: Record<string, boolean> = {};
    const errors: Record<string, string> = {};

    const healthPromises = Array.from(this.clients.entries()).map(
      async ([clientType, client]) => {
        try {
          const isHealthy = await client.healthCheck();
          results[clientType] = isHealthy;
          if (!isHealthy) {
            errors[clientType] = "Health check failed";
          }
        } catch (error) {
          results[clientType] = false;
          errors[clientType] =
            error instanceof Error ? error.message : "Unknown error";
        }
      }
    );

    await Promise.all(healthPromises);

    const healthy = Object.values(results).every((result) => result);

    return { healthy, results, errors };
  }

  /**
   * Shutdown all clients and cleanup resources
   */
  async shutdown(): Promise<void> {
    this.logger.info("Shutting down Keycloak client factory");

    const startTime = performance.now();

    try {
      // Dispose all clients in parallel
      const disposePromises = Array.from(this.clients.entries()).map(
        async ([clientType, client]) => {
          try {
            await client.dispose();
            this.logger.debug("Client disposed successfully", { clientType });
          } catch (error) {
            this.logger.error("Failed to dispose client", {
              clientType,
              error,
            });
          }
        }
      );

      await Promise.all(disposePromises);

      this.clients.clear();
      this.initialized = false;

      this.metrics?.recordTimer(
        "keycloak.factory.shutdown_duration",
        performance.now() - startTime
      );

      this.logger.info("Keycloak client factory shutdown complete");
    } catch (error) {
      this.logger.error("Error during factory shutdown", { error });
      throw error;
    }
  }

  // Private helper methods

  private buildMultiClientConfig(
    envConfig: KeycloakEnvironmentConfig
  ): KeycloakMultiClientConfig {
    // Validate required configuration
    this.validateEnvironmentConfig(envConfig);

    const baseConfig = {
      serverUrl: envConfig.KEYCLOAK_SERVER_URL.replace(/\/+$/, ""), // Remove trailing slashes
      realm: envConfig.KEYCLOAK_REALM,
    };

    const frontendUrl = envConfig.FRONTEND_URL || "http://localhost:3000";

    const config: KeycloakMultiClientConfig = {
      realms: {},
      defaultOptions: {
        cache: {
          discoveryTtl: 3600, // 1 hour
          jwksTtl: 3600, // 1 hour
          userInfoTtl: 300, // 5 minutes
        },
        http: {
          timeout: 10000, // 10 seconds
          retries: 3,
        },
        security: {
          validateIssuer: true,
          requireSecureAlgorithms: true,
          clockSkew: 30, // 30 seconds
        },
      },
    };

    // Frontend client (public)
    if (envConfig.KEYCLOAK_FRONTEND_CLIENT_ID) {
      config.realms["frontend"] = {
        ...baseConfig,
        clientId: envConfig.KEYCLOAK_FRONTEND_CLIENT_ID,
        redirectUri: `${frontendUrl}/auth/callback`,
        scopes: ["openid", "profile", "email"],
      };
    }

    // Service client (confidential)
    if (
      envConfig.KEYCLOAK_SERVICE_CLIENT_ID &&
      envConfig.KEYCLOAK_SERVICE_CLIENT_SECRET
    ) {
      config.realms["service"] = {
        ...baseConfig,
        clientId: envConfig.KEYCLOAK_SERVICE_CLIENT_ID,
        clientSecret: envConfig.KEYCLOAK_SERVICE_CLIENT_SECRET,
        scopes: ["service:read", "service:write", "service:admin"],
      };
    }

    // WebSocket client
    if (envConfig.KEYCLOAK_WEBSOCKET_CLIENT_ID) {
      const websocketConfig: KeycloakRealmConfig = {
        ...baseConfig,
        clientId: envConfig.KEYCLOAK_WEBSOCKET_CLIENT_ID,
        scopes: ["websocket:connect", "websocket:subscribe", "openid"],
      };

      if (envConfig.KEYCLOAK_WEBSOCKET_CLIENT_SECRET) {
        websocketConfig.clientSecret =
          envConfig.KEYCLOAK_WEBSOCKET_CLIENT_SECRET;
      }

      config.realms["websocket"] = websocketConfig;
    }

    // Admin client (for user management)
    if (
      envConfig.KEYCLOAK_ADMIN_CLIENT_ID &&
      envConfig.KEYCLOAK_ADMIN_CLIENT_SECRET
    ) {
      config.realms["admin"] = {
        ...baseConfig,
        clientId: envConfig.KEYCLOAK_ADMIN_CLIENT_ID,
        clientSecret: envConfig.KEYCLOAK_ADMIN_CLIENT_SECRET,
        scopes: ["admin:users", "admin:realms", "admin:clients"],
      };
    }

    // Tracker client (limited scope)
    if (envConfig.KEYCLOAK_TRACKER_CLIENT_ID) {
      const trackerConfig: KeycloakRealmConfig = {
        ...baseConfig,
        clientId: envConfig.KEYCLOAK_TRACKER_CLIENT_ID,
        scopes: ["tracker:events", "tracker:analytics"],
      };

      if (envConfig.KEYCLOAK_TRACKER_CLIENT_SECRET) {
        trackerConfig.clientSecret = envConfig.KEYCLOAK_TRACKER_CLIENT_SECRET;
      }

      config.realms["tracker"] = trackerConfig;
    }

    return config;
  }

  /**
   * Validate environment configuration before building client configs
   */
  private validateEnvironmentConfig(
    envConfig: KeycloakEnvironmentConfig
  ): void {
    // Required base configuration
    if (!envConfig.KEYCLOAK_SERVER_URL) {
      throw new Error("KEYCLOAK_SERVER_URL is required");
    }

    if (!envConfig.KEYCLOAK_REALM) {
      throw new Error("KEYCLOAK_REALM is required");
    }

    // Validate server URL format
    try {
      new URL(envConfig.KEYCLOAK_SERVER_URL);
    } catch (error) {
      throw new Error("KEYCLOAK_SERVER_URL must be a valid URL");
    }

    // Validate that at least one client is configured
    const hasAnyClient = [
      envConfig.KEYCLOAK_FRONTEND_CLIENT_ID,
      envConfig.KEYCLOAK_SERVICE_CLIENT_ID,
      envConfig.KEYCLOAK_WEBSOCKET_CLIENT_ID,
      envConfig.KEYCLOAK_ADMIN_CLIENT_ID,
      envConfig.KEYCLOAK_TRACKER_CLIENT_ID,
    ].some((clientId) => clientId && clientId.trim() !== "");

    if (!hasAnyClient) {
      throw new Error("At least one Keycloak client must be configured");
    }

    // Validate confidential clients have secrets
    const confidentialClients = [
      {
        id: envConfig.KEYCLOAK_SERVICE_CLIENT_ID,
        secret: envConfig.KEYCLOAK_SERVICE_CLIENT_SECRET,
        name: "service",
      },
      {
        id: envConfig.KEYCLOAK_ADMIN_CLIENT_ID,
        secret: envConfig.KEYCLOAK_ADMIN_CLIENT_SECRET,
        name: "admin",
      },
    ];

    for (const client of confidentialClients) {
      if (
        client.id &&
        client.id.trim() !== "" &&
        (!client.secret || client.secret.trim() === "")
      ) {
        throw new Error(`${client.name} client requires a client secret`);
      }
    }

    // Validate frontend URL if provided
    if (envConfig.FRONTEND_URL) {
      try {
        new URL(envConfig.FRONTEND_URL);
      } catch (error) {
        throw new Error("FRONTEND_URL must be a valid URL when provided");
      }
    }

    // Validate API base URL if provided
    if (envConfig.API_BASE_URL) {
      try {
        new URL(envConfig.API_BASE_URL);
      } catch (error) {
        throw new Error("API_BASE_URL must be a valid URL when provided");
      }
    }
  }
}

/**
 * Factory function to create and initialize KeycloakClientFactory
 */
export async function createKeycloakClientFactory(
  envConfig: KeycloakEnvironmentConfig,
  metrics?: IMetricsCollector
): Promise<KeycloakClientFactory> {
  const factory = new KeycloakClientFactory(envConfig, metrics);
  await factory.initialize();
  return factory;
}

/**
 * Helper function to create environment config from process.env
 */
export function createEnvironmentConfig(
  overrides: Partial<KeycloakEnvironmentConfig> = {}
): KeycloakEnvironmentConfig {
  const config: KeycloakEnvironmentConfig = {
    KEYCLOAK_SERVER_URL: process.env["KEYCLOAK_SERVER_URL"] || "",
    KEYCLOAK_REALM: process.env["KEYCLOAK_REALM"] || "",

    KEYCLOAK_FRONTEND_CLIENT_ID:
      process.env["KEYCLOAK_FRONTEND_CLIENT_ID"] || "",

    KEYCLOAK_SERVICE_CLIENT_ID: process.env["KEYCLOAK_SERVICE_CLIENT_ID"] || "",
    KEYCLOAK_SERVICE_CLIENT_SECRET:
      process.env["KEYCLOAK_SERVICE_CLIENT_SECRET"] || "",

    KEYCLOAK_WEBSOCKET_CLIENT_ID:
      process.env["KEYCLOAK_WEBSOCKET_CLIENT_ID"] || "",
    KEYCLOAK_WEBSOCKET_CLIENT_SECRET:
      process.env["KEYCLOAK_WEBSOCKET_CLIENT_SECRET"],

    KEYCLOAK_ADMIN_CLIENT_ID: process.env["KEYCLOAK_ADMIN_CLIENT_ID"] || "",
    KEYCLOAK_ADMIN_CLIENT_SECRET:
      process.env["KEYCLOAK_ADMIN_CLIENT_SECRET"] || "",

    KEYCLOAK_TRACKER_CLIENT_ID: process.env["KEYCLOAK_TRACKER_CLIENT_ID"] || "",
    KEYCLOAK_TRACKER_CLIENT_SECRET:
      process.env["KEYCLOAK_TRACKER_CLIENT_SECRET"],

    FRONTEND_URL: process.env["FRONTEND_URL"],
    API_BASE_URL: process.env["API_BASE_URL"],

    ...overrides,
  };

  // Log configuration warnings for missing optional values
  if (!config.FRONTEND_URL) {
    console.warn(
      "FRONTEND_URL not configured, using default: http://localhost:3000"
    );
  }

  if (!config.API_BASE_URL) {
    console.warn(
      "API_BASE_URL not configured, may affect service-to-service communication"
    );
  }

  // Validate critical environment variables
  const requiredVars = ["KEYCLOAK_SERVER_URL", "KEYCLOAK_REALM"];
  const missingVars = requiredVars.filter(
    (varName) => !config[varName as keyof KeycloakEnvironmentConfig]
  );

  if (missingVars.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingVars.join(", ")}`
    );
  }

  return config;
}
