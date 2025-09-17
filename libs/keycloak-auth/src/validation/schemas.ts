import { z } from "zod";

/**
 * Zod schemas for comprehensive input validation
 * Provides type-safe validation for all inputs throughout the keycloak-auth library
 */

// ============================================================================
// ENVIRONMENT CONFIGURATION SCHEMAS
// ============================================================================

/**
 * Schema for raw environment configuration
 */
export const RawEnvironmentConfigSchema = z.object({
  KEYCLOAK_SERVER_URL: z
    .string()
    .url("KEYCLOAK_SERVER_URL must be a valid URL"),
  KEYCLOAK_REALM: z.string().min(1, "KEYCLOAK_REALM cannot be empty"),
  KEYCLOAK_FRONTEND_CLIENT_ID: z
    .string()
    .min(1, "KEYCLOAK_FRONTEND_CLIENT_ID cannot be empty"),
  KEYCLOAK_SERVICE_CLIENT_ID: z
    .string()
    .min(1, "KEYCLOAK_SERVICE_CLIENT_ID cannot be empty"),
  KEYCLOAK_SERVICE_CLIENT_SECRET: z.string().optional(),
  KEYCLOAK_TRACKER_CLIENT_ID: z
    .string()
    .min(1, "KEYCLOAK_TRACKER_CLIENT_ID cannot be empty"),
  KEYCLOAK_TRACKER_CLIENT_SECRET: z.string().optional(),
  KEYCLOAK_WEBSOCKET_CLIENT_ID: z
    .string()
    .min(1, "KEYCLOAK_WEBSOCKET_CLIENT_ID cannot be empty"),
  REDIS_URL: z
    .string()
    .url("REDIS_URL must be a valid URL")
    .default("redis://localhost:6379"),
  AUTH_CACHE_TTL: z
    .string()
    .regex(/^\d+$/, "AUTH_CACHE_TTL must be a number")
    .default("3600"),
  AUTH_INTROSPECTION_TTL: z
    .string()
    .regex(/^\d+$/, "AUTH_INTROSPECTION_TTL must be a number")
    .default("300"),
});

/**
 * Schema for validated environment configuration
 */
export const EnvironmentConfigSchema = z.object({
  KEYCLOAK_SERVER_URL: z.string().url(),
  KEYCLOAK_REALM: z.string().min(1),
  KEYCLOAK_FRONTEND_CLIENT_ID: z.string().min(1),
  KEYCLOAK_SERVICE_CLIENT_ID: z.string().min(1),
  KEYCLOAK_SERVICE_CLIENT_SECRET: z.string().optional(),
  KEYCLOAK_TRACKER_CLIENT_ID: z.string().min(1),
  KEYCLOAK_TRACKER_CLIENT_SECRET: z.string().optional(),
  KEYCLOAK_WEBSOCKET_CLIENT_ID: z.string().min(1),
  REDIS_URL: z.string().url(),
  AUTH_CACHE_TTL: z.number().int().positive(),
  AUTH_INTROSPECTION_TTL: z.number().int().positive(),
});

// ============================================================================
// TOKEN AND AUTHENTICATION SCHEMAS
// ============================================================================

/**
 * Schema for JWT token payload validation
 */
export const TokenPayloadSchema = z.object({
  iss: z.string().url("Issuer must be a valid URL"),
  sub: z.string().min(1, "Subject cannot be empty"),
  aud: z.union([z.string(), z.array(z.string())]),
  exp: z.number().int().positive("Expiration must be a positive integer"),
  iat: z.number().int().positive("Issued at must be a positive integer"),
  auth_time: z.number().int().positive().optional(),
  nonce: z.string().optional(),
  acr: z.string().optional(),
  amr: z.array(z.string()).optional(),
  azp: z.string().optional(),
  session_state: z.string().optional(),
  realm_access: z
    .object({
      roles: z.array(z.string()),
    })
    .optional(),
  resource_access: z
    .record(
      z.object({
        roles: z.array(z.string()),
      })
    )
    .optional(),
  scope: z.string().optional(),
  sid: z.string().optional(),
  email_verified: z.boolean().optional(),
  name: z.string().optional(),
  preferred_username: z.string().optional(),
  given_name: z.string().optional(),
  family_name: z.string().optional(),
  email: z.string().email().optional(),
  groups: z.array(z.string()).optional(),
  client_id: z.string().optional(),
});

/**
 * Schema for OAuth2 token response
 */
export const TokenResponseSchema = z.object({
  access_token: z.string().min(1, "Access token cannot be empty"),
  token_type: z.string().min(1, "Token type cannot be empty"),
  expires_in: z.number().int().positive("Expires in must be positive"),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
  id_token: z.string().optional(),
});

/**
 * Schema for token introspection response
 */
export const TokenIntrospectionResponseSchema = z.object({
  active: z.boolean(),
  client_id: z.string().optional(),
  exp: z.number().int().optional(),
  iat: z.number().int().optional(),
  iss: z.string().optional(),
  jti: z.string().optional(),
  scope: z.string().optional(),
  sub: z.string().optional(),
  token_type: z.string().optional(),
  username: z.string().optional(),
  aud: z.union([z.string(), z.array(z.string())]).optional(),
  nbf: z.number().int().optional(),
  auth_time: z.number().int().optional(),
  session_state: z.string().optional(),
  realm_access: z
    .object({
      roles: z.array(z.string()),
    })
    .optional(),
  resource_access: z
    .record(
      z.object({
        roles: z.array(z.string()),
      })
    )
    .optional(),
});

// ============================================================================
// WEBSOCKET SCHEMAS
// ============================================================================

/**
 * Schema for WebSocket connection parameters
 */
export const WebSocketConnectionParamsSchema = z.object({
  token: z.string().min(1, "Token cannot be empty"),
  userId: z.string().min(1, "User ID cannot be empty"),
  sessionId: z.string().min(1, "Session ID cannot be empty"),
  clientId: z.string().min(1, "Client ID cannot be empty"),
});

/**
 * Schema for WebSocket message validation
 */
export const WebSocketMessageSchema = z.object({
  type: z.enum(["subscribe", "unsubscribe", "ping", "pong", "data"]),
  topic: z.string().min(1, "Topic cannot be empty").optional(),
  data: z.any().optional(),
  timestamp: z.number().int().positive().optional(),
  id: z.string().optional(),
});

/**
 * Schema for WebSocket subscription request
 */
export const WebSocketSubscriptionSchema = z.object({
  action: z.enum(["subscribe", "unsubscribe"]),
  topics: z.array(z.string().min(1)).min(1, "At least one topic required"),
  filters: z.record(z.any()).optional(),
});

// ============================================================================
// CLIENT CONFIGURATION SCHEMAS
// ============================================================================

/**
 * Schema for client type validation
 */
export const ClientTypeSchema = z.enum([
  "frontend",
  "service",
  "tracker",
  "websocket",
]);

/**
 * Schema for client flow validation
 */
export const ClientFlowSchema = z.enum([
  "authorization_code",
  "client_credentials",
  "direct_grant",
  "websocket",
]);

/**
 * Schema for individual client configuration
 */
export const KeycloakClientConfigSchema = z.object({
  serverUrl: z.string().url(),
  realm: z.string().min(1),
  clientId: z.string().min(1),
  clientSecret: z.string().optional(),
  flow: ClientFlowSchema,
  type: ClientTypeSchema,
  scopes: z.array(z.string()),
  redirectUri: z.string().url().optional(),
});

/**
 * Schema for multi-client configuration
 */
export const KeycloakMultiClientConfigSchema = z.object({
  clients: z.object({
    frontend: KeycloakClientConfigSchema,
    service: KeycloakClientConfigSchema,
    tracker: KeycloakClientConfigSchema,
    websocket: KeycloakClientConfigSchema,
  }),
  discovery: z.object({
    cacheTimeout: z.number().int().positive(),
    retryAttempts: z.number().int().min(0).max(10),
  }),
  redis: z.object({
    keyPrefix: z.string(),
    tokenTtl: z.number().int().positive(),
    introspectionTtl: z.number().int().positive(),
  }),
});

// ============================================================================
// REQUEST VALIDATION SCHEMAS
// ============================================================================

/**
 * Schema for authorization code exchange request
 */
export const AuthorizationCodeRequestSchema = z.object({
  code: z.string().min(1, "Authorization code cannot be empty"),
  codeVerifier: z.string().optional(),
  redirectUri: z.string().url().optional(),
});

/**
 * Schema for refresh token request
 */
export const RefreshTokenRequestSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token cannot be empty"),
});

/**
 * Schema for client credentials request
 */
export const ClientCredentialsRequestSchema = z.object({
  clientId: z.string().min(1, "Client ID cannot be empty"),
  clientSecret: z.string().min(1, "Client secret cannot be empty"),
  scope: z.string().optional(),
});

/**
 * Schema for direct grant (password) request
 */
export const DirectGrantRequestSchema = z.object({
  username: z.string().min(1, "Username cannot be empty"),
  password: z.string().min(1, "Password cannot be empty"),
  scope: z.string().optional(),
});

/**
 * Schema for logout request
 */
export const LogoutRequestSchema = z.object({
  idTokenHint: z.string().optional(),
  postLogoutRedirectUri: z.string().url().optional(),
});

// ============================================================================
// JWK AND CRYPTO SCHEMAS
// ============================================================================

/**
 * Schema for RSA public key parameters
 */
export const RSAPublicKeySchema = z.object({
  kty: z.literal("RSA"),
  use: z.string().optional(),
  key_ops: z.array(z.string()).optional(),
  alg: z.string().optional(),
  kid: z.string().optional(),
  x5u: z.string().url().optional(),
  x5c: z.array(z.string()).optional(),
  x5t: z.string().optional(),
  "x5t#S256": z.string().optional(),
  n: z.string().min(1, "Modulus cannot be empty"),
  e: z.string().min(1, "Exponent cannot be empty"),
});

/**
 * Schema for EC public key parameters
 */
export const ECPublicKeySchema = z.object({
  kty: z.literal("EC"),
  use: z.string().optional(),
  key_ops: z.array(z.string()).optional(),
  alg: z.string().optional(),
  kid: z.string().optional(),
  x5u: z.string().url().optional(),
  x5c: z.array(z.string()).optional(),
  x5t: z.string().optional(),
  "x5t#S256": z.string().optional(),
  crv: z.string().min(1, "Curve cannot be empty"),
  x: z.string().min(1, "X coordinate cannot be empty"),
  y: z.string().min(1, "Y coordinate cannot be empty"),
});

/**
 * Schema for JSON Web Key
 */
export const JWKSchema = z.union([RSAPublicKeySchema, ECPublicKeySchema]);

/**
 * Schema for JWK Set
 */
export const JWKSetSchema = z.object({
  keys: z.array(JWKSchema),
});

// ============================================================================
// UTILITY SCHEMAS
// ============================================================================

/**
 * Schema for cache statistics
 */
export const CacheStatsSchema = z.object({
  size: z.number().int().min(0),
  maxSize: z.number().int().positive(),
  cleanupInterval: z.number().int().positive(),
  entries: z.array(
    z.object({
      key: z.string(),
      age: z.number().int().min(0),
      expiresIn: z.number().int().min(0),
    })
  ),
});

/**
 * Schema for circuit breaker statistics
 */
export const CircuitBreakerStatsSchema = z.object({
  successful: z.number().int().min(0),
  failure: z.number().int().min(0),
  timeout: z.number().int().min(0),
  shortCircuited: z.number().int().min(0),
});

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Type-safe validation helper with detailed error messages
 */
export function validateInput<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  context: string = "input"
): T {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessages = error.errors
        .map((err) => `${err.path.join(".")}: ${err.message}`)
        .join(", ");

      throw new Error(`Validation failed for ${context}: ${errorMessages}`);
    }
    throw new Error(`Unexpected validation error for ${context}: ${error}`);
  }
}

/**
 * Safe validation helper that returns null on failure
 */
export function safeValidateInput<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): T | null {
  try {
    return schema.parse(data);
  } catch {
    return null;
  }
}

// ============================================================================
// EXPORTED TYPES
// ============================================================================

export type RawEnvironmentConfig = z.infer<typeof RawEnvironmentConfigSchema>;
export type EnvironmentConfig = z.infer<typeof EnvironmentConfigSchema>;
export type TokenPayload = z.infer<typeof TokenPayloadSchema>;
export type TokenResponse = z.infer<typeof TokenResponseSchema>;
export type TokenIntrospectionResponse = z.infer<
  typeof TokenIntrospectionResponseSchema
>;
export type WebSocketConnectionParams = z.infer<
  typeof WebSocketConnectionParamsSchema
>;
export type WebSocketMessage = z.infer<typeof WebSocketMessageSchema>;
export type WebSocketSubscription = z.infer<typeof WebSocketSubscriptionSchema>;
export type ClientType = z.infer<typeof ClientTypeSchema>;
export type ClientFlow = z.infer<typeof ClientFlowSchema>;
export type KeycloakClientConfig = z.infer<typeof KeycloakClientConfigSchema>;
export type KeycloakMultiClientConfig = z.infer<
  typeof KeycloakMultiClientConfigSchema
>;
export type AuthorizationCodeRequest = z.infer<
  typeof AuthorizationCodeRequestSchema
>;
export type RefreshTokenRequest = z.infer<typeof RefreshTokenRequestSchema>;
export type ClientCredentialsRequest = z.infer<
  typeof ClientCredentialsRequestSchema
>;
export type DirectGrantRequest = z.infer<typeof DirectGrantRequestSchema>;
export type LogoutRequest = z.infer<typeof LogoutRequestSchema>;
export type JWK = z.infer<typeof JWKSchema>;
export type JWKSet = z.infer<typeof JWKSetSchema>;
export type CacheStats = z.infer<typeof CacheStatsSchema>;
export type CircuitBreakerStats = z.infer<typeof CircuitBreakerStatsSchema>;
