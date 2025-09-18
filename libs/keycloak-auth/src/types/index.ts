import { z } from "zod";

/**
 * Keycloak Authentication Library Types
 * Comprehensive TypeScript interfaces for all authentication flows
 * Updated to use Elysia WebSocket and existing cache infrastructure
 */

// =============================================================================
// WebSocket Types (Elysia/Bun WebSocket)
// =============================================================================

/**
 * Elysia WebSocket instance type (compatible with Bu/**
 * Environment configuration interface (raw values before validation)
 */
export interface RawEnvironmentConfig {
  KEYCLOAK_SERVER_URL: string;
  KEYCLOAK_REALM: string;
  KEYCLOAK_FRONTEND_CLIENT_ID: string;
  KEYCLOAK_SERVICE_CLIENT_ID: string;
  KEYCLOAK_SERVICE_CLIENT_SECRET: string;
  KEYCLOAK_TRACKER_CLIENT_ID: string;
  KEYCLOAK_TRACKER_CLIENT_SECRET: string;
  KEYCLOAK_WEBSOCKET_CLIENT_ID: string;
  REDIS_URL: string;
  AUTH_CACHE_TTL: string;
  AUTH_INTROSPECTION_TTL: string;
}

/**
 * Environment configuration interface (validated values)
 */
export interface EnvironmentConfig {
  KEYCLOAK_SERVER_URL: string;
  KEYCLOAK_REALM: string;
  KEYCLOAK_FRONTEND_CLIENT_ID: string;
  KEYCLOAK_SERVICE_CLIENT_ID: string;
  KEYCLOAK_SERVICE_CLIENT_SECRET: string;
  KEYCLOAK_TRACKER_CLIENT_ID: string;
  KEYCLOAK_TRACKER_CLIENT_SECRET: string;
  KEYCLOAK_WEBSOCKET_CLIENT_ID: string;
  REDIS_URL: string;
  AUTH_CACHE_TTL: number;
  AUTH_INTROSPECTION_TTL: number;
}

/**
 * WebSocket connection type from Elysia
 * This represents the WebSocket connection provided by Elysia
 */
export interface ElysiaWebSocket<T = any> {
  id: string;
  data: T;
  readyState: number;
  send(message: string | ArrayBuffer | Uint8Array): void;
  close(code?: number, reason?: string): void;
  subscribe(topic: string): void;
  unsubscribe(topic: string): void;
  publish(topic: string, message: string | ArrayBuffer | Uint8Array): void;
  isSubscribed(topic: string): boolean;
}

/**
 * Cache interface compatible with existing @libs/database cache
 */
export interface ITokenCacheService {
  get<T>(key: string): Promise<{
    data: T | null;
    source: string;
    latency: number;
    compressed: boolean;
  }>;
  set<T>(key: string, data: T, ttl?: number): Promise<void>;
  invalidate(key: string): Promise<void>;
  invalidatePattern(pattern: string): Promise<number>;
  getStats(): Promise<{
    hits: number;
    misses: number;
    hitRate: number;
  }>;
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Supported OAuth 2.1 / OpenID Connect flows
 */
export type AuthenticationFlow =
  | "authorization_code"
  | "client_credentials"
  | "direct_grant"
  | "websocket";

/**
 * Client types for different service integrations
 */
export type ClientType =
  | "frontend" // SPA Authorization Code flow
  | "service" // Service-to-service Client Credentials
  | "tracker" // TrackerJS Direct Grant (limited)
  | "websocket"; // WebSocket connections

/**
 * Keycloak client configuration schema
 */
export const KeycloakClientConfigSchema = z.object({
  realm: z.string(),
  serverUrl: z.string().url(),
  clientId: z.string(),
  clientSecret: z.string().optional(),
  redirectUri: z.string().url().optional(),
  scopes: z.array(z.string()).default(["openid"]),
  flow: z.enum([
    "authorization_code",
    "client_credentials",
    "direct_grant",
    "websocket",
  ]),
  type: z.enum(["frontend", "service", "tracker", "websocket"]),
});

export type KeycloakClientConfig = z.infer<typeof KeycloakClientConfigSchema>;

/**
 * Multi-client configuration for different service types
 */
export interface KeycloakMultiClientConfig {
  clients: {
    frontend: KeycloakClientConfig;
    service: KeycloakClientConfig;
    tracker: KeycloakClientConfig;
    websocket: KeycloakClientConfig;
  };
  discovery: {
    cacheTimeout: number; // seconds
    retryAttempts: number;
  };
  redis: {
    keyPrefix: string;
    tokenTtl: number; // seconds
    introspectionTtl: number; // seconds
  };
}

// =============================================================================
// Token Types
// =============================================================================

/**
 * JWT token claims structure
 */
export interface TokenClaims {
  iss: string; // Issuer
  sub: string; // Subject (user ID)
  aud: string | string[]; // Audience
  exp: number; // Expiration time
  iat: number; // Issued at
  auth_time?: number; // Authentication time
  nonce?: string; // Nonce for replay protection
  azp?: string; // Authorized party
  session_state?: string; // Session state
  acr?: string; // Authentication context class reference
  scope?: string; // Granted scopes
  email?: string; // User email
  email_verified?: boolean;
  name?: string; // Full name
  preferred_username?: string;
  given_name?: string;
  family_name?: string;
  realm_access?: {
    roles: string[];
  };
  resource_access?: {
    [clientId: string]: {
      roles: string[];
    };
  };
}

/**
 * Token introspection response from Keycloak
 */
export interface TokenIntrospectionResponse {
  active: boolean;
  scope?: string;
  client_id?: string;
  username?: string;
  token_type?: string;
  exp?: number;
  iat?: number;
  sub?: string;
  aud?: string | string[];
  iss?: string;
  jti?: string;
  [claim: string]: unknown;
}

/**
 * Token validation result
 */
export interface TokenValidationResult {
  valid: boolean;
  claims?: TokenClaims;
  error?: string;
  cached: boolean;
  introspected?: boolean;
}

// =============================================================================
// WebSocket Types
// =============================================================================

/**
 * WebSocket authentication methods
 */
export type WebSocketAuthMethod =
  | "jwt_token" // JWT in headers or query
  | "api_key" // API key authentication
  | "session_based"; // Session-based auth

/**
 * WebSocket connection authentication context for Elysia WebSocket
 */
export interface WebSocketAuthContext {
  method: WebSocketAuthMethod;
  token?: string;
  refreshToken?: string;
  claims?: TokenClaims;
  sessionId?: string;
  clientId: string;
  userId?: string;
  scopes: string[];
  permissions: string[];
  connectionId: string;
  connectedAt: Date;
  lastValidated: Date;
}

/**
 * WebSocket data that gets stored in ws.data for Elysia WebSocket
 */
export interface WebSocketConnectionData {
  auth: WebSocketAuthContext;
  query: Record<string, string>;
  headers: Record<string, string>;
  connectionTime: number;
}

/**
 * WebSocket message authentication requirements
 */
export interface WebSocketMessageAuth {
  requiresAuth: boolean;
  requiredScopes?: string[];
  requiredPermissions?: string[];
  channel?: string;
  action?: string;
}

/**
 * WebSocket authentication configuration for Elysia
 */
export interface WebSocketAuthConfig {
  connectionAuth: {
    enabled: boolean;
    methods: WebSocketAuthMethod[];
    tokenSources: ("header" | "query" | "cookie")[];
    fallbackToAnonymous: boolean;
  };
  messageAuth: {
    enabled: boolean;
    validateOnSensitiveActions: boolean;
    requiredActionsPattern: RegExp[];
  };
  session: {
    enableRefresh: boolean;
    refreshInterval: number; // seconds
    maxIdleTime: number; // seconds
  };
}

// =============================================================================
// Middleware Types
// =============================================================================

/**
 * Authentication middleware options
 */
export interface AuthMiddlewareOptions {
  flows: AuthenticationFlow[];
  requiredScopes?: string[];
  requiredPermissions?: string[];
  bypassRoutes?: string[];
  validateAllRequests?: boolean;
  cacheTokens?: boolean;
  introspectOpaque?: boolean;
}

/**
 * User representation from Keycloak authentication
 */
export interface User {
  id: string;
  email: string;
  name: string;
  roles: string[];
  permissions: string[];
  client: ClientType;
  context: {
    clientId: string;
    issuer: string;
    issuedAt: Date;
    expiresAt: Date;
  };
  isActive: boolean;
  lastLogin: Date;
  preferences: Record<string, unknown>;
}

/**
 * Authentication context attached to Elysia request
 */
export interface AuthContext {
  authenticated: boolean;
  method: "jwt" | "introspection" | "api_key" | "none";
  token?: string;
  claims?: TokenClaims;
  clientId?: string;
  userId?: string;
  scopes: string[];
  permissions: string[];
  sessionId?: string;
  validatedAt: Date;
  cached: boolean;
}

/**
 * Rate limiting configuration for authentication
 */
export interface AuthRateLimitConfig {
  tokenValidation: {
    windowMs: number;
    maxRequests: number;
    keyGenerator: (token: string) => string;
  };
  failedAttempts: {
    windowMs: number;
    maxAttempts: number;
    blockDuration: number;
  };
  bruteForce: {
    enabled: boolean;
    maxFailedAttempts: number;
    lockoutDuration: number;
    progressiveDelay: boolean;
  };
}

// =============================================================================
// Service Types
// =============================================================================

/**
 * Token cache service interface
 */
export interface ITokenCacheService {
  get<T>(key: string): Promise<{
    data: T | null;
    source: string;
    latency: number;
    compressed: boolean;
  }>;
  set<T>(key: string, data: T, ttl?: number): Promise<void>;
  invalidate(key: string): Promise<void>;
  invalidatePattern(pattern: string): Promise<number>;
  getStats(): Promise<{
    hits: number;
    misses: number;
    hitRate: number;
  }>;
}

/**
 * Token introspection service interface
 */
export interface ITokenIntrospectionService {
  introspect(
    token: string,
    clientConfig: KeycloakClientConfig
  ): Promise<TokenIntrospectionResponse>;
  validateJWT(
    token: string,
    clientConfig: KeycloakClientConfig
  ): Promise<TokenValidationResult>;
  getPublicKey(keyId: string, realm: string): Promise<string>;
  refreshPublicKeys(realm: string): Promise<void>;
}

/**
 * Keycloak client factory interface
 */
export interface IKeycloakClientFactory {
  getClient(type: ClientType): KeycloakClientConfig;
  getDiscoveryDocument(realm: string): Promise<any>;
  createAuthorizationUrl(
    state: string,
    nonce: string,
    codeChallenge?: string
  ): Promise<string>;
  createPKCEAuthorizationUrl(
    state: string,
    nonce: string
  ): Promise<{
    authorizationUrl: string;
    codeVerifier: string;
    codeChallenge: string;
  }>;
  exchangeCodeForToken(
    code: string,
    codeVerifier?: string
  ): Promise<TokenResponse>;
  exchangePKCECodeForToken(code: string, state: string): Promise<TokenResponse>;
  refreshToken(refreshToken: string): Promise<TokenResponse>;
  getClientCredentialsToken(
    clientType?: "service" | "tracker"
  ): Promise<TokenResponse>;
  logout(idTokenHint?: string): Promise<string>;
}

// =============================================================================
// Response Types
// =============================================================================

/**
 * OAuth 2.1 token response
 */
export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
  [key: string]: unknown;
}

/**
 * Authentication flow result
 */
export interface AuthFlowResult {
  success: boolean;
  authContext?: AuthContext;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  redirectUrl?: string;
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Custom authentication error types
 */
export class AuthenticationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 401,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class TokenValidationError extends AuthenticationError {
  constructor(message: string, details?: unknown) {
    super(message, "TOKEN_VALIDATION_ERROR", 401, details);
    this.name = "TokenValidationError";
  }
}

export class WebSocketAuthError extends AuthenticationError {
  constructor(message: string, details?: unknown) {
    super(message, "WEBSOCKET_AUTH_ERROR", 401, details);
    this.name = "WebSocketAuthError";
  }
}

export class PermissionError extends Error {
  constructor(
    message: string,
    public readonly requiredPermissions: string[],
    public readonly userPermissions: string[]
  ) {
    super(message);
    this.name = "PermissionError";
  }
}

// =============================================================================
// Utility Types
// =============================================================================

/**
 * Environment configuration type
 */
export interface EnvironmentConfig {
  KEYCLOAK_SERVER_URL: string;
  KEYCLOAK_REALM: string;
  KEYCLOAK_FRONTEND_CLIENT_ID: string;
  KEYCLOAK_SERVICE_CLIENT_ID: string;
  KEYCLOAK_SERVICE_CLIENT_SECRET: string;
  KEYCLOAK_TRACKER_CLIENT_ID: string;
  KEYCLOAK_TRACKER_CLIENT_SECRET: string;
  KEYCLOAK_WEBSOCKET_CLIENT_ID: string;
  REDIS_URL: string;
  AUTH_CACHE_TTL: number;
  AUTH_INTROSPECTION_TTL: number;
}

/**
 * Monitoring and metrics types
 */
export interface AuthMetrics {
  tokenValidations: number;
  cacheHits: number;
  cacheMisses: number;
  introspectionCalls: number;
  failedAuthentications: number;
  webSocketConnections: number;
  activeWebSocketSessions: number;
}

/**
 * Type guards for runtime validation
 */
export const isTokenClaims = (obj: unknown): obj is TokenClaims => {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "iss" in obj &&
    "sub" in obj &&
    "aud" in obj &&
    "exp" in obj &&
    "iat" in obj
  );
};

export const isWebSocketAuthContext = (
  obj: unknown
): obj is WebSocketAuthContext => {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "method" in obj &&
    "clientId" in obj &&
    "connectionId" in obj
  );
};

/**
 * Configuration validation schemas
 */
export const EnvironmentConfigSchema = z.object({
  KEYCLOAK_SERVER_URL: z.string().url(),
  KEYCLOAK_REALM: z.string().min(1),
  KEYCLOAK_FRONTEND_CLIENT_ID: z.string().min(1),
  KEYCLOAK_SERVICE_CLIENT_ID: z.string().min(1),
  KEYCLOAK_SERVICE_CLIENT_SECRET: z.string().min(1),
  KEYCLOAK_TRACKER_CLIENT_ID: z.string().min(1),
  KEYCLOAK_TRACKER_CLIENT_SECRET: z.string().min(1),
  KEYCLOAK_WEBSOCKET_CLIENT_ID: z.string().min(1),
  REDIS_URL: z.string().url(),
  AUTH_CACHE_TTL: z.string().regex(/^\d+$/).transform(Number),
  AUTH_INTROSPECTION_TTL: z.string().regex(/^\d+$/).transform(Number),
});

export type ValidatedEnvironmentConfig = z.infer<
  typeof EnvironmentConfigSchema
>;

// Re-export types from services for convenience
export type {
  AuthorizationDecision,
  ResourceRepresentation,
  PolicyRepresentation,
  PermissionTicket,
  AuthorizationContext,
} from "../services/keycloak-authorization-services";

export type {
  RoleHierarchy,
  PermissionScope,
  RBACDecision,
  RBACConfiguration,
} from "../services/enhanced-rbac";
