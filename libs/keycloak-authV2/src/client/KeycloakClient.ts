/**
 * Keycloak Client - Core Integration
 * Production-ready Keycloak client with OIDC flows, realm management, and security best practices
 */

import * as jose from "jose";
import { createLogger } from "@libs/utils";
import { CacheService } from "@libs/database";
import { createHttpClient, HttpStatus, type HttpClient } from "@libs/messaging";
import type { IMetricsCollector } from "@libs/monitoring";
import type { AuthResult, UserInfo } from "../types";
import * as crypto from "crypto";

/**
 * Keycloak Realm Configuration
 */
export interface KeycloakRealmConfig {
  serverUrl: string;
  realm: string;
  clientId: string;
  clientSecret?: string; // For confidential clients
  redirectUri?: string; // For authorization code flow
  scopes: string[];
}

/**
 * Keycloak Discovery Document
 */
export interface KeycloakDiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
  introspection_endpoint: string;
  end_session_endpoint: string;
  id_token_signing_alg_values_supported: string[];
  response_types_supported: string[];
  scopes_supported: string[];
  grant_types_supported: string[];
}

/**
 * Token Response from Keycloak
 */
export interface KeycloakTokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  token_type: string;
  expires_in: number;
  refresh_expires_in?: number;
  scope: string;
}

/**
 * User Info Response from Keycloak
 */
export interface KeycloakUserInfo {
  sub: string;
  preferred_username: string;
  email: string | undefined; // Changed from optional to explicit undefined union
  email_verified: boolean | undefined; // Changed from optional
  name: string | undefined; // Changed from optional
  given_name: string | undefined; // Changed from optional
  family_name: string | undefined; // Changed from optional
  realm_access:
    | {
        roles: string[];
      }
    | undefined; // Changed from optional
  resource_access:
    | {
        [clientId: string]: {
          roles: string[];
        };
      }
    | undefined; // Changed from optional
  // Additional fields to match UserInfo interface
  id: string; // Same as sub
  username: string | undefined; // Same as preferred_username, matching UserInfo pattern
  roles: string[]; // Extracted from realm_access and resource_access
  permissions: string[]; // Extracted from roles or additional sources
}

/**
 * Token Introspection Response
 */
export interface KeycloakIntrospectionResponse {
  active: boolean;
  client_id?: string;
  username?: string;
  scope?: string;
  exp?: number;
  iat?: number;
  sub?: string;
  aud?: string[];
  iss?: string;
  email?: string; // Add email field to interface
  name?: string; // Add name field to interface
  realm_access?: {
    roles: string[];
  };
  resource_access?: {
    [key: string]: {
      roles: string[];
    };
  };
}

/**
 * HTTP Response interface for Keycloak requests
 */
interface KeycloakHttpResponse<T = unknown> {
  status: number;
  statusText?: string;
  data: T;
}

/**
 * JWT Payload interface for extracted claims
 */
interface KeycloakJWTPayload {
  sub: string;
  preferred_username?: string;
  email?: string;
  name?: string;
  realm_access?: {
    roles: string[];
  };
  resource_access?: {
    [key: string]: {
      roles: string[];
    };
  };
  scope?: string;
  exp?: number;
  iat?: number;
  iss?: string;
  aud?: string | string[];
  authorization?: {
    permissions: string[];
  };
}

/**
 * Code Exchange Result interface
 */
export interface CodeExchangeResult {
  success: boolean;
  tokens?: KeycloakTokenResponse;
  error?: string;
}

/**
 * Direct Grant Authentication Result
 */
export interface DirectGrantAuthResult {
  success: boolean;
  tokens?: KeycloakTokenResponse;
  sessionId?: string;
  error?: string;
}

/**
 * Authentication Flow Types
 */
export type AuthenticationFlow =
  | "authorization_code"
  | "client_credentials"
  | "direct_grant"
  | "refresh_token";

/**
 * Keycloak Client Options
 */
export interface KeycloakClientOptions {
  realm: KeycloakRealmConfig;
  cache?: {
    discoveryTtl?: number; // seconds
    jwksTtl?: number; // seconds
    userInfoTtl?: number; // seconds
  };
  http?: {
    timeout?: number; // milliseconds
    retries?: number;
  };
  security?: {
    validateIssuer?: boolean;
    requireSecureAlgorithms?: boolean;
    clockSkew?: number; // seconds
  };
}

export class KeycloakClient {
  private readonly logger = createLogger("KeycloakClient");
  private readonly httpClient: HttpClient;
  private cacheService?: CacheService | undefined;
  private discoveryDocument?: KeycloakDiscoveryDocument | undefined;
  private jwksKeySet?: ReturnType<typeof jose.createRemoteJWKSet> | undefined;
  private requestStats = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    lastRequestTime: 0,
  };
  private initializationState: "pending" | "initialized" | "failed" = "pending";

  // Default configuration
  private readonly defaults = {
    cache: {
      discoveryTtl: 3600, // 1 hour
      jwksTtl: 3600, // 1 hour
      userInfoTtl: 300, // 5 minutes
    },
    http: {
      timeout: 10000, // 10 seconds
      retries: 3,
    },
    security: {
      validateIssuer: true,
      requireSecureAlgorithms: true,
      clockSkew: 30, // 30 seconds
    },
  };

  constructor(
    private readonly options: KeycloakClientOptions,
    private readonly metrics?: IMetricsCollector
  ) {
    // Validate configuration
    this.validateConfiguration(options);

    // Initialize HTTP client
    this.httpClient = createHttpClient({
      timeout: options.http?.timeout || this.defaults.http.timeout,
      retries: options.http?.retries || this.defaults.http.retries,
    });

    // Initialize cache if enabled and metrics are available
    if (metrics) {
      this.cacheService = CacheService.create(metrics);
    }
  }

  /**
   * Initialize the client by discovering Keycloak endpoints
   */
  async initialize(): Promise<void> {
    // Protect against multiple initialization calls
    if (this.initializationState === "initialized") {
      this.logger.debug("KeycloakClient already initialized, skipping");
      return;
    }

    if (this.initializationState === "failed") {
      throw new Error(
        "KeycloakClient initialization previously failed. Create a new instance."
      );
    }

    const startTime = performance.now();

    try {
      this.logger.info("Initializing Keycloak client", {
        realm: this.options.realm.realm,
        serverUrl: this.options.realm.serverUrl,
      });

      // Discover Keycloak endpoints
      await this.discoverEndpoints();

      // Initialize JWKS
      if (this.discoveryDocument?.jwks_uri) {
        this.jwksKeySet = jose.createRemoteJWKSet(
          new URL(this.discoveryDocument.jwks_uri),
          {
            timeoutDuration:
              this.options.http?.timeout || this.defaults.http.timeout,
            cooldownDuration: 30000, // 30 seconds
          }
        );
      }

      this.initializationState = "initialized";
      this.trackSuccessfulRequest();

      this.metrics?.recordTimer(
        "keycloak.client.initialization_duration",
        performance.now() - startTime
      );

      this.logger.info("Keycloak client initialized successfully");
    } catch (error) {
      this.initializationState = "failed";
      this.trackFailedRequest();

      this.logger.error("Failed to initialize Keycloak client", { error });
      this.metrics?.recordCounter("keycloak.client.initialization_error", 1);
      throw new Error(`Failed to initialize Keycloak client: ${error}`);
    }
  }

  /**
   * Authenticate using client credentials flow
   * @param scopes - Optional scopes to request (defaults to configured realm scopes)
   * @returns Promise resolving to Keycloak token response
   * @example
   * ```typescript
   * const tokens = await client.authenticateClientCredentials(['read', 'write']);
   * console.log('Access token:', tokens.access_token);
   * ```
   */
  async authenticateClientCredentials(
    scopes?: string[]
  ): Promise<KeycloakTokenResponse> {
    const startTime = performance.now();

    try {
      if (!this.options.realm.clientSecret) {
        throw new Error("Client secret required for client credentials flow");
      }

      if (!this.discoveryDocument?.token_endpoint) {
        throw new Error("Token endpoint not available");
      }

      const requestScopes = scopes || this.options.realm.scopes;

      const params = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.options.realm.clientId,
        client_secret: this.options.realm.clientSecret,
        scope: requestScopes.join(" "),
      });

      const tokenResponse = await this.httpClient.post<KeycloakTokenResponse>(
        this.discoveryDocument.token_endpoint,
        params.toString(),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
        }
      );

      if (!HttpStatus.isSuccess(tokenResponse.status)) {
        throw new Error(
          `Token request failed: ${tokenResponse.status} ${tokenResponse.statusText}`
        );
      }

      this.recordSuccessMetrics(
        "keycloak.auth.client_credentials",
        startTime,
        "Client credentials authentication"
      );

      this.logger.debug("Client credentials authentication successful", {
        scopes: requestScopes,
      });

      return tokenResponse.data;
    } catch (error) {
      this.metrics?.recordCounter("keycloak.auth.client_credentials_error", 1);
      throw new Error(this.sanitizeError(error, "Authentication failed"));
    }
  }

  /**
   * Exchange authorization code for tokens
   * @param code - Authorization code received from OAuth flow
   * @param codeVerifier - Optional PKCE code verifier for enhanced security
   * @returns Promise resolving to Keycloak token response
   * @example
   * ```typescript
   * const tokens = await client.exchangeAuthorizationCode(code, codeVerifier);
   * console.log('Access token:', tokens.access_token);
   * ```
   */
  async exchangeAuthorizationCode(
    code: string,
    codeVerifier?: string // For PKCE
  ): Promise<KeycloakTokenResponse> {
    const startTime = performance.now();

    try {
      if (!this.discoveryDocument?.token_endpoint) {
        throw new Error("Token endpoint not available");
      }

      if (!this.options.realm.redirectUri) {
        throw new Error("Redirect URI required for authorization code flow");
      }

      const params = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: this.options.realm.clientId,
        code,
        redirect_uri: this.options.realm.redirectUri,
      });

      // Add client secret if available (confidential client)
      if (this.options.realm.clientSecret) {
        params.append("client_secret", this.options.realm.clientSecret);
      }

      // Add PKCE code verifier if provided
      if (codeVerifier) {
        params.append("code_verifier", codeVerifier);
      }

      const response = await this.httpClient.post<KeycloakTokenResponse>(
        this.discoveryDocument.token_endpoint,
        params.toString(),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
        }
      );

      if (!HttpStatus.isSuccess(response.status)) {
        throw new Error(
          `Token exchange failed: ${response.status} ${response.statusText}`
        );
      }

      this.recordSuccessMetrics(
        "keycloak.auth.code_exchange",
        startTime,
        "Authorization code exchange"
      );

      return response.data;
    } catch (error) {
      const errorResult = this.handleAuthError(
        error,
        "Authorization code exchange",
        startTime,
        "keycloak.auth.code_exchange"
      ) as AuthResult;

      throw new Error(errorResult.error || "Authentication failed");
    }
  }

  /**
   * Validate JWT token using JWKS verification
   * @param token - JWT token to validate
   * @returns Promise resolving to authentication result with user information
   * @example
   * ```typescript
   * const result = await client.validateToken(jwtToken);
   * if (result.success) {
   *   console.log('User:', result.user.username);
   * }
   * ```
   */
  async validateToken(token: string): Promise<AuthResult> {
    const startTime = performance.now();

    try {
      if (!this.jwksKeySet) {
        throw new Error("JWKS not initialized");
      }

      // Check cache first
      if (this.cacheService) {
        const cacheKey = `keycloak_token:${this.hashToken(token)}`;
        const cachedResult = await this.cacheService.get<AuthResult>(cacheKey);

        if (cachedResult.data) {
          this.metrics?.recordCounter("keycloak.token.validation_cache_hit", 1);
          return cachedResult.data;
        }

        this.metrics?.recordCounter("keycloak.token.validation_cache_miss", 1);
      }

      // Verify JWT signature and claims
      const verifyOptions: jose.JWTVerifyOptions = {
        audience: this.options.realm.clientId,
        clockTolerance:
          this.options.security?.clockSkew || this.defaults.security.clockSkew,
      };

      // Only add issuer if it exists and validation is enabled
      if (
        this.options.security?.validateIssuer !== false &&
        this.discoveryDocument?.issuer
      ) {
        verifyOptions.issuer = this.discoveryDocument.issuer;
      }

      const { payload } = await jose.jwtVerify(
        token,
        this.jwksKeySet,
        verifyOptions
      );

      // Extract user information
      const userInfo: UserInfo = {
        id: payload.sub!,
        username: (payload["preferred_username"] as string) || payload.sub!,
        email: payload["email"] as string,
        name: payload["name"] as string,
        roles: this.extractRoles(payload as KeycloakJWTPayload),
        permissions: this.extractPermissions(payload as KeycloakJWTPayload),
        metadata: {
          iss: payload.iss,
          aud: payload.aud,
          exp: payload.exp,
          iat: payload.iat,
          realm_access: payload["realm_access"],
          resource_access: payload["resource_access"],
        },
      };

      const result: AuthResult = {
        success: true,
        user: userInfo,
        token,
        scopes: (payload["scope"] as string)?.split(" ") || [],
        expiresAt: payload.exp ? new Date(payload.exp * 1000) : undefined,
      };

      // Cache the result
      if (this.cacheService && result.expiresAt) {
        const cacheKey = `keycloak_token:${this.hashToken(token)}`;
        const ttl = Math.floor(
          (result.expiresAt.getTime() - Date.now()) / 1000
        );

        if (ttl > 0) {
          await this.cacheService.set(cacheKey, result, ttl);
        }
      }

      this.metrics?.recordCounter("keycloak.token.validation_success", 1);
      this.metrics?.recordTimer(
        "keycloak.token.validation_duration",
        performance.now() - startTime
      );

      return result;
    } catch (error) {
      const result: AuthResult = {
        success: false,
        error:
          error instanceof Error ? error.message : "Token validation failed",
      };

      this.logger.debug("Token validation failed", {
        error: error instanceof Error ? error.message : error,
      });

      this.metrics?.recordCounter("keycloak.token.validation_error", 1);
      return result;
    }
  }

  /**
   * Introspect token using Keycloak's introspection endpoint
   */
  async introspectToken(token: string): Promise<AuthResult> {
    const startTime = performance.now();

    try {
      if (!this.discoveryDocument?.introspection_endpoint) {
        throw new Error("Introspection endpoint not available");
      }

      if (!this.options.realm.clientSecret) {
        throw new Error("Client secret required for token introspection");
      }

      // Check cache first
      if (this.cacheService) {
        const cacheKey = `keycloak_introspection:${this.hashToken(token)}`;
        const cachedResult = await this.cacheService.get<AuthResult>(cacheKey);

        if (cachedResult.data) {
          this.metrics?.recordCounter("keycloak.introspection.cache_hit", 1);
          return cachedResult.data;
        }

        this.metrics?.recordCounter("keycloak.introspection.cache_miss", 1);
      }

      const params = new URLSearchParams({
        token,
        client_id: this.options.realm.clientId,
        client_secret: this.options.realm.clientSecret,
      });

      const introspectionResult =
        await this.httpClient.post<KeycloakIntrospectionResponse>(
          this.discoveryDocument.introspection_endpoint,
          params.toString(),
          {
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Accept: "application/json",
            },
          }
        );

      if (!HttpStatus.isSuccess(introspectionResult.status)) {
        throw new Error(
          `Introspection failed: ${introspectionResult.status} ${introspectionResult.statusText}`
        );
      }
      const introspection = introspectionResult.data;
      if (!introspection.active) {
        const result: AuthResult = {
          success: false,
          error: "Token is not active",
        };

        // Cache negative result briefly
        if (this.cacheService) {
          const cacheKey = `keycloak_introspection:${this.hashToken(token)}`;
          await this.cacheService.set(cacheKey, result, 60); // 1 minute
        }

        return result;
      }

      // Build user info from introspection response
      const userInfo: UserInfo = {
        id: introspection.sub!,
        username: introspection.username || introspection.sub!,
        email: introspection.email, // Now properly typed
        name: introspection.name, // Now properly typed
        roles: this.extractRolesFromIntrospection(introspection),
        permissions: [], // Would need additional endpoint for permissions
        metadata: {
          client_id: introspection.client_id,
          scope: introspection.scope,
          exp: introspection.exp,
          iat: introspection.iat,
          aud: introspection.aud,
          iss: introspection.iss,
          realm_access: introspection.realm_access,
          resource_access: introspection.resource_access,
        },
      };

      const result: AuthResult = {
        success: true,
        user: userInfo,
        token,
        scopes: introspection.scope?.split(" ") || [],
        expiresAt: introspection.exp
          ? new Date(introspection.exp * 1000)
          : undefined,
      };

      // Cache the result
      if (this.cacheService && introspection.exp) {
        const cacheKey = `keycloak_introspection:${this.hashToken(token)}`;
        const ttl = Math.floor(introspection.exp - Date.now() / 1000);

        if (ttl > 0) {
          await this.cacheService.set(cacheKey, result, ttl);
        }
      }

      this.metrics?.recordCounter("keycloak.introspection.success", 1);
      this.metrics?.recordTimer(
        "keycloak.introspection.duration",
        performance.now() - startTime
      );

      return result;
    } catch (error) {
      const result: AuthResult = {
        success: false,
        error:
          error instanceof Error ? error.message : "Token introspection failed",
      };

      this.logger.error("Token introspection failed", { error });
      this.metrics?.recordCounter("keycloak.introspection.error", 1);

      return result;
    }
  }

  /**
   * Get user information from Keycloak userinfo endpoint
   * @param accessToken - Valid access token for user
   * @returns Promise resolving to complete user information
   * @example
   * ```typescript
   * const userInfo = await client.getUserInfo(accessToken);
   * console.log('User email:', userInfo.email);
   * console.log('User roles:', userInfo.roles);
   * ```
   */
  async getUserInfo(accessToken: string): Promise<KeycloakUserInfo> {
    const startTime = performance.now();

    try {
      if (!this.discoveryDocument?.userinfo_endpoint) {
        throw new Error("Userinfo endpoint not available");
      }

      // Check cache first
      if (this.cacheService) {
        const cacheKey = `keycloak_userinfo:${this.hashToken(accessToken)}`;
        const cachedResult = await this.cacheService.get<KeycloakUserInfo>(
          cacheKey
        );

        if (cachedResult.data) {
          this.metrics?.recordCounter("keycloak.userinfo.cache_hit", 1);
          return cachedResult.data;
        }

        this.metrics?.recordCounter("keycloak.userinfo.cache_miss", 1);
      }

      const response = await this.httpClient.get<KeycloakUserInfo>(
        this.discoveryDocument.userinfo_endpoint,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
        }
      );

      if (!HttpStatus.isSuccess(response.status)) {
        throw new Error(
          `UserInfo request failed: ${response.status} ${response.statusText}`
        );
      }

      const rawUserInfo = response.data;

      // Transform the raw response to ensure all fields match the interface
      const userInfo: KeycloakUserInfo = {
        sub: rawUserInfo.sub,
        preferred_username: rawUserInfo.preferred_username,
        email: rawUserInfo.email ?? undefined, // Ensure it's explicitly undefined if not present
        email_verified: rawUserInfo.email_verified ?? undefined,
        name: rawUserInfo.name ?? undefined,
        given_name: rawUserInfo.given_name ?? undefined,
        family_name: rawUserInfo.family_name ?? undefined,
        realm_access: rawUserInfo.realm_access ?? undefined,
        resource_access: rawUserInfo.resource_access ?? undefined,
        // Additional fields to match UserInfo interface
        id: rawUserInfo.sub, // Map sub to id
        username: rawUserInfo.preferred_username ?? undefined, // Map preferred_username to username
        roles: this.extractRoles(rawUserInfo), // Extract roles from Keycloak data
        permissions: this.extractPermissions(rawUserInfo), // Extract permissions from roles
      };

      // Cache the result
      if (this.cacheService) {
        const cacheKey = `keycloak_userinfo:${this.hashToken(accessToken)}`;
        const ttl =
          this.options.cache?.userInfoTtl || this.defaults.cache.userInfoTtl;
        await this.cacheService.set(cacheKey, userInfo, ttl);
      }

      this.recordSuccessMetrics(
        "keycloak.userinfo",
        startTime,
        "User information retrieval"
      );

      return userInfo;
    } catch (error) {
      const errorResult = this.handleAuthError(
        error,
        "User information retrieval",
        startTime,
        "keycloak.userinfo"
      ) as AuthResult;

      throw new Error(errorResult.error || "User information retrieval failed");
    }
  }

  /**
   * Refresh access token using refresh token
   * @param refreshToken - Valid refresh token
   * @returns Promise resolving to new token response
   * @example
   * ```typescript
   * const newTokens = await client.refreshToken(existingRefreshToken);
   * console.log('New access token:', newTokens.access_token);
   * ```
   */
  async refreshToken(refreshToken: string): Promise<KeycloakTokenResponse> {
    const startTime = performance.now();

    try {
      if (!this.discoveryDocument?.token_endpoint) {
        throw new Error("Token endpoint not available");
      }

      const params = new URLSearchParams({
        grant_type: "refresh_token",
        client_id: this.options.realm.clientId,
        refresh_token: refreshToken,
      });

      // Add client secret if available (confidential client)
      if (this.options.realm.clientSecret) {
        params.append("client_secret", this.options.realm.clientSecret);
      }

      const response = await this.httpClient.post<KeycloakTokenResponse>(
        this.discoveryDocument.token_endpoint,
        params.toString(),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
        }
      );

      if (!HttpStatus.isSuccess(response.status)) {
        throw new Error(
          `Token refresh failed: ${response.status} ${response.statusText}`
        );
      }

      const tokenResponse: KeycloakTokenResponse = response.data;

      this.recordSuccessMetrics(
        "keycloak.auth.token_refresh",
        startTime,
        "Token refresh"
      );

      return tokenResponse;
    } catch (error) {
      const errorResult = this.handleAuthError(
        error,
        "Token refresh",
        startTime,
        "keycloak.auth.token_refresh"
      ) as AuthResult;

      throw new Error(errorResult.error || "Token refresh failed");
    }
  }

  /**
   * Get the authorization URL for OAuth flow initiation
   * @param state - Unique state parameter for CSRF protection
   * @param nonce - Unique nonce for ID token validation
   * @param codeChallenge - Optional PKCE code challenge for enhanced security
   * @param additionalScopes - Optional additional scopes to request
   * @returns Complete authorization URL for redirecting users
   * @example
   * ```typescript
   * const authUrl = client.getAuthorizationUrl(
   *   'random-state-string',
   *   'random-nonce',
   *   'code-challenge',
   *   ['profile']
   * );
   * // Redirect user to authUrl
   * ```
   */
  getAuthorizationUrl(
    state: string,
    nonce: string,
    codeChallenge?: string, // For PKCE
    additionalScopes?: string[]
  ): string {
    if (!this.discoveryDocument?.authorization_endpoint) {
      throw new Error("Authorization endpoint not available");
    }

    if (!this.options.realm.redirectUri) {
      throw new Error("Redirect URI not configured");
    }

    const scopes = [...this.options.realm.scopes];
    if (additionalScopes) {
      scopes.push(...additionalScopes);
    }

    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.options.realm.clientId,
      redirect_uri: this.options.realm.redirectUri,
      scope: scopes.join(" "),
      state,
      nonce,
    });

    // Add PKCE code challenge if provided
    if (codeChallenge) {
      params.append("code_challenge", codeChallenge);
      params.append("code_challenge_method", "S256");
    }

    return `${
      this.discoveryDocument.authorization_endpoint
    }?${params.toString()}`;
  }

  /**
   * Get the logout URL
   */
  getLogoutUrl(idToken?: string, postLogoutRedirectUri?: string): string {
    if (!this.discoveryDocument?.end_session_endpoint) {
      throw new Error("End session endpoint not available");
    }

    const params = new URLSearchParams();

    if (idToken) {
      params.append("id_token_hint", idToken);
    }

    if (postLogoutRedirectUri) {
      params.append("post_logout_redirect_uri", postLogoutRedirectUri);
    }

    return `${
      this.discoveryDocument.end_session_endpoint
    }?${params.toString()}`;
  }

  /**
   * Authenticate with username/password (Direct Grant)
   * @param username - User's login username
   * @param password - User's password
   * @param clientId - Optional client ID override
   * @returns Authentication result with tokens and session information
   * @example
   * ```typescript
   * const result = await client.authenticateWithPassword("user", "pass");
   * if (result.success) {
   *   console.log("User authenticated:", result.tokens);
   * }
   * ```
   */
  async authenticateWithPassword(
    username: string,
    password: string,
    clientId?: string
  ): Promise<DirectGrantAuthResult> {
    const startTime = performance.now();

    try {
      this.validatePasswordGrantPrerequisites();

      const requestParams = this.buildPasswordGrantParams(
        username,
        password,
        clientId
      );
      const response = await this.executePasswordGrant(requestParams);

      const result = this.processPasswordGrantResponse(response);

      this.metrics?.recordCounter("keycloak.auth.password_grant_success", 1);
      this.metrics?.recordTimer(
        "keycloak.auth.password_grant_duration",
        performance.now() - startTime
      );

      return result;
    } catch (error) {
      this.metrics?.recordCounter("keycloak.auth.password_grant_error", 1);
      this.logger.error("Password authentication failed", { error, username });

      return {
        success: false,
        error: this.sanitizeError(error, "Authentication failed"),
      };
    }
  }

  /**
   * Exchange code for tokens (alias for exchangeAuthorizationCode)
   * @param code - Authorization code from OAuth flow
   * @param redirectUri - Redirect URI used in authorization request
   * @param codeVerifier - Optional PKCE code verifier
   * @returns Code exchange result with tokens
   */
  async exchangeCodeForTokens(
    code: string,
    redirectUri: string,
    codeVerifier?: string
  ): Promise<CodeExchangeResult> {
    const startTime = performance.now();

    try {
      if (!this.discoveryDocument?.token_endpoint) {
        throw new Error("Token endpoint not available");
      }

      const params = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: this.options.realm.clientId,
        code,
        redirect_uri: redirectUri, // Use parameter directly instead of mutating instance state
      });

      // Add client secret if available (confidential client)
      if (this.options.realm.clientSecret) {
        params.append("client_secret", this.options.realm.clientSecret);
      }

      // Add PKCE code verifier if provided
      if (codeVerifier) {
        params.append("code_verifier", codeVerifier);
      }

      const response = await this.httpClient.post<KeycloakTokenResponse>(
        this.discoveryDocument.token_endpoint,
        params.toString(),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
        }
      );

      if (!HttpStatus.isSuccess(response.status)) {
        throw new Error(
          `Code exchange failed: ${response.status} ${response.statusText}`
        );
      }

      this.recordSuccessMetrics(
        "keycloak.auth.code_exchange",
        startTime,
        "Code exchange"
      );

      return {
        success: true,
        tokens: response.data,
      };
    } catch (error) {
      const errorResult = this.handleAuthError(
        error,
        "Code exchange",
        startTime,
        "keycloak.auth.code_exchange"
      ) as CodeExchangeResult;

      return errorResult;
    }
  }

  /**
   * Logout user by revoking refresh token
   * @param refreshToken - Valid refresh token to revoke
   * @returns Promise that resolves when logout is complete
   * @example
   * ```typescript
   * await client.logout(refreshToken);
   * console.log('User logged out successfully');
   * ```
   */
  async logout(refreshToken: string): Promise<void> {
    const startTime = performance.now();

    try {
      if (!this.discoveryDocument?.token_endpoint) {
        this.logger.warn("Token endpoint not available for logout");
        return;
      }

      // Keycloak uses the token endpoint with revoke for logout
      const revokeEndpoint = this.discoveryDocument.token_endpoint.replace(
        "/token",
        "/logout"
      );

      const params = new URLSearchParams();
      params.append("refresh_token", refreshToken);
      params.append("client_id", this.options.realm.clientId);

      if (this.options.realm.clientSecret) {
        params.append("client_secret", this.options.realm.clientSecret);
      }

      await this.httpClient.post(revokeEndpoint, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        data: params.toString(),
      });

      this.recordSuccessMetrics(
        "keycloak.auth.logout",
        startTime,
        "User logout"
      );
    } catch (error) {
      const errorResult = this.handleAuthError(
        error,
        "User logout",
        startTime,
        "keycloak.auth.logout"
      ) as AuthResult;

      throw new Error(errorResult.error || "Logout failed");
    }
  }

  /**
   * Get discovery document
   */
  getDiscoveryDocument(): KeycloakDiscoveryDocument | undefined {
    return this.discoveryDocument;
  }

  // Private helper methods

  /**
   * Validate configuration options at startup
   */
  private validateConfiguration(options: KeycloakClientOptions): void {
    if (!options.realm) {
      throw new Error("KeycloakClient: realm configuration is required");
    }

    const { realm } = options;

    // Required fields
    if (!realm.serverUrl) {
      throw new Error("KeycloakClient: realm.serverUrl is required");
    }
    if (!realm.realm) {
      throw new Error("KeycloakClient: realm.realm is required");
    }
    if (!realm.clientId) {
      throw new Error("KeycloakClient: realm.clientId is required");
    }

    // URL validation
    try {
      new URL(realm.serverUrl);
    } catch (error) {
      throw new Error("KeycloakClient: realm.serverUrl must be a valid URL");
    }

    // Scopes validation
    if (!Array.isArray(realm.scopes)) {
      throw new Error("KeycloakClient: realm.scopes must be an array");
    }

    // Optional validation for redirectUri if provided
    if (realm.redirectUri) {
      try {
        new URL(realm.redirectUri);
      } catch (error) {
        throw new Error(
          "KeycloakClient: realm.redirectUri must be a valid URL when provided"
        );
      }
    }

    // Configuration limits validation
    if (
      options.http?.timeout &&
      (options.http.timeout < 1000 || options.http.timeout > 300000)
    ) {
      throw new Error(
        "KeycloakClient: http.timeout must be between 1000ms and 300000ms"
      );
    }

    if (
      options.http?.retries &&
      (options.http.retries < 0 || options.http.retries > 10)
    ) {
      throw new Error("KeycloakClient: http.retries must be between 0 and 10");
    }

    if (
      options.security?.clockSkew &&
      (options.security.clockSkew < 0 || options.security.clockSkew > 300)
    ) {
      throw new Error(
        "KeycloakClient: security.clockSkew must be between 0 and 300 seconds"
      );
    }

    // Cache TTL validations
    if (
      options.cache?.discoveryTtl &&
      (options.cache.discoveryTtl < 60 || options.cache.discoveryTtl > 86400)
    ) {
      throw new Error(
        "KeycloakClient: cache.discoveryTtl must be between 60 and 86400 seconds"
      );
    }

    if (
      options.cache?.jwksTtl &&
      (options.cache.jwksTtl < 60 || options.cache.jwksTtl > 86400)
    ) {
      throw new Error(
        "KeycloakClient: cache.jwksTtl must be between 60 and 86400 seconds"
      );
    }

    if (
      options.cache?.userInfoTtl &&
      (options.cache.userInfoTtl < 30 || options.cache.userInfoTtl > 3600)
    ) {
      throw new Error(
        "KeycloakClient: cache.userInfoTtl must be between 30 and 3600 seconds"
      );
    }
  }

  /**
   * Validate prerequisites for password grant flow
   */
  private validatePasswordGrantPrerequisites(): void {
    if (!this.discoveryDocument?.token_endpoint) {
      throw new Error("Token endpoint not available");
    }
  }

  /**
   * Build URL parameters for password grant request
   */
  private buildPasswordGrantParams(
    username: string,
    password: string,
    clientId?: string
  ): URLSearchParams {
    const params = new URLSearchParams();
    params.append("grant_type", "password");
    params.append("username", username);
    params.append("password", password);
    params.append("client_id", clientId || this.options.realm.clientId);

    if (this.options.realm.clientSecret) {
      params.append("client_secret", this.options.realm.clientSecret);
    }

    if (this.options.realm.scopes.length > 0) {
      params.append("scope", this.options.realm.scopes.join(" "));
    }

    return params;
  }

  /**
   * Execute password grant HTTP request
   */
  private async executePasswordGrant(
    params: URLSearchParams
  ): Promise<KeycloakHttpResponse<KeycloakTokenResponse>> {
    if (!this.discoveryDocument?.token_endpoint) {
      throw new Error("Token endpoint not available");
    }

    return this.httpClient.post<KeycloakTokenResponse>(
      this.discoveryDocument.token_endpoint,
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        data: params.toString(),
      }
    );
  }

  /**
   * Process password grant response and return structured result
   */
  private processPasswordGrantResponse(
    response: KeycloakHttpResponse<KeycloakTokenResponse>
  ): DirectGrantAuthResult {
    if (response.status === 200) {
      return {
        success: true,
        tokens: response.data as KeycloakTokenResponse,
        sessionId: crypto.randomUUID(),
      };
    } else {
      return {
        success: false,
        error: `Authentication failed: ${response.status}`,
      };
    }
  }

  private async discoverEndpoints(): Promise<void> {
    const discoveryUrl = `${this.options.realm.serverUrl}/realms/${this.options.realm.realm}/.well-known/openid_configuration`;

    // Check cache first
    if (this.cacheService) {
      const cacheKey = `keycloak_discovery:${this.options.realm.realm}`;
      const cachedResult =
        await this.cacheService.get<KeycloakDiscoveryDocument>(cacheKey);

      if (cachedResult.data) {
        this.discoveryDocument = cachedResult.data;
        this.logger.debug("Using cached discovery document");
        return;
      }
    }

    this.logger.debug("Fetching discovery document", { discoveryUrl });

    const response = await this.httpClient.get<KeycloakDiscoveryDocument>(
      discoveryUrl,
      {
        headers: { Accept: "application/json" },
      }
    );

    if (!HttpStatus.isSuccess(response.status)) {
      throw new Error(
        `Discovery failed: ${response.status} ${response.statusText}`
      );
    }

    const discoveryDoc: KeycloakDiscoveryDocument = response.data;

    // Validate discovery document
    this.validateDiscoveryDocument(discoveryDoc);

    this.discoveryDocument = discoveryDoc;

    // Cache the discovery document
    if (this.cacheService) {
      const cacheKey = `keycloak_discovery:${this.options.realm.realm}`;
      const ttl =
        this.options.cache?.discoveryTtl || this.defaults.cache.discoveryTtl;
      await this.cacheService.set(cacheKey, discoveryDoc, ttl);
    }

    this.logger.debug("Discovery document loaded and cached");
  }

  private validateDiscoveryDocument(doc: KeycloakDiscoveryDocument): void {
    const required = [
      "issuer",
      "authorization_endpoint",
      "token_endpoint",
      "jwks_uri",
    ];

    for (const field of required) {
      if (!doc[field as keyof KeycloakDiscoveryDocument]) {
        throw new Error(`Discovery document missing required field: ${field}`);
      }
    }

    // Validate issuer matches realm
    const expectedIssuer = `${this.options.realm.serverUrl}/realms/${this.options.realm.realm}`;
    if (doc.issuer !== expectedIssuer) {
      this.logger.warn("Discovery document issuer mismatch", {
        expected: expectedIssuer,
        actual: doc.issuer,
      });
    }
  }

  private hashToken(token: string): string {
    // Create a full SHA-256 hash of the token for cache keys (for security and uniqueness)
    return crypto.createHash("sha256").update(token).digest("hex"); // Use full hash instead of substring to reduce collision risk
  }

  private extractRoles(
    payload: KeycloakJWTPayload | KeycloakUserInfo
  ): string[] {
    const roles: string[] = [];

    // Realm roles
    if (payload.realm_access?.roles) {
      roles.push(
        ...payload.realm_access.roles.map((role: string) => `realm:${role}`)
      );
    }

    // Resource/client roles
    if (payload.resource_access) {
      for (const [client, access] of Object.entries(payload.resource_access)) {
        if (access && typeof access === "object" && "roles" in access) {
          const accessObj = access as { roles: string[] };
          if (accessObj.roles) {
            roles.push(
              ...accessObj.roles.map((role: string) => `${client}:${role}`)
            );
          }
        }
      }
    }

    return roles;
  }

  private extractPermissions(
    payload: KeycloakJWTPayload | KeycloakUserInfo
  ): string[] {
    // Enhanced permission extraction system
    const permissions: string[] = [];

    // Extract permissions from Authorization Services (UMA-based)
    if ("authorization" in payload && payload.authorization?.permissions) {
      permissions.push(...payload.authorization.permissions);
    }

    // Extract role-based permissions (convert roles to permissions)
    const rolePermissions = this.convertRolesToPermissions(payload);
    permissions.push(...rolePermissions);

    // Extract resource-based permissions from resource_access
    const resourcePermissions = this.extractResourcePermissions(payload);
    permissions.push(...resourcePermissions);

    // Remove duplicates and return
    return [...new Set(permissions)];
  }

  /**
   * Convert roles to permission-like strings for RBAC compatibility
   */
  private convertRolesToPermissions(
    payload: KeycloakJWTPayload | KeycloakUserInfo
  ): string[] {
    const permissions: string[] = [];

    // Realm roles to permissions
    if (payload.realm_access?.roles) {
      payload.realm_access.roles.forEach((role) => {
        permissions.push(`realm:${role}:access`);
        // Add common CRUD permissions for admin roles
        if (role.includes("admin")) {
          permissions.push(
            `realm:${role}:read`,
            `realm:${role}:write`,
            `realm:${role}:delete`
          );
        }
      });
    }

    // Resource/client roles to permissions
    if (payload.resource_access) {
      Object.entries(payload.resource_access).forEach(([client, access]) => {
        if (access && typeof access === "object" && "roles" in access) {
          const accessObj = access as { roles: string[] };
          accessObj.roles?.forEach((role) => {
            permissions.push(`${client}:${role}:access`);
            // Add CRUD permissions for admin roles
            if (role.includes("admin")) {
              permissions.push(
                `${client}:${role}:read`,
                `${client}:${role}:write`,
                `${client}:${role}:delete`
              );
            }
          });
        }
      });
    }

    return permissions;
  }

  /**
   * Extract resource-specific permissions
   */
  private extractResourcePermissions(
    payload: KeycloakJWTPayload | KeycloakUserInfo
  ): string[] {
    const permissions: string[] = [];

    // Check for scope-based permissions
    if ("scope" in payload && payload.scope) {
      const scopes = payload.scope.split(" ");
      scopes.forEach((scope) => {
        if (scope.includes(":")) {
          // Format: resource:action (e.g., "users:read", "reports:write")
          permissions.push(scope);
        }
      });
    }

    return permissions;
  }

  private extractRolesFromIntrospection(
    introspection: KeycloakIntrospectionResponse
  ): string[] {
    const roles: string[] = [];

    // Realm roles
    if (introspection.realm_access?.roles) {
      roles.push(
        ...introspection.realm_access.roles.map((role) => `realm:${role}`)
      );
    }

    // Resource/client roles
    if (introspection.resource_access) {
      for (const [client, access] of Object.entries(
        introspection.resource_access
      )) {
        if (access.roles) {
          roles.push(...access.roles.map((role) => `${client}:${role}`));
        }
      }
    }

    return roles;
  }

  /**
   * Get client statistics
   */
  getStats(): {
    discoveryLoaded: boolean;
    jwksLoaded: boolean;
    cacheEnabled: boolean;
    requestCount: number;
    successfulRequests: number;
    failedRequests: number;
    successRate: number;
    lastRequestTime: Date | null;
    initializationState: "pending" | "initialized" | "failed";
  } {
    const successRate =
      this.requestStats.totalRequests > 0
        ? (this.requestStats.successfulRequests /
            this.requestStats.totalRequests) *
          100
        : 0;

    return {
      discoveryLoaded: !!this.discoveryDocument,
      jwksLoaded: !!this.jwksKeySet,
      cacheEnabled: !!this.cacheService,
      requestCount: this.requestStats.totalRequests,
      successfulRequests: this.requestStats.successfulRequests,
      failedRequests: this.requestStats.failedRequests,
      successRate: Math.round(successRate * 100) / 100, // Round to 2 decimal places
      lastRequestTime:
        this.requestStats.lastRequestTime > 0
          ? new Date(this.requestStats.lastRequestTime)
          : null,
      initializationState: this.initializationState,
    };
  }

  /**
   * Track successful request
   */
  private trackSuccessfulRequest(): void {
    this.requestStats.totalRequests++;
    this.requestStats.successfulRequests++;
    this.requestStats.lastRequestTime = Date.now();
  }

  /**
   * Track failed request
   */
  private trackFailedRequest(): void {
    this.requestStats.totalRequests++;
    this.requestStats.failedRequests++;
    this.requestStats.lastRequestTime = Date.now();
  }

  /**
   * Standardized error handling for authentication methods
   */
  private handleAuthError(
    error: unknown,
    operation: string,
    startTime: number,
    metricPrefix: string
  ): AuthResult | DirectGrantAuthResult | CodeExchangeResult {
    this.trackFailedRequest();
    this.metrics?.recordCounter(`${metricPrefix}_error`, 1);
    this.metrics?.recordTimer(
      `${metricPrefix}_duration`,
      performance.now() - startTime
    );

    this.logger.error(`${operation} failed`, { error });

    const sanitizedError = this.sanitizeError(error, `${operation} failed`);

    return {
      success: false,
      error: sanitizedError,
    };
  }

  /**
   * Standardized success metrics recording
   */
  private recordSuccessMetrics(
    metricPrefix: string,
    startTime: number,
    operation: string
  ): void {
    this.trackSuccessfulRequest();
    this.metrics?.recordCounter(`${metricPrefix}_success`, 1);
    this.metrics?.recordTimer(
      `${metricPrefix}_duration`,
      performance.now() - startTime
    );

    this.logger.debug(`${operation} successful`);
  }
  /**
   * Sanitize error messages to prevent information disclosure
   */
  private sanitizeError(error: unknown, fallbackMessage: string): string {
    // Log full error details for debugging
    this.logger.error("Keycloak client error", {
      error,
      stack: error instanceof Error ? error.stack : undefined,
    });

    // Return sanitized message to prevent information disclosure
    if (error instanceof Error) {
      // Only expose safe, expected error messages
      const safeMessages = [
        "Token validation failed",
        "Token expired",
        "Invalid token",
        "Authentication failed",
        "Authorization failed",
        "User not found",
        "Invalid credentials",
        "Token refresh failed",
        "Discovery document fetch failed",
        "Invalid authorization code",
        "PKCE verification failed",
        "Client authentication failed",
      ];

      const errorMessage = error.message.toLowerCase();
      const isSafeMessage = safeMessages.some((safe) =>
        errorMessage.includes(safe.toLowerCase())
      );

      if (isSafeMessage) {
        return error.message;
      }
    }

    // Return generic fallback message for unexpected errors
    return fallbackMessage;
  }

  /**
   * Health check for Keycloak client
   */
  async healthCheck(): Promise<boolean> {
    try {
      if (!this.discoveryDocument) {
        await this.initialize();
      }
      return !!this.discoveryDocument;
    } catch (error) {
      this.logger.error("Health check failed", { error });
      return false;
    }
  }

  /**
   * Clean up resources and dispose of the client
   * Call this when the application is shutting down or the client is no longer needed
   */
  async dispose(): Promise<void> {
    try {
      this.logger.info("Disposing KeycloakClient resources");

      // Clear cache if available
      if (this.cacheService) {
        // Note: CacheService doesn't have a dispose method, so we just remove the reference
        this.cacheService = undefined;
      }

      // Clear discovery document and JWKS
      this.discoveryDocument = undefined;
      this.jwksKeySet = undefined;

      // Reset initialization state
      this.initializationState = "pending";

      // Reset stats
      this.requestStats = {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        lastRequestTime: 0,
      };

      this.logger.info("KeycloakClient disposed successfully");
    } catch (error) {
      this.logger.error("Error during KeycloakClient disposal", { error });
      throw error;
    }
  }

  /**
   * Check if the client is properly initialized and ready to use
   */
  isReady(): boolean {
    return (
      this.initializationState === "initialized" && !!this.discoveryDocument
    );
  }
}
