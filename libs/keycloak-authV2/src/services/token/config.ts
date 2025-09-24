/**
 * Authentication configuration service
 */

export interface AuthV2Config {
  // JWT Configuration
  jwt: {
    issuer?: string;
    audience?: string;
    jwksUrl?: string;
  };

  // Cache Configuration
  cache: {
    enabled: boolean;
    ttl: {
      jwt: number; // JWT validation results
      apiKey: number; // API key validation results
      session: number; // Session data
      userInfo: number; // User information
    };
  };

  // Security Configuration
  security: {
    constantTimeComparison: boolean;
    apiKeyHashRounds: number;
    sessionRotationInterval: number;
  };

  // Session Management Configuration
  session: {
    maxConcurrentSessions: number; // Maximum concurrent sessions per user (0 = unlimited)
    enforceIpConsistency: boolean; // Require sessions to use same IP address
    enforceUserAgentConsistency: boolean; // Require sessions to use same user agent
    tokenEncryption: boolean; // Whether to encrypt tokens in storage
  };

  // Encryption Configuration
  encryption: {
    key?: string; // Master encryption key (falls back to env KEYCLOAK_ENCRYPTION_KEY)
    keyDerivationIterations?: number; // PBKDF2 iterations for key derivation
  };
}

export const DEFAULT_CONFIG: AuthV2Config = {
  jwt: {
    ...(process.env["KEYCLOAK_ISSUER"] && {
      issuer: process.env["KEYCLOAK_ISSUER"],
    }),
    ...(process.env["KEYCLOAK_AUDIENCE"] && {
      audience: process.env["KEYCLOAK_AUDIENCE"],
    }),
    ...(process.env["KEYCLOAK_JWKS_URL"] && {
      jwksUrl: process.env["KEYCLOAK_JWKS_URL"],
    }),
  },
  cache: {
    enabled: true,
    ttl: {
      jwt: 300, // 5 minutes
      apiKey: 600, // 10 minutes
      session: 3600, // 1 hour
      userInfo: 1800, // 30 minutes
    },
  },
  security: {
    constantTimeComparison: true,
    apiKeyHashRounds: 12,
    sessionRotationInterval: 86400, // 24 hours
  },
  session: {
    maxConcurrentSessions: 5, // Allow 5 concurrent sessions per user
    enforceIpConsistency: true, // Require same IP address
    enforceUserAgentConsistency: false, // Don't enforce user agent consistency
    tokenEncryption: true, // Encrypt tokens in storage
  },
  encryption: {
    ...(process.env["KEYCLOAK_ENCRYPTION_KEY"] && {
      key: process.env["KEYCLOAK_ENCRYPTION_KEY"],
    }),
    keyDerivationIterations: 100000, // OWASP recommended PBKDF2 iterations
  },
};

/**
 * Create auth configuration with custom overrides
 */
export function createAuthV2Config(
  overrides: Partial<AuthV2Config> = {}
): AuthV2Config {
  return {
    jwt: {
      ...DEFAULT_CONFIG.jwt,
      ...overrides.jwt,
    },
    cache: {
      ...DEFAULT_CONFIG.cache,
      ...overrides.cache,
      ttl: {
        ...DEFAULT_CONFIG.cache.ttl,
        ...overrides.cache?.ttl,
      },
    },
    security: {
      ...DEFAULT_CONFIG.security,
      ...overrides.security,
    },
    session: {
      ...DEFAULT_CONFIG.session,
      ...overrides.session,
    },
    encryption: {
      ...DEFAULT_CONFIG.encryption,
      ...overrides.encryption,
    },
  };
}

/**
 * Load configuration from environment variables
 */
export function loadConfigFromEnv(): AuthV2Config {
  const envConfig: Partial<AuthV2Config> = {
    cache: {
      enabled: process.env["KEYCLOAK_CACHE_ENABLED"] !== "false",
      ttl: {
        jwt: parseInt(process.env["KEYCLOAK_CACHE_JWT_TTL"] || "300"),
        apiKey: parseInt(process.env["KEYCLOAK_CACHE_API_KEY_TTL"] || "600"),
        session: parseInt(process.env["KEYCLOAK_CACHE_SESSION_TTL"] || "3600"),
        userInfo: parseInt(
          process.env["KEYCLOAK_CACHE_USER_INFO_TTL"] || "1800"
        ),
      },
    },
    security: {
      constantTimeComparison:
        process.env["KEYCLOAK_CONSTANT_TIME_COMPARISON"] !== "false",
      apiKeyHashRounds: parseInt(
        process.env["KEYCLOAK_API_KEY_HASH_ROUNDS"] || "12"
      ),
      sessionRotationInterval: parseInt(
        process.env["KEYCLOAK_SESSION_ROTATION_INTERVAL"] || "86400"
      ),
    },
    session: {
      maxConcurrentSessions: parseInt(
        process.env["KEYCLOAK_MAX_CONCURRENT_SESSIONS"] || "5"
      ),
      enforceIpConsistency:
        process.env["KEYCLOAK_ENFORCE_IP_CONSISTENCY"] !== "false",
      enforceUserAgentConsistency:
        process.env["KEYCLOAK_ENFORCE_USER_AGENT_CONSISTENCY"] === "true",
      tokenEncryption: process.env["KEYCLOAK_TOKEN_ENCRYPTION"] !== "false",
    },
    encryption: {
      ...(process.env["KEYCLOAK_ENCRYPTION_KEY"] && {
        key: process.env["KEYCLOAK_ENCRYPTION_KEY"],
      }),
      keyDerivationIterations: parseInt(
        process.env["KEYCLOAK_ENCRYPTION_ITERATIONS"] || "100000"
      ),
    },
  };

  // Only add JWT config fields if they're defined
  const jwtConfig: Partial<AuthV2Config["jwt"]> = {};
  if (process.env["KEYCLOAK_ISSUER"]) {
    jwtConfig.issuer = process.env["KEYCLOAK_ISSUER"];
  }
  if (process.env["KEYCLOAK_AUDIENCE"]) {
    jwtConfig.audience = process.env["KEYCLOAK_AUDIENCE"];
  }
  if (process.env["KEYCLOAK_JWKS_URL"]) {
    jwtConfig.jwksUrl = process.env["KEYCLOAK_JWKS_URL"];
  }

  if (Object.keys(jwtConfig).length > 0) {
    envConfig.jwt = jwtConfig;
  }

  return createAuthV2Config(envConfig);
}
