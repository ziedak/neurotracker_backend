import {
  KeycloakClientConfig,
  KeycloakMultiClientConfig,
  ClientType,
  TokenResponse,
  IKeycloakClientFactory,
  AuthenticationError,
} from "../types/index";
import CircuitBreaker from "opossum";
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

const logger = createLogger("keycloak-client-factory");

/**
 * Keycloak Client Factory
 * Creates and manages Keycloak client configurations for different service types
 */
export class KeycloakClientFactory implements IKeycloakClientFactory {
  private config: KeycloakMultiClientConfig;
  private discoveryCache: Map<string, { data: any; timestamp: number }> =
    new Map();
  private pkceManager: PKCEManager;

  // Cache management
  private readonly maxCacheSize = 100; // Maximum number of cached discovery documents
  private readonly cacheCleanupInterval = 5 * 60 * 1000; // 5 minutes cleanup interval
  private cacheCleanupTimer?: ReturnType<typeof setInterval>;

  // Circuit breaker for HTTP requests to prevent cascading failures
  private readonly httpCircuitBreaker: CircuitBreaker;

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

    // Initialize circuit breaker for HTTP requests
    this.httpCircuitBreaker = new CircuitBreaker(
      this.makeHttpRequest.bind(this),
      {
        timeout: 10000, // 10 second timeout
        errorThresholdPercentage: 50, // Open circuit if 50% of requests fail
        resetTimeout: 30000, // Try to close circuit after 30 seconds
        rollingCountTimeout: 10000, // Rolling window of 10 seconds
        rollingCountBuckets: 10, // 10 buckets in the rolling window
        name: "keycloak-http-circuit-breaker",
        errorFilter: (error: Error) => {
          // Don't count 4xx errors as failures (client errors)
          if (error.message.includes("HTTP 4")) {
            return false;
          }
          return true;
        },
      }
    );

    // Add circuit breaker event listeners for monitoring
    this.httpCircuitBreaker.on("open", () => {
      logger.warn(
        "HTTP circuit breaker opened - stopping requests to Keycloak",
        {
          name: this.httpCircuitBreaker.name,
        }
      );
    });

    this.httpCircuitBreaker.on("close", () => {
      logger.info(
        "HTTP circuit breaker closed - resuming requests to Keycloak",
        {
          name: this.httpCircuitBreaker.name,
        }
      );
    });

    this.httpCircuitBreaker.on("halfOpen", () => {
      logger.info(
        "HTTP circuit breaker half-open - testing Keycloak connectivity",
        {
          name: this.httpCircuitBreaker.name,
        }
      );
    });

    this.httpCircuitBreaker.on("failure", (error: Error) => {
      logger.error("HTTP circuit breaker failure", {
        error: error.message,
        name: this.httpCircuitBreaker.name,
      });
    });

    // Start cache cleanup timer
    this.startCacheCleanupTimer();

    // Build multi-client configuration
    this.config = this.buildMultiClientConfig(
      validatedConfig as RawEnvironmentConfig
    );
    logger.info("Keycloak client factory initialized", {
      realm: this.config.clients.frontend.realm,
      serverUrl: this.config.clients.frontend.serverUrl,
      clientCount: Object.keys(this.config.clients).length,
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
   * Get OpenID Connect discovery document
   */
  public async getDiscoveryDocument(realm: string): Promise<any> {
    const cacheKey = `discovery:${realm}`;
    const cached = this.discoveryCache.get(cacheKey);

    if (
      cached &&
      Date.now() - cached.timestamp < this.config.discovery.cacheTimeout * 1000
    ) {
      return cached.data;
    }

    // Remove expired entry if it exists
    if (cached) {
      this.discoveryCache.delete(cacheKey);
    }

    // Check cache size before adding new entry
    if (this.discoveryCache.size >= this.maxCacheSize) {
      // Remove oldest entry (simple FIFO eviction)
      const firstKey = this.discoveryCache.keys().next().value;
      if (firstKey) {
        this.discoveryCache.delete(firstKey);
        logger.debug("Evicted oldest cache entry due to size limit", {
          evictedKey: firstKey,
          currentSize: this.discoveryCache.size,
          maxSize: this.maxCacheSize,
        });
      }
    }

    const serverUrl = this.config.clients.frontend.serverUrl;
    const discoveryUrl = `${serverUrl}/realms/${realm}/.well-known/openid_connect_configuration`;

    try {
      logger.debug("Fetching discovery document", {
        url: discoveryUrl,
      });

      const response = (await this.httpCircuitBreaker.fire(discoveryUrl, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "keycloak-auth-lib/1.0.0",
        },
      })) as Response;

      const data = await response.json();

      // Cache the discovery document
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
        circuitBreakerState:
          this.httpCircuitBreaker?.status?.stats || "unavailable",
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
      const response = (await this.httpCircuitBreaker.fire(
        discovery.token_endpoint,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
            "User-Agent": "keycloak-auth-lib/1.0.0",
          },
          body: body.toString(),
        }
      )) as Response;

      const responseData = await response.json();

      if (!response.ok) {
        logger.error("Token exchange failed", {
          status: response.status,
          error: responseData.error,
          errorDescription: responseData.error_description,
        });

        throw new AuthenticationError(
          `Token exchange failed: ${
            responseData.error_description ||
            responseData.error ||
            "Unknown error"
          }`,
          "TOKEN_EXCHANGE_FAILED",
          response.status,
          responseData
        );
      }

      // Validate token response
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

      return validatedTokenResponse as TokenResponse;
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
      const response = (await this.httpCircuitBreaker.fire(
        discovery.token_endpoint,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
            "User-Agent": "keycloak-auth-lib/1.0.0",
          },
          body: body.toString(),
        }
      )) as Response;

      const responseData = await response.json();

      if (!response.ok) {
        logger.error("Token refresh failed", {
          status: response.status,
          error: responseData.error,
          errorDescription: responseData.error_description,
        });

        throw new AuthenticationError(
          `Token refresh failed: ${
            responseData.error_description ||
            responseData.error ||
            "Unknown error"
          }`,
          "TOKEN_REFRESH_FAILED",
          response.status,
          responseData
        );
      }

      // Validate token response
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

      return validatedTokenResponse as TokenResponse;
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
      const response = (await this.httpCircuitBreaker.fire(
        discovery.token_endpoint,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
            "User-Agent": "keycloak-auth-lib/1.0.0",
          },
          body: body.toString(),
        }
      )) as Response;

      const responseData = await response.json();

      if (!response.ok) {
        logger.error("Client credentials token request failed", {
          status: response.status,
          clientType,
          error: responseData.error,
          errorDescription: responseData.error_description,
        });

        throw new AuthenticationError(
          `Client credentials flow failed: ${
            responseData.error_description ||
            responseData.error ||
            "Unknown error"
          }`,
          "CLIENT_CREDENTIALS_FAILED",
          response.status,
          responseData
        );
      }

      logger.info("Client credentials token obtained", {
        clientType,
        clientId: client.clientId,
        expiresIn: responseData.expires_in,
        scope: responseData.scope,
      });

      return responseData as TokenResponse;
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
      const response = (await this.httpCircuitBreaker.fire(
        discovery.token_endpoint,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
            "User-Agent": "keycloak-auth-lib/1.0.0",
          },
          body: body.toString(),
        }
      )) as Response;

      const responseData = await response.json();

      if (!response.ok) {
        logger.error("Direct grant token request failed", {
          status: response.status,
          username,
          clientType,
          error: responseData.error,
          errorDescription: responseData.error_description,
        });

        throw new AuthenticationError(
          `Direct grant flow failed: ${
            responseData.error_description ||
            responseData.error ||
            "Unknown error"
          }`,
          responseData.error?.toUpperCase() || "DIRECT_GRANT_FAILED",
          response.status
        );
      }

      // Validate token response
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

      return validatedTokenResponse as TokenResponse;
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
   * Start automatic cache cleanup timer
   */
  private startCacheCleanupTimer(): void {
    this.cacheCleanupTimer = setInterval(() => {
      this.cleanupExpiredCacheEntries();
    }, this.cacheCleanupInterval);

    // Ensure timer doesn't prevent process exit
    this.cacheCleanupTimer.unref();
  }

  /**
   * Clean up expired cache entries
   */
  private cleanupExpiredCacheEntries(): void {
    const now = Date.now();
    const cacheTimeout = this.config.discovery.cacheTimeout * 1000;
    let removedCount = 0;

    for (const [key, entry] of this.discoveryCache.entries()) {
      if (now - entry.timestamp > cacheTimeout) {
        this.discoveryCache.delete(key);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      logger.debug("Cleaned up expired discovery cache entries", {
        removedCount,
        remainingCount: this.discoveryCache.size,
      });
    }

    // Enforce maximum cache size with LRU eviction
    if (this.discoveryCache.size > this.maxCacheSize) {
      const entriesToRemove = this.discoveryCache.size - this.maxCacheSize;
      const keys = Array.from(this.discoveryCache.keys());

      for (let i = 0; i < entriesToRemove && i < keys.length; i++) {
        const key = keys[i];
        if (key) {
          this.discoveryCache.delete(key);
          removedCount++;
        }
      }

      logger.warn("Enforced maximum cache size limit", {
        removedCount,
        maxSize: this.maxCacheSize,
        currentSize: this.discoveryCache.size,
      });
    }
  }

  /**
   * Get cache statistics for monitoring
   */
  public getCacheStats(): {
    size: number;
    maxSize: number;
    cleanupInterval: number;
    entries: Array<{ key: string; age: number; expiresIn: number }>;
  } {
    const now = Date.now();
    const cacheTimeout = this.config.discovery.cacheTimeout * 1000;

    const stats = {
      size: this.discoveryCache.size,
      maxSize: this.maxCacheSize,
      cleanupInterval: this.cacheCleanupInterval,
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
   * HTTP request method wrapped by circuit breaker
   * This method is used by the circuit breaker to make HTTP requests
   */
  private async makeHttpRequest(
    url: RequestInfo,
    options?: RequestInit
  ): Promise<Response> {
    const response = await fetch(url, options);

    // Throw error for non-2xx responses so circuit breaker can track failures
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response;
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
