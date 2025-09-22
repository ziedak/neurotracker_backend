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

      // Initialize all clients in parallel
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
          } catch (error) {
            this.logger.error("Failed to initialize client", {
              clientType,
              error,
            });
            throw new Error(
              `Failed to initialize ${clientType} client: ${error}`
            );
          }
        }
      );

      await Promise.all(initPromises);

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
   * Get factory status
   */
  getStatus(): {
    initialized: boolean;
    clientCount: number;
    availableClients: ClientType[];
  } {
    return {
      initialized: this.initialized,
      clientCount: this.clients.size,
      availableClients: this.getAvailableClientTypes(),
    };
  }

  /**
   * Shutdown all clients and cleanup resources
   */
  async shutdown(): Promise<void> {
    this.logger.info("Shutting down Keycloak client factory");

    this.clients.clear();
    this.initialized = false;

    this.logger.info("Keycloak client factory shutdown complete");
  }

  // Private helper methods

  private buildMultiClientConfig(
    envConfig: KeycloakEnvironmentConfig
  ): KeycloakMultiClientConfig {
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
  return {
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
}
