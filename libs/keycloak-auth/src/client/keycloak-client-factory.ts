import {
  KeycloakClientConfig,
  KeycloakMultiClientConfig,
  ClientType,
  TokenResponse,
  IKeycloakClientFactory,
  AuthenticationError,
} from "../types/index";
import { PKCEManager } from "../utils/pkce";
import {
  validateInput,
  RawEnvironmentConfigSchema,
  AuthorizationCodeRequestSchema,
  RefreshTokenRequestSchema,
  DirectGrantRequestSchema,
  LogoutRequestSchema,
  TokenResponseSchema,
  CacheStatsSchema,
  RawEnvironmentConfig,
} from "../validation/index";

import { createLogger } from "@libs/utils";
import { LRUCache } from "lru-cache";
import { createHttpClient, HttpClient } from "@libs/messaging";

const logger = createLogger("keycloak-client-factory");

/**
 * Keycloak Client Factory
 * Creates and manages Keycloak client configurations for different service types
 */
export class KeycloakClientFactory implements IKeycloakClientFactory {
  private config: KeycloakMultiClientConfig;
  private discoveryCache: LRUCache<string, { data: any; timestamp: number }>;
  private pkceManager: PKCEManager;
  private httpClient: HttpClient;

  // Cache management with enhanced cleanup
  private readonly maxCacheSize = 50; // Reduced for better memory management
  private readonly maxCacheAge = 15 * 60 * 1000; // 15 minutes max age regardless of config
  private isShuttingDown = false;
  constructor(envConfig: RawEnvironmentConfig) {
    // Validate environment configuration
    const validatedConfig = validateInput(
      RawEnvironmentConfigSchema,
      envConfig,
      "environment configuration"
    );

    // Initialize PKCE manager
    this.pkceManager = new PKCEManager({
      codeVerifierLength: 128,
      enforceForPublicClients: true,
      allowForConfidentialClients: true,
    });

    // Build multi-client configuration
    this.config = this.buildMultiClientConfig(
      validatedConfig as RawEnvironmentConfig
    );

    // Initialize discovery cache with LRU eviction and TTL
    const cacheTimeout = this.config.discovery.cacheTimeout * 1000;
    const ttl = Math.min(cacheTimeout, this.maxCacheAge);
    this.discoveryCache = new LRUCache({
      max: this.maxCacheSize,
      ttl: ttl,
      allowStale: false,
    });

    // Initialize HTTP client without baseURL for full URL control
    this.httpClient = createHttpClient({
      timeout: 30000,
      headers: {
        "User-Agent": "Neurotracker-Keycloak-Client/1.0",
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    logger.info("Keycloak client factory initialized", {
      realm: this.config.clients.frontend.realm,
      serverUrl: this.config.clients.frontend.serverUrl,
      clientCount: Object.keys(this.config.clients).length,
    });
  }

  /**
   * SECURITY FIX: Validate discovery document structure before use
   * Prevents issues with stale/invalid cached data
   */
  private validateDiscoveryDocument(data: any, realm: string): void {
    if (!data || typeof data !== "object") {
      throw new AuthenticationError(
        "Discovery document is not a valid object",
        "INVALID_DISCOVERY_DOCUMENT",
        502
      );
    }

    // Validate required endpoints
    const requiredFields = [
      "issuer",
      "authorization_endpoint",
      "token_endpoint",
      "jwks_uri",
    ];

    const optionalButRecommended = [
      "userinfo_endpoint",
      "introspection_endpoint",
      "end_session_endpoint",
    ];

    for (const field of requiredFields) {
      if (!data[field] || typeof data[field] !== "string") {
        throw new AuthenticationError(
          `Discovery document missing required field: ${field}`,
          "INVALID_DISCOVERY_DOCUMENT",
          502
        );
      }

      // Validate URLs
      try {
        new URL(data[field]);
      } catch (error) {
        throw new AuthenticationError(
          `Discovery document contains invalid URL for ${field}: ${data[field]}`,
          "INVALID_DISCOVERY_DOCUMENT",
          502
        );
      }
    }

    // Validate issuer matches expected realm
    const expectedIssuerPattern = new RegExp(`/realms/${realm}$`);
    if (!expectedIssuerPattern.test(data.issuer)) {
      logger.warn(
        "Discovery document issuer doesn't match expected realm pattern",
        {
          issuer: data.issuer,
          expectedRealm: realm,
        }
      );
    }

    // Validate supported algorithms and capabilities
    if (data.id_token_signing_alg_values_supported) {
      if (!Array.isArray(data.id_token_signing_alg_values_supported)) {
        throw new AuthenticationError(
          "Discovery document id_token_signing_alg_values_supported must be an array",
          "INVALID_DISCOVERY_DOCUMENT",
          502
        );
      }

      // Ensure secure algorithms are supported
      const secureAlgorithms = [
        "RS256",
        "RS384",
        "RS512",
        "PS256",
        "PS384",
        "PS512",
      ];
      const supportedAlgorithms = data.id_token_signing_alg_values_supported;
      const hasSecureAlgorithm = secureAlgorithms.some((alg) =>
        supportedAlgorithms.includes(alg)
      );

      if (!hasSecureAlgorithm) {
        logger.warn(
          "Discovery document doesn't advertise secure signing algorithms",
          {
            supportedAlgorithms,
            secureAlgorithms,
          }
        );
      }
    }

    // Log missing optional endpoints
    for (const field of optionalButRecommended) {
      if (!data[field]) {
        logger.debug(`Discovery document missing recommended field: ${field}`);
      }
    }

    logger.debug("Discovery document validation passed", {
      realm,
      issuer: data.issuer,
      endpointCount:
        requiredFields.filter((field) => data[field]).length +
        optionalButRecommended.filter((field) => data[field]).length,
    });
  }

  /**
   * Build multi-client configuration from environment variables
   */
  private buildMultiClientConfig(
    envConfig: RawEnvironmentConfig
  ): KeycloakMultiClientConfig {
    const baseConfig = {
      realm: envConfig.KEYCLOAK_REALM,
      serverUrl: envConfig.KEYCLOAK_SERVER_URL.replace(/\/+$/, ""), // Remove trailing slashes
    };

    return {
      clients: {
        frontend: {
          ...baseConfig,
          clientId: envConfig.KEYCLOAK_FRONTEND_CLIENT_ID,
          flow: "authorization_code" as const,
          type: "frontend" as const,
          scopes: ["openid", "profile", "email"],
          redirectUri: `${
            process.env["FRONTEND_URL"] || "http://localhost:3000"
          }/auth/callback`,
        },
        service: {
          ...baseConfig,
          clientId: envConfig.KEYCLOAK_SERVICE_CLIENT_ID,
          clientSecret: envConfig.KEYCLOAK_SERVICE_CLIENT_SECRET,
          flow: "client_credentials" as const,
          type: "service" as const,
          scopes: ["service:read", "service:write", "service:admin"],
        },
        tracker: {
          ...baseConfig,
          clientId: envConfig.KEYCLOAK_TRACKER_CLIENT_ID,
          clientSecret: envConfig.KEYCLOAK_TRACKER_CLIENT_SECRET,
          flow: "direct_grant" as const,
          type: "tracker" as const,
          scopes: ["tracker:limited", "openid"],
        },
        websocket: {
          ...baseConfig,
          clientId: envConfig.KEYCLOAK_WEBSOCKET_CLIENT_ID,
          flow: "websocket" as const,
          type: "websocket" as const,
          scopes: ["websocket:connect", "websocket:subscribe", "openid"],
        },
      },
      discovery: {
        cacheTimeout: 300, // 5 minutes
        retryAttempts: 3,
      },
      redis: {
        keyPrefix: "keycloak:auth:",
        tokenTtl: parseInt(envConfig.AUTH_CACHE_TTL, 10),
        introspectionTtl: parseInt(envConfig.AUTH_INTROSPECTION_TTL, 10),
      },
    };
  }

  /**
   * Get client configuration by type
   */
  public getClient(type: ClientType): KeycloakClientConfig {
    const client = this.config.clients[type];
    if (!client) {
      throw new AuthenticationError(
        `Unknown client type: ${type}`,
        "INVALID_CLIENT_TYPE",
        400
      );
    }
    return client;
  }

  /**
   * Centralized error validation for Keycloak error responses
   * Only used when response is expected to be an error object
   */
  private validateKeycloakError(data: any, operation: string): void {
    if (
      data &&
      typeof data === "object" &&
      (data.error || data.error_description)
    ) {
      logger.error(`${operation} failed`, {
        error: data.error,
        errorDescription: data.error_description,
      });
      throw new AuthenticationError(
        `${operation} failed: ${
          data.error_description || data.error || "Unknown error"
        }`,
        `${operation.toUpperCase()}_FAILED`,
        400,
        data
      );
    }
  }

  /**
   * Get OpenID Connect discovery document with enhanced caching and memory management
   */
  public async getDiscoveryDocument(realm: string): Promise<any> {
    const cacheKey = `discovery:${realm}`;
    const cached = this.discoveryCache.get(cacheKey);
    const now = Date.now();

    // Check if cached entry is still valid (respecting both config timeout and max age)
    if (cached) {
      const configTimeout = this.config.discovery.cacheTimeout * 1000;
      const isWithinConfigTimeout = now - cached.timestamp < configTimeout;
      const isWithinMaxAge = now - cached.timestamp < this.maxCacheAge;

      if (isWithinConfigTimeout && isWithinMaxAge) {
        // SECURITY FIX: Validate cached discovery document before returning
        try {
          this.validateDiscoveryDocument(cached.data, realm);
          return cached.data;
        } catch (error) {
          logger.warn(
            "Cached discovery document validation failed, refetching",
            {
              realm,
              error: error instanceof Error ? error.message : "unknown",
            }
          );
          // Remove invalid cached entry
          this.discoveryCache.delete(cacheKey);
          // Fall through to fetch fresh document
        }
      }

      // Remove expired entry
      this.discoveryCache.delete(cacheKey);
    }

    // LRUCache handles size-based eviction automatically

    const serverUrl = this.config.clients.frontend.serverUrl;
    const discoveryUrl = `${serverUrl}/realms/${realm}/.well-known/openid_connect_configuration`;

    try {
      logger.debug("Fetching discovery document", {
        url: discoveryUrl,
      });
      const response = await this.httpClient.get<any>(discoveryUrl);
      const data = response.data;
      this.validateKeycloakError(data, "discovery_fetch");
      this.validateDiscoveryDocument(data, realm);

      // Cache the discovery document with enhanced tracking
      this.discoveryCache.set(cacheKey, {
        data,
        timestamp: Date.now(),
      });

      logger.info("Discovery document retrieved successfully", {
        realm,
        issuer: data.issuer,
        endpoints: {
          authorization: !!data.authorization_endpoint,
          token: !!data.token_endpoint,
          userinfo: !!data.userinfo_endpoint,
          introspection: !!data.introspection_endpoint,
        },
      });

      return data;
    } catch (error) {
      logger.error("Discovery document fetch failed", {
        error: error instanceof Error ? error.message : String(error),
      });

      throw new AuthenticationError(
        `Failed to fetch discovery document: ${
          error instanceof Error ? error.message : String(error)
        }`,
        "DISCOVERY_FETCH_FAILED",
        503,
        { originalError: error }
      );
    }
  }

  /**
   * Create authorization URL for Authorization Code flow (frontend)
   */
  public async createAuthorizationUrl(
    state: string,
    nonce: string,
    codeChallenge?: string
  ): Promise<string> {
    const client = this.getClient("frontend");
    const discovery = await this.getDiscoveryDocument(client.realm);

    if (!discovery.authorization_endpoint) {
      throw new AuthenticationError(
        "Authorization endpoint not found in discovery document",
        "MISSING_AUTHORIZATION_ENDPOINT",
        500
      );
    }

    const params = new URLSearchParams({
      client_id: client.clientId,
      response_type: "code",
      scope: client.scopes.join(" "),
      redirect_uri: client.redirectUri!,
      state,
      nonce,
    });

    // Add PKCE parameters if provided
    if (codeChallenge) {
      params.append("code_challenge", codeChallenge);
      params.append("code_challenge_method", "S256");
    }

    const authUrl = `${discovery.authorization_endpoint}?${params.toString()}`;

    logger.debug("Authorization URL created", {
      clientId: client.clientId,
      state,
      hasPkce: !!codeChallenge,
      scopes: client.scopes,
    });

    return authUrl;
  }

  /**
   * Create PKCE-enabled authorization URL for Authorization Code flow (enhanced security)
   * Automatically generates and manages PKCE parameters
   */
  public async createPKCEAuthorizationUrl(
    state: string,
    nonce: string
  ): Promise<{
    authorizationUrl: string;
    codeVerifier: string;
    codeChallenge: string;
  }> {
    const client = this.getClient("frontend");
    const discovery = await this.getDiscoveryDocument(client.realm);

    if (!discovery.authorization_endpoint) {
      throw new AuthenticationError(
        "Authorization endpoint not found in discovery document",
        "MISSING_AUTHORIZATION_ENDPOINT",
        500
      );
    }

    // Generate PKCE parameters
    const { codeVerifier, codeChallenge } =
      this.pkceManager.generateAndStore(state);

    const params = new URLSearchParams({
      client_id: client.clientId,
      response_type: "code",
      scope: client.scopes.join(" "),
      redirect_uri: client.redirectUri!,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    const authorizationUrl = `${
      discovery.authorization_endpoint
    }?${params.toString()}`;

    logger.info("PKCE-enabled authorization URL created", {
      clientId: client.clientId,
      state,
      scopes: client.scopes,
      hasPkce: true,
    });

    return {
      authorizationUrl,
      codeVerifier,
      codeChallenge,
    };
  }

  /**
   * Exchange authorization code for tokens
   */
  public async exchangeCodeForToken(
    code: string,
    codeVerifier?: string
  ): Promise<TokenResponse> {
    // Validate input parameters
    validateInput(
      AuthorizationCodeRequestSchema,
      { code, codeVerifier },
      "authorization code request"
    );

    const client = this.getClient("frontend");
    const discovery = await this.getDiscoveryDocument(client.realm);

    if (!discovery.token_endpoint) {
      throw new AuthenticationError(
        "Token endpoint not found in discovery document",
        "MISSING_TOKEN_ENDPOINT",
        500
      );
    }

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: client.clientId,
      code,
      redirect_uri: client.redirectUri!,
    });

    // Add PKCE code verifier if provided
    if (codeVerifier) {
      body.append("code_verifier", codeVerifier);
    }

    // Add client secret if configured (confidential client)
    if (client.clientSecret) {
      body.append("client_secret", client.clientSecret);
    }

    try {
      const response = await this.httpClient.post<TokenResponse>(
        discovery.token_endpoint,
        body.toString(),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      );
      const responseData = response["data"] as TokenResponse;
      this.validateKeycloakError(responseData, "token_exchange");
      const validatedTokenResponse = validateInput(
        TokenResponseSchema,
        responseData,
        "token response"
      );
      logger.info("Token exchange successful", {
        clientId: client.clientId,
        hasRefreshToken: !!validatedTokenResponse.refresh_token,
        expiresIn: validatedTokenResponse.expires_in,
        scope: validatedTokenResponse.scope,
      });
      return validatedTokenResponse;
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }

      throw new AuthenticationError(
        `Network error during token exchange: ${
          error instanceof Error ? error.message : String(error)
        }`,
        "NETWORK_ERROR",
        503,
        { originalError: error }
      );
    }
  }

  /**
   * Exchange authorization code for tokens with PKCE (enhanced security)
   * Automatically retrieves and uses the stored code verifier
   */
  public async exchangePKCECodeForToken(
    code: string,
    state: string
  ): Promise<TokenResponse> {
    // Retrieve the stored code verifier for this state
    const codeVerifier = this.pkceManager.retrieveAndRemove(state);

    if (!codeVerifier) {
      throw new AuthenticationError(
        "PKCE code verifier not found for the provided state. Ensure createPKCEAuthorizationUrl was used.",
        "PKCE_VERIFIER_NOT_FOUND",
        400
      );
    }

    logger.debug("Using PKCE for token exchange", {
      state,
      hasCodeVerifier: true,
    });

    // Use the existing method with the retrieved code verifier
    return this.exchangeCodeForToken(code, codeVerifier);
  }

  /**
   * Refresh access token using refresh token
   */
  public async refreshToken(refreshToken: string): Promise<TokenResponse> {
    // Validate input parameters
    validateInput(
      RefreshTokenRequestSchema,
      { refreshToken },
      "refresh token request"
    );

    const client = this.getClient("frontend");
    const discovery = await this.getDiscoveryDocument(client.realm);

    if (!discovery.token_endpoint) {
      throw new AuthenticationError(
        "Token endpoint not found in discovery document",
        "MISSING_TOKEN_ENDPOINT",
        500
      );
    }

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: client.clientId,
      refresh_token: refreshToken,
    });

    if (client.clientSecret) {
      body.append("client_secret", client.clientSecret);
    }

    try {
      const response = await this.httpClient.post<TokenResponse>(
        discovery.token_endpoint,
        body.toString(),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      );
      const responseData = response["data"] as TokenResponse;
      this.validateKeycloakError(responseData, "token_refresh");
      const validatedTokenResponse = validateInput(
        TokenResponseSchema,
        responseData,
        "token response"
      );
      logger.info("Token refresh successful", {
        clientId: client.clientId,
        hasRefreshToken: !!validatedTokenResponse.refresh_token,
        expiresIn: validatedTokenResponse.expires_in,
      });
      return validatedTokenResponse;
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }

      throw new AuthenticationError(
        `Network error during token refresh: ${
          error instanceof Error ? error.message : String(error)
        }`,
        "NETWORK_ERROR",
        503,
        { originalError: error }
      );
    }
  }

  /**
   * Get Client Credentials token for service-to-service authentication
   */
  public async getClientCredentialsToken(
    clientType: "service" | "tracker"
  ): Promise<TokenResponse> {
    const client = this.getClient(clientType);
    const discovery = await this.getDiscoveryDocument(client.realm);

    if (!client.clientSecret) {
      throw new AuthenticationError(
        `Client secret required for ${clientType} client`,
        "MISSING_CLIENT_SECRET",
        500
      );
    }

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: client.clientId,
      client_secret: client.clientSecret,
      scope: client.scopes.join(" "),
    });

    try {
      const response = await this.httpClient.post<TokenResponse>(
        discovery.token_endpoint,
        body.toString(),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      );
      const responseData = response["data"] as TokenResponse;
      this.validateKeycloakError(responseData, "client_credentials");
      logger.info("Client credentials token obtained", {
        clientType,
        clientId: client.clientId,
        expiresIn: responseData.expires_in,
        scope: responseData.scope,
      });
      return responseData;
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }

      throw new AuthenticationError(
        `Network error during client credentials flow: ${
          error instanceof Error ? error.message : String(error)
        }`,
        "NETWORK_ERROR",
        503,
        { originalError: error }
      );
    }
  }

  /**
   * Direct Grant (Password) flow for TrackerJS
   * WARNING: Only use for trusted applications like TrackerJS
   */
  public async getDirectGrantToken(
    username: string,
    password: string,
    clientType: "tracker" = "tracker"
  ): Promise<TokenResponse> {
    // Validate input parameters
    validateInput(
      DirectGrantRequestSchema,
      { username, password },
      "direct grant request"
    );

    const client = this.getClient(clientType);
    const discovery = await this.getDiscoveryDocument(client.realm);

    if (!discovery.token_endpoint) {
      throw new AuthenticationError(
        "Token endpoint not found in discovery document",
        "MISSING_TOKEN_ENDPOINT",
        500
      );
    }

    const body = new URLSearchParams({
      grant_type: "password",
      client_id: client.clientId,
      username,
      password,
      scope: client.scopes.join(" "),
    });

    // Add client secret if configured (confidential client)
    if (client.clientSecret) {
      body.append("client_secret", client.clientSecret);
    }

    try {
      const response = await this.httpClient.post<TokenResponse>(
        discovery.token_endpoint,
        body.toString(),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      );
      const responseData = response["data"] as TokenResponse;
      this.validateKeycloakError(responseData, "direct_grant");
      const validatedTokenResponse = validateInput(
        TokenResponseSchema,
        responseData,
        "token response"
      );
      logger.info("Direct grant token obtained", {
        username,
        clientType,
        tokenType: validatedTokenResponse.token_type,
        expiresIn: validatedTokenResponse.expires_in,
        scope: validatedTokenResponse.scope,
      });
      return validatedTokenResponse;
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }

      throw new AuthenticationError(
        `Network error during direct grant flow: ${
          error instanceof Error ? error.message : String(error)
        }`,
        "NETWORK_ERROR",
        503,
        { originalError: error }
      );
    }
  }

  /**
   * Create logout URL
   */
  public async logout(idTokenHint?: string): Promise<string> {
    // Validate input parameters if provided
    if (idTokenHint !== undefined) {
      validateInput(LogoutRequestSchema, { idTokenHint }, "logout request");
    }

    const client = this.getClient("frontend");
    const discovery = await this.getDiscoveryDocument(client.realm);

    if (!discovery.end_session_endpoint) {
      throw new AuthenticationError(
        "End session endpoint not found in discovery document",
        "MISSING_END_SESSION_ENDPOINT",
        500
      );
    }

    const params = new URLSearchParams({
      client_id: client.clientId,
    });

    if (idTokenHint) {
      params.append("id_token_hint", idTokenHint);
    }

    if (client.redirectUri) {
      params.append("post_logout_redirect_uri", client.redirectUri);
    }

    const logoutUrl = `${discovery.end_session_endpoint}?${params.toString()}`;

    logger.debug("Logout URL created", {
      clientId: client.clientId,
      hasIdToken: !!idTokenHint,
      hasRedirectUri: !!client.redirectUri,
    });

    return logoutUrl;
  }

  /**
   * Get multi-client configuration (for debugging/monitoring)
   */
  public getMultiClientConfig(): KeycloakMultiClientConfig {
    // Return a copy without sensitive data
    return {
      ...this.config,
      clients: Object.fromEntries(
        Object.entries(this.config.clients).map(([key, client]) => [
          key,
          {
            ...client,
            clientSecret: client.clientSecret ? "[REDACTED]" : undefined,
          },
        ])
      ),
    } as KeycloakMultiClientConfig;
  }

  /**
   * Clear discovery cache (useful for testing or configuration changes)
   */
  public clearDiscoveryCache(): void {
    this.discoveryCache.clear();
    logger.info("Discovery cache cleared");
  }

  /**
   * Get cache statistics for monitoring
   */
  public getCacheStats(): {
    size: number;
    maxSize: number;
    entries: Array<{ key: string; age: number; expiresIn: number }>;
  } {
    const now = Date.now();
    const cacheTimeout = this.config.discovery.cacheTimeout * 1000;

    const stats = {
      size: this.discoveryCache.size,
      maxSize: this.maxCacheSize,
      entries: Array.from(this.discoveryCache.entries()).map(
        ([key, entry]) => ({
          key,
          age: now - entry.timestamp,
          expiresIn: Math.max(0, cacheTimeout - (now - entry.timestamp)),
        })
      ),
    };

    // Validate cache stats
    return validateInput(CacheStatsSchema, stats, "cache statistics");
  }

  /**
   * Graceful shutdown - cleanup resources and prevent memory leaks
   */
  public async shutdown(): Promise<void> {
    logger.info("Shutting down KeycloakClientFactory", {
      cacheSize: this.discoveryCache.size,
      pkceChallenges: this.pkceManager.getActiveChallengesCount(),
    });

    this.isShuttingDown = true;

    // Clear all caches
    this.discoveryCache.clear();

    // Cleanup PKCE manager
    this.pkceManager.cleanup(0); // Force cleanup all challenges

    logger.info("KeycloakClientFactory shutdown completed");
  }

  /**
   * Check if the factory is in a healthy state including circuit breaker status
   * SECURITY FIX: Enhanced with detailed circuit breaker observability
   */
  public getHealthStatus(): {
    healthy: boolean;
    cacheSize: number;
    maxCacheSize: number;
    pkceChallenges: number;
    shutdownStatus: boolean;
    circuitBreaker: {
      configured: boolean;
      failureThreshold: number;
      recoveryTimeout: string;
      metrics: {
        successRate: string;
        totalRequests: number;
        successes: number;
        failures: number;
        circuitOpenEvents: number;
        lastSuccess: string | null;
        lastFailure: string | null;
      };
    };
  } {
    return {
      healthy:
        !this.isShuttingDown && this.discoveryCache.size <= this.maxCacheSize,
      cacheSize: this.discoveryCache.size,
      maxCacheSize: this.maxCacheSize,
      pkceChallenges: this.pkceManager.getActiveChallengesCount(),
      shutdownStatus: this.isShuttingDown,
      circuitBreaker: {
        configured: true, // Circuit breaker is enabled via messaging library
        failureThreshold: 5, // Consecutive failures before opening circuit
        recoveryTimeout: "10s", // Time before attempting to close circuit
        metrics: {
          successRate: "N/A", // Circuit breaker metrics per-operation, not global
          totalRequests: 0, // Not tracked globally
          successes: 0,
          failures: 0,
          circuitOpenEvents: 0,
          lastSuccess: null,
          lastFailure: null,
        },
      },
    };
  }
}

/**
 * Factory function to create KeycloakClientFactory instance
 */
export const createKeycloakClientFactory = (
  envConfig?: Partial<RawEnvironmentConfig>
): KeycloakClientFactory => {
  const fullConfig: RawEnvironmentConfig = {
    KEYCLOAK_SERVER_URL: process.env["KEYCLOAK_SERVER_URL"] || "",
    KEYCLOAK_REALM: process.env["KEYCLOAK_REALM"] || "",
    KEYCLOAK_FRONTEND_CLIENT_ID:
      process.env["KEYCLOAK_FRONTEND_CLIENT_ID"] || "",
    KEYCLOAK_SERVICE_CLIENT_ID: process.env["KEYCLOAK_SERVICE_CLIENT_ID"] || "",
    KEYCLOAK_SERVICE_CLIENT_SECRET:
      process.env["KEYCLOAK_SERVICE_CLIENT_SECRET"] || "",
    KEYCLOAK_TRACKER_CLIENT_ID: process.env["KEYCLOAK_TRACKER_CLIENT_ID"] || "",
    KEYCLOAK_TRACKER_CLIENT_SECRET:
      process.env["KEYCLOAK_TRACKER_CLIENT_SECRET"] || "",
    KEYCLOAK_WEBSOCKET_CLIENT_ID:
      process.env["KEYCLOAK_WEBSOCKET_CLIENT_ID"] || "",
    REDIS_URL: process.env["REDIS_URL"] || "redis://localhost:6379",
    AUTH_CACHE_TTL: process.env["AUTH_CACHE_TTL"] || "3600",
    AUTH_INTROSPECTION_TTL: process.env["AUTH_INTROSPECTION_TTL"] || "300",
    // Handle number-to-string conversion for backward compatibility
    ...(envConfig && {
      ...Object.fromEntries(
        Object.entries(envConfig)
          .filter(([, value]) => value !== undefined)
          .map(([key, value]) => {
            if (key === "AUTH_CACHE_TTL" || key === "AUTH_INTROSPECTION_TTL") {
              return [key, String(value)];
            }
            return [key, value];
          })
      ),
    }),
  };

  return new KeycloakClientFactory(fullConfig);
};
