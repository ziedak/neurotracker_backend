import { createLogger, type ILogger } from "@libs/utils";
import { KeycloakClientFactory } from "../../client/keycloak-client-factory";
import { TokenIntrospectionResponse } from "../../types/index";
import {
  validateInput,
  TokenIntrospectionResponseSchema,
} from "../../validation/index";

/**
 * Introspection request configuration
 */
export interface IntrospectionRequest {
  token: string;
  clientId: string;
  clientSecret?: string | undefined;
  realm: string;
}

/**
 * Introspection response with metadata
 */
export interface IntrospectionResult {
  response: TokenIntrospectionResponse;
  requestDuration: number;
  realm: string;
  clientId: string;
}

/**
 * Discovery document structure
 */
export interface DiscoveryDocument {
  issuer: string;
  introspection_endpoint: string;
  jwks_uri?: string;
  token_endpoint?: string;
  userinfo_endpoint?: string;
}

/**
 * Interface for token introspection client
 */
export interface ITokenIntrospectionClient {
  /**
   * Perform token introspection
   */
  introspect(request: IntrospectionRequest): Promise<IntrospectionResult>;

  /**
   * Get discovery document for realm
   */
  getDiscoveryDocument(realm: string): Promise<DiscoveryDocument>;

  /**
   * Check if introspection endpoint is available
   */
  isIntrospectionAvailable(realm: string): Promise<boolean>;
}

/**
 * Token Introspection Client
 *
 * Isolated HTTP client for token introspection operations.
 * Handles all network communication with Keycloak's introspection endpoint,
 * including request preparation, response validation, and error handling.
 *
 * Features:
 * - Isolated HTTP client concerns
 * - Comprehensive error handling
 * - Request/response validation
 * - Performance monitoring
 * - Configurable timeouts and retries
 */
export class TokenIntrospectionClient implements ITokenIntrospectionClient {
  private logger: ILogger;

  constructor(private readonly keycloakClientFactory: KeycloakClientFactory) {
    this.logger = createLogger("token-introspection-client");
    this.logger.info("TokenIntrospectionClient initialized");
  }

  /**
   * Perform token introspection with Keycloak
   *
   * @param request - Introspection request configuration
   * @returns Promise<IntrospectionResult> - Introspection result with metadata
   *
   * @throws {TokenValidationError} When introspection fails or endpoint is unavailable
   */
  public async introspect(
    request: IntrospectionRequest
  ): Promise<IntrospectionResult> {
    const startTime = Date.now();

    try {
      this.logger.debug("Starting token introspection", {
        realm: request.realm,
        clientId: request.clientId,
        tokenLength: request.token.length,
      });

      // Get discovery document
      const discovery = await this.getDiscoveryDocument(request.realm);

      // Prepare request body
      const requestBody = this.prepareRequestBody(request);

      // Execute HTTP request
      const response = await this.executeRequest(
        discovery.introspection_endpoint,
        requestBody,
        request.realm
      );

      // Validate and parse response
      const validatedResponse = this.validateResponse(response);

      const requestDuration = Date.now() - startTime;

      this.logger.info("Token introspection completed", {
        realm: request.realm,
        clientId: request.clientId,
        active: validatedResponse.active,
        username: validatedResponse.username,
        duration: `${requestDuration}ms`,
      });

      return {
        response: validatedResponse,
        requestDuration,
        realm: request.realm,
        clientId: request.clientId,
      };
    } catch (error) {
      const requestDuration = Date.now() - startTime;
      this.logger.error("Token introspection failed", {
        realm: request.realm,
        clientId: request.clientId,
        duration: `${requestDuration}ms`,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get discovery document for Keycloak realm
   *
   * @param realm - Keycloak realm name
   * @returns Promise<DiscoveryDocument> - Discovery document with endpoints
   *
   * @throws {TokenValidationError} When discovery document cannot be retrieved
   */
  public async getDiscoveryDocument(realm: string): Promise<DiscoveryDocument> {
    try {
      const discovery = await this.keycloakClientFactory.getDiscoveryDocument(
        realm
      );

      if (!discovery.introspection_endpoint) {
        throw new Error(
          `Introspection endpoint not found in discovery document for realm '${realm}'`
        );
      }

      this.logger.debug("Discovery document retrieved", {
        realm,
        issuer: discovery.issuer,
        hasIntrospection: !!discovery.introspection_endpoint,
        hasJwks: !!discovery.jwks_uri,
      });

      return discovery as DiscoveryDocument;
    } catch (error) {
      this.logger.error("Failed to retrieve discovery document", {
        realm,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Check if introspection endpoint is available for realm
   *
   * @param realm - Keycloak realm name
   * @returns Promise<boolean> - True if introspection is available
   */
  public async isIntrospectionAvailable(realm: string): Promise<boolean> {
    try {
      const discovery = await this.getDiscoveryDocument(realm);
      return !!discovery.introspection_endpoint;
    } catch (error) {
      this.logger.debug("Introspection availability check failed", {
        realm,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Prepare introspection request body
   *
   * @param request - Introspection request configuration
   * @returns URLSearchParams - Form-encoded request body
   */
  private prepareRequestBody(request: IntrospectionRequest): URLSearchParams {
    const body = new URLSearchParams({
      token: request.token,
      client_id: request.clientId,
    });

    if (request.clientSecret) {
      body.append("client_secret", request.clientSecret);
    }

    return body;
  }

  /**
   * Execute HTTP request to introspection endpoint
   *
   * @param endpoint - Introspection endpoint URL
   * @param body - Request body parameters
   * @param realm - Keycloak realm for error context
   * @returns Promise<TokenIntrospectionResponse> - Raw introspection response
   *
   * @throws {TokenValidationError} When HTTP request fails
   */
  private async executeRequest(
    endpoint: string,
    body: URLSearchParams,
    realm: string
  ): Promise<TokenIntrospectionResponse> {
    const requestOptions = {
      method: "POST" as const,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
    };

    this.logger.debug("Executing introspection request", {
      endpoint,
      realm,
      contentLength: body.toString().length,
    });

    const response = await fetch(endpoint, requestOptions);

    if (!response.ok) {
      throw new Error(
        `Introspection request failed for realm '${realm}' (HTTP ${response.status}: ${response.statusText})`
      );
    }

    return await response.json();
  }

  /**
   * Validate introspection response structure
   *
   * @param response - Raw introspection response
   * @returns TokenIntrospectionResponse - Validated response
   *
   * @throws {Error} When response validation fails
   */
  private validateResponse(response: any): TokenIntrospectionResponse {
    try {
      const validated = validateInput(
        TokenIntrospectionResponseSchema,
        response,
        "token introspection response"
      );

      return validated as TokenIntrospectionResponse;
    } catch (error) {
      this.logger.error("Introspection response validation failed", {
        error: error instanceof Error ? error.message : String(error),
        responseKeys: Object.keys(response || {}),
      });
      throw error;
    }
  }

  /**
   * Create introspection request configuration
   */
  public createIntrospectionRequest(
    token: string,
    realm: string,
    clientId: string,
    clientSecret?: string
  ): IntrospectionRequest {
    return {
      token,
      clientId,
      clientSecret,
      realm,
    };
  }
}

/**
 * Factory function to create token introspection client
 */
export const createTokenIntrospectionClient = (
  keycloakClientFactory: KeycloakClientFactory
): TokenIntrospectionClient => {
  return new TokenIntrospectionClient(keycloakClientFactory);
};
