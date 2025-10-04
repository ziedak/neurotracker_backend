/**
 * Better-Auth Plugins Configuration
 *
 * Configures and exports Better-Auth plugins for extended functionality:
 * - Bearer Token Authentication
 * - JWT Authentication with JWKS
 * - API Key Authentication
 * - Organization Management (Multi-tenancy)
 * - Two-Factor Authentication (TOTP)
 * - Multi-Session Support
 *
 * @module config/plugins.config
 */

import { bearer } from "better-auth/plugins";
import { jwt } from "better-auth/plugins";
import { apiKey } from "better-auth/plugins";
import { organization } from "better-auth/plugins";
import { twoFactor } from "better-auth/plugins";
import { multiSession } from "better-auth/plugins";
import { createLogger } from "@libs/utils";

const logger = createLogger("better-auth-plugins");

/**
 * Plugin configuration options
 */
export interface PluginConfigOptions {
  /** Environment (affects security settings) */
  environment?: "development" | "production" | "test";

  /** JWT configuration */
  jwt?: {
    /** Algorithm for JWT signing */
    algorithm?:
      | "HS256"
      | "HS384"
      | "HS512"
      | "RS256"
      | "RS384"
      | "RS512"
      | "ES256"
      | "ES384"
      | "ES512"
      | "EdDSA";
    /** Token expiration time (ms) */
    expiresIn?: number;
    /** JWT issuer */
    issuer?: string;
    /** JWT audience */
    audience?: string | string[];
  };

  /** Bearer token configuration */
  bearer?: {
    /** Token expiration time (ms) */
    expiresIn?: number;
    /** Enable token refresh */
    refreshEnabled?: boolean;
    /** Refresh token expiration (ms) */
    refreshExpiresIn?: number;
  };

  /** API Key configuration */
  apiKey?: {
    /** Enable rate limiting per key */
    rateLimit?: boolean;
    /** Default rate limit (requests per minute) */
    defaultRateLimit?: number;
  };

  /** Organization configuration */
  organization?: {
    /** Allow users to create organizations */
    allowUserToCreateOrganization?: boolean;
    /** Maximum organizations per user */
    organizationLimit?: number;
    /** Maximum members per organization */
    membershipLimit?: number;
  };

  /** Two-Factor Authentication configuration */
  twoFactor?: {
    /** TOTP issuer name */
    issuer?: string;
    /** Backup codes count */
    backupCodesCount?: number;
  };

  /** Multi-Session configuration */
  multiSession?: {
    /** Maximum concurrent sessions per user */
    maximumSessions?: number;
  };
}

/**
 * Create and configure Better-Auth plugins
 *
 * @example
 * ```typescript
 * import { createPluginsConfig } from './config/plugins.config';
 *
 * const plugins = createPluginsConfig({
 *   environment: 'production',
 *   jwt: {
 *     algorithm: 'EdDSA',
 *     expiresIn: 900000, // 15 minutes
 *   },
 * });
 * ```
 */
export function createPluginsConfig(options: PluginConfigOptions = {}): {
  bearer: ReturnType<typeof bearer>;
  jwt: ReturnType<typeof jwt>;
  apiKey: ReturnType<typeof apiKey>;
  organization: ReturnType<typeof organization>;
  twoFactor: ReturnType<typeof twoFactor>;
  multiSession: ReturnType<typeof multiSession>;
} {
  const isDevelopment = options.environment === "development";

  logger.info("Configuring Better-Auth plugins", {
    environment: options.environment,
  });

  /**
   * Bearer Token Plugin
   * Provides Bearer token authentication for APIs and mobile apps
   */
  const bearerPlugin = bearer();

  /**
   * JWT Plugin
   * Provides JWT authentication with JWKS for microservices
   */
  const jwtPlugin = jwt({
    // JWKS configuration for public key distribution
    jwks: {
      // Use remote URL if configured, otherwise use built-in JWKS endpoint
      ...(options.jwt?.issuer && {
        keyPairConfig: {
          alg: (options.jwt?.algorithm ?? "EdDSA") as any,
        },
      }),
    },
    // JWT metadata
    jwt: {
      // Issuer claim
      ...(options.jwt?.issuer && { issuer: options.jwt.issuer }),
      // Audience claim (must be single string for Better-Auth)
      ...(options.jwt?.audience &&
        typeof options.jwt.audience === "string" && {
          audience: options.jwt.audience,
        }),
      // Token expiration
      ...(options.jwt?.expiresIn && {
        expirationTime: `${options.jwt.expiresIn}ms`,
      }),
    },
  });

  /**
   * API Key Plugin
   * Provides API key authentication for service-to-service communication
   */
  const apiKeyPlugin = apiKey({
    // Enable metadata support for API keys
    enableMetadata: true,

    // Rate limiting configuration (if enabled)
    ...(options.apiKey?.rateLimit !== false &&
      options.apiKey?.defaultRateLimit && {
        rateLimit: {
          enabled: true,
          // Time window in milliseconds (1 minute default)
          timeWindow: 60000,
          // Maximum requests per window
          maxRequests: options.apiKey.defaultRateLimit,
        },
      }),
  });

  /**
   * Organization Plugin
   * Provides multi-tenancy with role-based access control
   */
  const organizationPlugin = organization({
    // Allow users to create organizations
    ...(typeof options.organization?.allowUserToCreateOrganization ===
      "boolean" && {
      allowUserToCreateOrganization:
        options.organization.allowUserToCreateOrganization,
    }),

    // Creator role (owner by default)
    creatorRole: "owner",

    // Send invitation email handler
    sendInvitationEmail: async (data) => {
      logger.debug("Invitation email requested", {
        email: data.email,
        organizationId: data.organization.id,
      });
      // TODO: Integrate with email service
      if (isDevelopment) {
        logger.info("Invitation details:", {
          email: data.email,
          organizationName: data.organization.name,
        });
      }
    },
  });

  /**
   * Two-Factor Authentication Plugin
   * Provides TOTP-based 2FA with backup codes
   */
  const twoFactorPlugin = twoFactor({
    // TOTP issuer name (shown in authenticator apps)
    ...(options.twoFactor?.issuer && { issuer: options.twoFactor.issuer }),

    // Backup codes configuration
    ...(options.twoFactor?.backupCodesCount && {
      backupCodesCount: options.twoFactor.backupCodesCount,
    }),
  });

  /**
   * Multi-Session Plugin
   * Allows users to have multiple concurrent sessions
   */
  const multiSessionPlugin = multiSession();

  logger.info("Better-Auth plugins configured successfully");

  return {
    bearer: bearerPlugin,
    jwt: jwtPlugin,
    apiKey: apiKeyPlugin,
    organization: organizationPlugin,
    twoFactor: twoFactorPlugin,
    multiSession: multiSessionPlugin,
  };
}

/**
 * Plugin configuration presets
 */
export const pluginPresets = {
  /**
   * Development preset
   * - Longer token expiration
   * - Less strict limits
   * - More permissive settings
   */
  development: (): PluginConfigOptions => ({
    environment: "development",
    jwt: {
      algorithm: "HS256", // Simpler algorithm for development
      expiresIn: 3600000, // 1 hour
    },
    bearer: {
      expiresIn: 86400000, // 24 hours
      refreshEnabled: true,
      refreshExpiresIn: 604800000, // 7 days
    },
    apiKey: {
      rateLimit: false, // Disabled in development
    },
    organization: {
      allowUserToCreateOrganization: true,
      organizationLimit: 10,
      membershipLimit: 100,
    },
  }),

  /**
   * Production preset
   * - Short token expiration
   * - Strict limits
   * - Maximum security
   */
  production: (): PluginConfigOptions => {
    const jwtIssuer = process.env["JWT_ISSUER"];
    const jwtAudience = process.env["JWT_AUDIENCE"];

    const result: PluginConfigOptions = {
      environment: "production",
      bearer: {
        expiresIn: 3600000, // 1 hour
        refreshEnabled: true,
        refreshExpiresIn: 86400000, // 1 day
      },
      apiKey: {
        rateLimit: true,
        defaultRateLimit: 10000, // 10k req/min
      },
      organization: {
        allowUserToCreateOrganization: true,
        organizationLimit: 5,
        membershipLimit: 100,
      },
      multiSession: {
        maximumSessions: 5, // Limit sessions in production
      },
    };

    // Add JWT config only if env vars are set
    if (jwtIssuer || jwtAudience) {
      result.jwt = {
        algorithm: "EdDSA", // Most secure
        expiresIn: 900000, // 15 minutes
      };
      if (jwtIssuer) result.jwt.issuer = jwtIssuer;
      if (jwtAudience) result.jwt.audience = jwtAudience.split(",");
    }

    return result;
  },

  /**
   * Testing preset
   * - Fast configuration
   * - Minimal restrictions
   */
  test: (): PluginConfigOptions => ({
    environment: "test",
    jwt: {
      algorithm: "HS256",
      expiresIn: 3600000,
    },
    bearer: {
      expiresIn: 3600000,
      refreshEnabled: false,
    },
    apiKey: {
      rateLimit: false,
    },
    organization: {
      allowUserToCreateOrganization: true,
      organizationLimit: 100,
      membershipLimit: 100,
    },
    multiSession: {
      maximumSessions: 100,
    },
  }),
};

/**
 * Get plugin configuration from environment
 */
export function getPluginsConfigFromEnv(): PluginConfigOptions {
  const environment = (process.env["NODE_ENV"] || "production") as
    | "development"
    | "production"
    | "test";

  const jwtAlgorithm = process.env["JWT_ALGORITHM"];
  const jwtExpiresIn = process.env["JWT_EXPIRES_IN"];
  const jwtIssuer = process.env["JWT_ISSUER"];
  const jwtAudience = process.env["JWT_AUDIENCE"];

  const bearerExpiresIn = process.env["BEARER_EXPIRES_IN"];

  const apiKeyRateLimit = process.env["API_KEY_RATE_LIMIT"];
  const apiKeyDefaultRateLimit = process.env["API_KEY_DEFAULT_RATE_LIMIT"];

  const allowUserCreateOrg = process.env["ALLOW_USER_CREATE_ORG"];
  const organizationLimit = process.env["ORGANIZATION_LIMIT"];

  const appName = process.env["APP_NAME"];
  const maxSessions = process.env["MAX_SESSIONS"];

  const result: PluginConfigOptions = {
    environment,
  };

  // Only include JWT config if any JWT env vars are set
  if (jwtAlgorithm || jwtExpiresIn || jwtIssuer || jwtAudience) {
    result.jwt = {};
    if (jwtAlgorithm) result.jwt.algorithm = jwtAlgorithm as any;
    if (jwtExpiresIn) result.jwt.expiresIn = parseInt(jwtExpiresIn, 10);
    if (jwtIssuer) result.jwt.issuer = jwtIssuer;
    if (jwtAudience) result.jwt.audience = jwtAudience.split(",");
  }

  // Only include Bearer config if env vars are set
  if (bearerExpiresIn) {
    result.bearer = {
      expiresIn: parseInt(bearerExpiresIn, 10),
    };
  }

  // Only include API Key config if env vars are set
  if (apiKeyRateLimit || apiKeyDefaultRateLimit) {
    result.apiKey = {
      rateLimit: apiKeyRateLimit !== "false",
    };
    if (apiKeyDefaultRateLimit) {
      result.apiKey.defaultRateLimit = parseInt(apiKeyDefaultRateLimit, 10);
    }
  }

  // Only include Organization config if env vars are set
  if (allowUserCreateOrg || organizationLimit) {
    result.organization = {
      allowUserToCreateOrganization: allowUserCreateOrg !== "false",
    };
    if (organizationLimit) {
      result.organization.organizationLimit = parseInt(organizationLimit, 10);
    }
  }

  // Only include Two-Factor config if env vars are set
  if (appName) {
    result.twoFactor = {
      issuer: appName,
    };
  }

  // Only include Multi-Session config if env vars are set
  if (maxSessions) {
    result.multiSession = {
      maximumSessions: parseInt(maxSessions, 10),
    };
  }

  return result;
}
