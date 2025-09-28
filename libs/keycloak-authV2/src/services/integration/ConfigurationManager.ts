/**
 * Configuration Manager Component
 * Single Responsibility: Service configuration setup and management
 */

import type {
  IConfigurationManager,
  KeycloakConnectionOptions,
} from "./interfaces";

// Configuration Constants
const CACHE_TTL = {
  STATS: 5000, // 5 seconds for stats cache
  JWT: 300, // 5 minutes for JWT cache
  API_KEY: 600, // 10 minutes for API key cache
  SESSION: 3600, // 1 hour for session cache
  USER_INFO: 1800, // 30 minutes for user info cache
} as const;

const SESSION_CONFIG = {
  MAX_CONCURRENT: 5, // Maximum concurrent sessions per user
  ROTATION_INTERVAL: 86400, // 24 hours in seconds for user sessions
  ROTATION_INTERVAL_SESSIONS: 43200, // 12 hours in seconds for session manager
} as const;

const SECURITY_CONFIG = {
  API_KEY_HASH_ROUNDS: 12, // bcrypt rounds for API key hashing
  KEY_DERIVATION_ITERATIONS: 100000, // PBKDF2 iterations for encryption
} as const;

/**
 * Configuration Manager Component
 * Centralizes all service configuration logic
 */
export class ConfigurationManager implements IConfigurationManager {
  constructor(private readonly keycloakOptions: KeycloakConnectionOptions) {}

  /**
   * Create base configuration for all services
   */
  createBaseConfiguration(hasMetrics: boolean) {
    return {
      jwt: {},
      cache: {
        enabled: hasMetrics,
        ttl: {
          jwt: CACHE_TTL.JWT,
          apiKey: CACHE_TTL.API_KEY,
          session: CACHE_TTL.SESSION,
          userInfo: CACHE_TTL.USER_INFO,
        },
      },
      security: {
        constantTimeComparison: true,
        apiKeyHashRounds: SECURITY_CONFIG.API_KEY_HASH_ROUNDS,
        sessionRotationInterval: SESSION_CONFIG.ROTATION_INTERVAL,
      },
      session: {
        maxConcurrentSessions: SESSION_CONFIG.MAX_CONCURRENT,
        enforceIpConsistency: true,
        enforceUserAgentConsistency: true,
        tokenEncryption: true,
      },
      encryption: {
        keyDerivationIterations: SECURITY_CONFIG.KEY_DERIVATION_ITERATIONS,
      },
    };
  }

  /**
   * Get Keycloak connection options
   */
  getKeycloakConnectionOptions(): KeycloakConnectionOptions {
    return {
      serverUrl: this.keycloakOptions.serverUrl,
      realm: this.keycloakOptions.realm,
      clientId: this.keycloakOptions.clientId,
      ...(this.keycloakOptions.clientSecret && {
        clientSecret: this.keycloakOptions.clientSecret,
      }),
    };
  }

  /**
   * Get cache configuration
   */
  getCacheConfiguration(): {
    ttl: Record<string, number>;
    enabled: boolean;
  } {
    return {
      ttl: {
        stats: CACHE_TTL.STATS,
        jwt: CACHE_TTL.JWT,
        apiKey: CACHE_TTL.API_KEY,
        session: CACHE_TTL.SESSION,
        userInfo: CACHE_TTL.USER_INFO,
      },
      enabled: true, // Enable by default, can be overridden by metrics availability
    };
  }

  /**
   * Get security configuration
   */
  getSecurityConfiguration(): {
    constantTimeComparison: boolean;
    apiKeyHashRounds: number;
    sessionRotationInterval: number;
  } {
    return {
      constantTimeComparison: true,
      apiKeyHashRounds: SECURITY_CONFIG.API_KEY_HASH_ROUNDS,
      sessionRotationInterval: SESSION_CONFIG.ROTATION_INTERVAL,
    };
  }

  /**
   * Get session configuration
   */
  getSessionConfiguration() {
    return {
      maxConcurrentSessions: SESSION_CONFIG.MAX_CONCURRENT,
      rotationInterval: SESSION_CONFIG.ROTATION_INTERVAL,
      rotationIntervalSessions: SESSION_CONFIG.ROTATION_INTERVAL_SESSIONS,
    };
  }

  /**
   * Get JWT configuration for the current realm
   */
  getJwtConfiguration() {
    return {
      issuer: `${this.keycloakOptions.serverUrl}/realms/${this.keycloakOptions.realm}`,
      audience: this.keycloakOptions.clientId,
      jwksUrl: `${this.keycloakOptions.serverUrl}/realms/${this.keycloakOptions.realm}/protocol/openid_connect/certs`,
    };
  }

  /**
   * Get OIDC scopes for authentication
   */
  getOidcScopes(): string[] {
    return ["openid", "profile", "email"];
  }
}
