/**
 * Authentication configuration service
 */

import { z } from "zod";

// Zod schemas for configuration validation
const JWTConfigSchema = z
  .object({
    issuer: z.string().url("Issuer must be a valid URL").optional(),
    audience: z.string().min(1, "Audience must be non-empty").optional(),
    jwksUrl: z.string().url("JWKS URL must be a valid URL").optional(),
  })
  .strict()
  .refine(
    (data) => {
      if (data.issuer && data.jwksUrl) {
        try {
          const issuerUrl = new URL(data.issuer);
          const jwksUrl = new URL(data.jwksUrl);
          return issuerUrl.origin === jwksUrl.origin;
        } catch {
          return false;
        }
      }
      return true;
    },
    { message: "JWKS URL must be from the same domain as issuer for security" }
  );

const CacheConfigSchema = z.object({
  enabled: z.boolean(),
  ttl: z.object({
    jwt: z
      .number()
      .int()
      .min(1, "JWT TTL must be at least 1 second")
      .max(86400, "JWT TTL cannot exceed 24 hours"),
    apiKey: z
      .number()
      .int()
      .min(1, "API key TTL must be at least 1 second")
      .max(86400, "API key TTL cannot exceed 24 hours"),
    session: z
      .number()
      .int()
      .min(1, "Session TTL must be at least 1 second")
      .max(86400, "Session TTL cannot exceed 24 hours"),
    userInfo: z
      .number()
      .int()
      .min(1, "User info TTL must be at least 1 second")
      .max(86400, "User info TTL cannot exceed 24 hours"),
  }),
});

const SecurityConfigSchema = z.object({
  constantTimeComparison: z.boolean(),
  apiKeyHashRounds: z
    .number()
    .int()
    .min(4, "Hash rounds must be at least 4")
    .max(20, "Hash rounds cannot exceed 20"),
  sessionRotationInterval: z
    .number()
    .int()
    .min(300, "Session rotation interval must be at least 5 minutes"),
});

const SessionConfigSchema = z.object({
  maxConcurrentSessions: z
    .number()
    .int()
    .min(0, "Max concurrent sessions must be non-negative"),
  enforceIpConsistency: z.boolean(),
  enforceUserAgentConsistency: z.boolean(),
  tokenEncryption: z.boolean(),
});

const EncryptionConfigSchema = z.object({
  key: z
    .string()
    .min(32, "Encryption key must be at least 32 characters")
    .optional(),
  keyDerivationIterations: z
    .number()
    .int()
    .min(10000, "Key derivation iterations must be at least 10,000")
    .optional(),
});

const AuthV2ConfigSchema = z.object({
  jwt: JWTConfigSchema,
  cache: CacheConfigSchema,
  security: SecurityConfigSchema,
  session: SessionConfigSchema,
  encryption: EncryptionConfigSchema,
});

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
  const config = {
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

  // Validate the final configuration
  try {
    AuthV2ConfigSchema.parse(config);
    return config;
  } catch (error) {
    throw new Error(
      `Invalid AuthV2 configuration: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Load configuration from environment variables
 */
/**
 * Safely parse integer environment variables
 */
function safeParseInt(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

export function loadConfigFromEnv(): AuthV2Config {
  const envConfig: Partial<AuthV2Config> = {
    cache: {
      enabled: process.env["KEYCLOAK_CACHE_ENABLED"] !== "false",
      ttl: {
        jwt: safeParseInt(process.env["KEYCLOAK_CACHE_JWT_TTL"], 300),
        apiKey: safeParseInt(process.env["KEYCLOAK_CACHE_API_KEY_TTL"], 600),
        session: safeParseInt(process.env["KEYCLOAK_CACHE_SESSION_TTL"], 3600),
        userInfo: safeParseInt(
          process.env["KEYCLOAK_CACHE_USER_INFO_TTL"],
          1800
        ),
      },
    },
    security: {
      constantTimeComparison:
        process.env["KEYCLOAK_CONSTANT_TIME_COMPARISON"] !== "false",
      apiKeyHashRounds: safeParseInt(
        process.env["KEYCLOAK_API_KEY_HASH_ROUNDS"],
        12
      ),
      sessionRotationInterval: safeParseInt(
        process.env["KEYCLOAK_SESSION_ROTATION_INTERVAL"],
        86400
      ),
    },
    session: {
      maxConcurrentSessions: safeParseInt(
        process.env["KEYCLOAK_MAX_CONCURRENT_SESSIONS"],
        5
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
      keyDerivationIterations: safeParseInt(
        process.env["KEYCLOAK_ENCRYPTION_ITERATIONS"],
        100000
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

  try {
    return createAuthV2Config(envConfig);
  } catch (error) {
    throw new Error(
      `Failed to load configuration from environment: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
