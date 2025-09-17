/**
 * Keycloak Authentication Library - Basic Exports
 * Simplified exports for initial testing
 */

// Types
export type ClientType = "frontend" | "service" | "tracker" | "websocket";

export interface KeycloakClientConfig {
  realm: string;
  serverUrl: string;
  clientId: string;
  clientSecret?: string;
  type: ClientType;
  scopes: string[];
  flow:
    | "authorization_code"
    | "client_credentials"
    | "direct_grant"
    | "websocket";
  redirectUri?: string;
}

// Basic factory interface
export interface IKeycloakClientFactory {
  getClient(type: ClientType): KeycloakClientConfig;
  getDiscoveryDocument(realm: string): Promise<any>;
}

// Simple implementation for testing
export class KeycloakClientFactory implements IKeycloakClientFactory {
  private baseConfig: {
    realm: string;
    serverUrl: string;
  };

  constructor(envConfig: any) {
    this.baseConfig = {
      realm: envConfig.KEYCLOAK_REALM,
      serverUrl: envConfig.KEYCLOAK_SERVER_URL,
    };
  }

  getClient(type: ClientType): KeycloakClientConfig {
    const base = {
      realm: this.baseConfig.realm,
      serverUrl: this.baseConfig.serverUrl,
      type,
      scopes: ["openid"],
    };

    switch (type) {
      case "frontend":
        return {
          ...base,
          clientId: "frontend-client",
          flow: "authorization_code",
          scopes: ["openid", "profile", "email"],
          redirectUri: "http://localhost:3000/auth/callback",
        };
      case "service":
        return {
          ...base,
          clientId: "service-client",
          clientSecret: "service-secret",
          flow: "client_credentials",
          scopes: ["service:read", "service:write"],
        };
      default:
        throw new Error(`Unknown client type: ${type}`);
    }
  }

  async getDiscoveryDocument(realm: string): Promise<any> {
    const url = `${this.baseConfig.serverUrl}/realms/${realm}/.well-known/openid_connect_configuration`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch discovery document: ${response.status}`);
    }

    return response.json();
  }
}

// Factory function
export const createKeycloakClientFactory = (
  envConfig: any
): KeycloakClientFactory => {
  return new KeycloakClientFactory(envConfig);
};

// Utility functions
export const extractBearerToken = (authHeader?: string): string | null => {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.substring(7);
};

export const VERSION = "1.0.0";
export const LIBRARY_NAME = "@libs/keycloak-auth";
