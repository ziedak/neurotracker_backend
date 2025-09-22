/**
 * Keycloak Client - Core Integration
 * Production-ready Keycloak client with OIDC flows, realm management, and security best practices
 */

import * as jose from "jose";
import * as crypto from "crypto";
import { createLogger } from "@libs/utils";
import { CacheService } from "@libs/database";
import { createHttpClient, HttpStatus, type HttpClient } from "@libs/messaging";
import type { IMetricsCollector } from "@libs/monitoring";
import type { AuthResult, UserInfo } from "../types";

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
  private cacheService?: CacheService;
  private discoveryDocument?: KeycloakDiscoveryDocument;
  private jwksKeySet?: ReturnType<typeof jose.createRemoteJWKSet>;

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

      this.metrics?.recordTimer(
        "keycloak.client.initialization_duration",
        performance.now() - startTime
      );

      this.logger.info("Keycloak client initialized successfully");
    } catch (error) {
      this.logger.error("Failed to initialize Keycloak client", { error });
      this.metrics?.recordCounter("keycloak.client.initialization_error", 1);
      throw new Error(`Failed to initialize Keycloak client: ${error}`);
    }
  }

  /**
   * Authenticate using client credentials flow
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

      this.metrics?.recordCounter(
        "keycloak.auth.client_credentials_success",
        1
      );
      this.metrics?.recordTimer(
        "keycloak.auth.client_credentials_duration",
        performance.now() - startTime
      );

      this.logger.debug("Client credentials authentication successful", {
        scopes: requestScopes,
      });

      return tokenResponse.data;
    } catch (error) {
      this.logger.error("Client credentials authentication failed", { error });
      this.metrics?.recordCounter("keycloak.auth.client_credentials_error", 1);
      throw error;
    }
  }

  /**
   * Exchange authorization code for tokens
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

      this.metrics?.recordCounter("keycloak.auth.code_exchange_success", 1);
      this.metrics?.recordTimer(
        "keycloak.auth.code_exchange_duration",
        performance.now() - startTime
      );

      this.logger.debug("Authorization code exchange successful");

      return response.data;
    } catch (error) {
      this.logger.error("Authorization code exchange failed", { error });
      this.metrics?.recordCounter("keycloak.auth.code_exchange_error", 1);
      throw error;
    }
  }

  /**
   * Validate JWT token using JWKS
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
      const verifyOptions: any = {
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
        roles: this.extractRoles(payload),
        permissions: this.extractPermissions(payload),
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
        email: (introspection as any).email as string | undefined,
        name: (introspection as any).name as string | undefined,
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
   * Get user info from Keycloak userinfo endpoint
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

      this.metrics?.recordCounter("keycloak.userinfo.success", 1);
      this.metrics?.recordTimer(
        "keycloak.userinfo.duration",
        performance.now() - startTime
      );

      return userInfo;
    } catch (error) {
      this.logger.error("Failed to get user info", { error });
      this.metrics?.recordCounter("keycloak.userinfo.error", 1);
      throw error;
    }
  }

  /**
   * Refresh access token using refresh token
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

      this.metrics?.recordCounter("keycloak.auth.token_refresh_success", 1);
      this.metrics?.recordTimer(
        "keycloak.auth.token_refresh_duration",
        performance.now() - startTime
      );

      this.logger.debug("Token refresh successful");

      return tokenResponse;
    } catch (error) {
      this.logger.error("Token refresh failed", { error });
      this.metrics?.recordCounter("keycloak.auth.token_refresh_error", 1);
      throw error;
    }
  }

  /**
   * Get the authorization URL for OAuth flow
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
   */
  async authenticateWithPassword(
    username: string,
    password: string,
    clientId?: string
  ): Promise<{
    success: boolean;
    tokens?: KeycloakTokenResponse;
    sessionId?: string;
    error?: string;
  }> {
    try {
      if (!this.discoveryDocument?.token_endpoint) {
        throw new Error("Token endpoint not available");
      }

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

      const response = await this.httpClient.post(
        this.discoveryDocument.token_endpoint,
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          data: params.toString(),
        }
      );

      if (response.status === 200) {
        return {
          success: true,
          tokens: response.data as KeycloakTokenResponse,
          sessionId: crypto.randomUUID(), // Generate session ID
        };
      } else {
        return {
          success: false,
          error: `Authentication failed: ${response.status}`,
        };
      }
    } catch (error) {
      this.logger.error("Password authentication failed", { error, username });
      return {
        success: false,
        error: "Authentication failed",
      };
    }
  }

  /**
   * Exchange code for tokens (alias for exchangeAuthorizationCode)
   */
  async exchangeCodeForTokens(
    code: string,
    redirectUri: string,
    codeVerifier?: string
  ): Promise<{
    success: boolean;
    tokens?: KeycloakTokenResponse;
    error?: string;
  }> {
    try {
      // Temporarily override the redirectUri for this specific call
      const originalRedirectUri = this.options.realm.redirectUri;
      this.options.realm.redirectUri = redirectUri;

      const tokens = await this.exchangeAuthorizationCode(code, codeVerifier);

      // Restore original redirectUri (handle undefined case)
      if (originalRedirectUri) {
        this.options.realm.redirectUri = originalRedirectUri;
      }

      return {
        success: true,
        tokens,
      };
    } catch (error) {
      this.logger.error("Code exchange failed", { error });
      return {
        success: false,
        error: "Code exchange failed",
      };
    }
  }

  /**
   * Logout user by revoking refresh token
   */
  async logout(refreshToken: string): Promise<void> {
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

      this.logger.info("User logged out successfully");
    } catch (error) {
      this.logger.error("Logout failed", { error });
      throw error;
    }
  }

  /**
   * Get discovery document
   */
  getDiscoveryDocument(): KeycloakDiscoveryDocument | undefined {
    return this.discoveryDocument;
  }

  // Private helper methods

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
    // Create a hash of the token for cache keys (for security and length)
    const crypto = require("crypto");
    return crypto
      .createHash("sha256")
      .update(token)
      .digest("hex")
      .substring(0, 16);
  }

  private extractRoles(payload: any): string[] {
    const roles: string[] = [];

    // Realm roles
    if (payload.realm_access?.roles) {
      roles.push(
        ...payload.realm_access.roles.map((role: string) => `realm:${role}`)
      );
    }

    // Resource/client roles
    if (payload.resource_access) {
      for (const [client, access] of Object.entries(
        payload.resource_access as any
      )) {
        if (access && typeof access === "object" && "roles" in access) {
          const accessObj = access as any;
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

  private extractPermissions(payload: any): string[] {
    // Keycloak permissions would typically come from Authorization Services
    // This is a simplified implementation
    const permissions: string[] = [];

    if (payload.authorization?.permissions) {
      permissions.push(...payload.authorization.permissions);
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
  } {
    return {
      discoveryLoaded: !!this.discoveryDocument,
      jwksLoaded: !!this.jwksKeySet,
      cacheEnabled: !!this.cacheService,
      requestCount: 0, // Could be tracked if needed
    };
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
}
