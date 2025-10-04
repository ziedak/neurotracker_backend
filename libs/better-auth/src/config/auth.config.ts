/**
 * Better-Auth Configuration Builder
 *
 * Provides a type-safe, production-ready configuration for Better-Auth
 * with Prisma adapter and comprehensive plugin support.
 *
 * @module config/auth.config
 */

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import type { PrismaClient } from "@prisma/client";

import { createLogger } from "@libs/utils";

const logger = createLogger("better-auth-config");

/**
 * Configuration builder options
 */
export interface AuthConfigOptions {
  /** Prisma client instance */
  prisma: PrismaClient;

  /** Application name */
  appName?: string;

  /** Base URL for authentication endpoints */
  baseURL: string;

  /** Secret key for encryption (min 32 characters) */
  secret: string;

  /** Environment (development, production, test) */
  environment?: "development" | "production" | "test";

  /** Enable debug logging */
  debug?: boolean;

  /** Trust proxy headers */
  trustProxy?: boolean;

  /** CORS allowed origins */
  corsOrigins?: string[];
}

/**
 * Validate configuration options
 */
function validateConfig(options: AuthConfigOptions): void {
  if (!options.secret || options.secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must be at least 32 characters long");
  }

  if (!options.baseURL) {
    throw new Error("baseURL is required");
  }

  try {
    new URL(options.baseURL);
  } catch {
    throw new Error(`Invalid baseURL: ${options.baseURL}`);
  }

  if (!options.prisma) {
    throw new Error("Prisma client is required");
  }

  logger.info("Configuration validated successfully", {
    environment: options.environment || "production",
    baseURL: options.baseURL,
    trustProxy: options.trustProxy ?? false,
  });
}

/**
 * Create Better-Auth configuration with Prisma adapter
 *
 * @example
 * ```typescript
 * import { PrismaClient } from '@prisma/client';
 * import { createAuthConfig } from './config/auth.config';
 *
 * const prisma = new PrismaClient();
 * const auth = createAuthConfig({
 *   prisma,
 *   baseURL: process.env.BASE_URL!,
 *   secret: process.env.BETTER_AUTH_SECRET!,
 *   environment: 'production',
 * });
 * ```
 */
export function createAuthConfig(options: AuthConfigOptions) {
  // Validate configuration
  validateConfig(options);

  const isDevelopment = options.environment === "development";
  const isProduction = options.environment === "production";

  logger.info("Creating Better-Auth configuration", {
    environment: options.environment,
    appName: options.appName,
  });

  // Create Better-Auth instance with Prisma adapter
  const auth = betterAuth({
    appName: options.appName || "Better-Auth App",
    baseURL: options.baseURL,
    secret: options.secret,

    // Prisma database adapter
    database: prismaAdapter(options.prisma, {
      provider: "postgresql", // Matches our database
    }),

    // Email and password authentication
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      requireEmailVerification: isProduction,
      // Password reset email handler
      sendResetPassword: async (data: {
        user: { id: string; email: string };
        url: string;
        token: string;
      }) => {
        logger.debug("Password reset requested", {
          userId: data.user.id,
          email: data.user.email,
        });
        // TODO: Integrate with email service
        if (isDevelopment) {
          logger.info("Password reset URL:", {
            url: data.url,
            token: data.token,
          });
        }
      },
    },

    // Email verification configuration (separate from emailAndPassword)
    emailVerification: {
      // Email verification handler
      sendVerificationEmail: async (data: {
        user: { id: string; email: string };
        url: string;
        token: string;
      }) => {
        logger.debug("Email verification requested", {
          userId: data.user.id,
          email: data.user.email,
        });
        // TODO: Integrate with email service
        if (isDevelopment) {
          logger.info("Verification URL:", {
            url: data.url,
            token: data.token,
          });
        }
      },
    },

    // Session configuration
    session: {
      expiresIn: 30 * 24 * 60 * 60, // 30 days in seconds
      updateAge: 24 * 60 * 60, // Update session every 24 hours (in seconds)
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60, // 5 minutes in seconds
      },
    },

    // Cookie configuration
    cookie: {
      name: "better-auth.session-token",
      httpOnly: true,
      secure: isProduction, // HTTPS only in production
      sameSite: isProduction ? "strict" : "lax",
      path: "/",
      // domain will be set automatically from baseURL
    },

    // Advanced options
    advanced: {
      // Use secure cookies in production
      useSecureCookies: isProduction,
      // Disable CSRF check if needed (not recommended in production)
      disableCSRFCheck: isDevelopment,
      cookiePrefix: "better-auth",
      defaultCookieAttributes: {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? "strict" : "lax",
      },
    },

    // Trust proxy headers (for load balancers, reverse proxies)
    trustProxy: options.trustProxy ?? false,

    // CORS configuration
    ...(options.corsOrigins && {
      cors: {
        origin: options.corsOrigins,
        credentials: true,
      },
    }),
  });

  logger.info("Better-Auth configuration created successfully");

  return auth;
}

/**
 * Configuration presets for different environments
 */
export const configPresets = {
  /**
   * Development preset
   * - Debug logging enabled
   * - Less strict security
   * - Email verification disabled
   */
  development: (
    prisma: PrismaClient,
    baseURL: string,
    secret: string
  ): AuthConfigOptions => ({
    prisma,
    baseURL,
    secret,
    environment: "development",
    debug: true,
    trustProxy: false,
    corsOrigins: ["http://localhost:3000", "http://localhost:5173"],
  }),

  /**
   * Production preset
   * - Strict security settings
   * - Email verification required
   * - HTTPS enforced
   */
  production: (
    prisma: PrismaClient,
    baseURL: string,
    secret: string
  ): AuthConfigOptions => ({
    prisma,
    baseURL,
    secret,
    environment: "production",
    debug: false,
    trustProxy: true,
    corsOrigins: [], // Set specific origins in production
  }),

  /**
   * Testing preset
   * - Fast configuration
   * - Minimal security checks
   * - No email verification
   */
  test: (
    prisma: PrismaClient,
    baseURL: string,
    secret: string
  ): AuthConfigOptions => ({
    prisma,
    baseURL,
    secret,
    environment: "test",
    debug: false,
    trustProxy: false,
    corsOrigins: ["*"],
  }),
};

/**
 * Get configuration from environment variables
 */
export function getConfigFromEnv(prisma: PrismaClient): AuthConfigOptions {
  const environment = (process.env["NODE_ENV"] ||
    "production") as AuthConfigOptions["environment"];
  const baseURL =
    process.env["BASE_URL"] || process.env["BETTER_AUTH_BASE_URL"];
  const secret =
    process.env["BETTER_AUTH_SECRET"] || process.env["AUTH_SECRET"];

  if (!baseURL) {
    throw new Error(
      "BASE_URL or BETTER_AUTH_BASE_URL environment variable is required"
    );
  }

  if (!secret) {
    throw new Error(
      "BETTER_AUTH_SECRET or AUTH_SECRET environment variable is required"
    );
  }

  const trustProxy = process.env["TRUST_PROXY"] === "true";
  const corsOrigins = process.env["CORS_ORIGINS"]
    ?.split(",")
    .map((o) => o.trim());

  return {
    prisma,
    baseURL,
    secret,
    environment: environment || "production",
    trustProxy,
    corsOrigins: corsOrigins || [],
    appName: process.env["APP_NAME"] || "Better-Auth App",
  };
}

/**
 * Export type for the created auth instance
 */
export type Auth = ReturnType<typeof createAuthConfig>;
