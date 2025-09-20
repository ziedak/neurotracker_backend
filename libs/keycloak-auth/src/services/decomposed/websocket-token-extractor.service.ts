import { createLogger } from "@libs/utils";
import { WebSocketAuthMethod } from "../../types/index";

// Create logger with proper typing
const logger = createLogger("websocket-token-extractor");

/**
 * Token extraction result
 */
export interface TokenExtractionResult {
  token: string;
  method: WebSocketAuthMethod;
}

/**
 * WebSocket token extraction configuration
 */
export interface TokenExtractionConfig {
  enableQueryToken: boolean;
  enableApiKeyHeader: boolean;
  enableCookieToken: boolean;
  enableSessionCookie: boolean;
  maxTokenLength: number;
  supportedMethods: WebSocketAuthMethod[];
}

/**
 * Default configuration for token extraction
 */
export const DEFAULT_TOKEN_EXTRACTION_CONFIG: TokenExtractionConfig = {
  enableQueryToken: true,
  enableApiKeyHeader: true,
  enableCookieToken: true,
  enableSessionCookie: true,
  maxTokenLength: 4096,
  supportedMethods: ["jwt_token", "api_key", "session_based"],
};

/**
 * Interface for WebSocket token extraction service
 */
export interface IWebSocketTokenExtractor {
  /**
   * Extract token from WebSocket connection request
   */
  extractToken(
    headers: Record<string, string>,
    query: Record<string, string>,
    cookies?: Record<string, string>
  ): TokenExtractionResult | null;

  /**
   * Validate token format and length
   */
  validateToken(token: string): boolean;
}

/**
 * WebSocket Token Extraction Service
 * Handles extraction of authentication tokens from WebSocket connection requests
 */
export class WebSocketTokenExtractor implements IWebSocketTokenExtractor {
  constructor(
    private readonly config: TokenExtractionConfig = DEFAULT_TOKEN_EXTRACTION_CONFIG
  ) {
    this.validateConfig();
  }

  /**
   * Validate configuration at startup
   */
  private validateConfig(): void {
    if (this.config.maxTokenLength <= 0) {
      throw new Error("maxTokenLength must be greater than 0");
    }

    if (this.config.supportedMethods.length === 0) {
      throw new Error("At least one authentication method must be supported");
    }

    // Validate that all supported methods are valid
    const validMethods: WebSocketAuthMethod[] = [
      "jwt_token",
      "api_key",
      "session_based",
    ];
    const invalidMethods = this.config.supportedMethods.filter(
      (method) => !validMethods.includes(method)
    );

    if (invalidMethods.length > 0) {
      throw new Error(
        `Invalid authentication methods: ${invalidMethods.join(", ")}`
      );
    }

    logger.info("WebSocket token extractor configuration validated", {
      config: this.config,
    });
  }

  /**
   * Extract token from WebSocket connection request
   * Supports multiple token sources: headers, query params, cookies
   */
  public extractToken(
    headers: Record<string, string>,
    query: Record<string, string>,
    cookies?: Record<string, string>
  ): TokenExtractionResult | null {
    // 1. Check Authorization header (JWT Bearer token)
    if (this.config.supportedMethods.includes("jwt_token")) {
      const authHeader = headers["authorization"] || headers["Authorization"];
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.substring(7);
        if (token && this.validateToken(token)) {
          logger.debug("Token extracted from Authorization header");
          return { token, method: "jwt_token" };
        }
      }

      // 2. Check query parameters
      if (this.config.enableQueryToken && query["token"]) {
        if (this.validateToken(query["token"])) {
          logger.debug("Token extracted from query parameter");
          return { token: query["token"], method: "jwt_token" };
        }
      }

      // 3. Check cookies if available
      if (this.config.enableCookieToken && cookies?.["access_token"]) {
        if (this.validateToken(cookies["access_token"])) {
          logger.debug("Token extracted from cookie");
          return { token: cookies["access_token"], method: "jwt_token" };
        }
      }
    }

    // 4. Check API key in headers
    if (
      this.config.enableApiKeyHeader &&
      this.config.supportedMethods.includes("api_key")
    ) {
      const apiKey = headers["x-api-key"] || headers["X-API-Key"];
      if (apiKey && this.validateToken(apiKey)) {
        logger.debug("API key extracted from headers");
        return { token: apiKey, method: "api_key" };
      }
    }

    // 5. Check session cookie
    if (
      this.config.enableSessionCookie &&
      this.config.supportedMethods.includes("session_based")
    ) {
      if (cookies?.["session_id"]) {
        if (this.validateToken(cookies["session_id"])) {
          logger.debug("Session ID extracted from cookie");
          return { token: cookies["session_id"], method: "session_based" };
        }
      }
    }

    logger.debug("No valid token found in request");
    return null;
  }

  /**
   * Validate token format and length
   */
  public validateToken(token: string): boolean {
    if (!token || typeof token !== "string") {
      return false;
    }

    if (token.length === 0 || token.length > this.config.maxTokenLength) {
      logger.warn("Token length validation failed", {
        length: token.length,
        maxLength: this.config.maxTokenLength,
      });
      return false;
    }

    // Basic format validation - should contain only valid characters
    const validTokenRegex = /^[a-zA-Z0-9._-]+$/;
    if (!validTokenRegex.test(token)) {
      logger.warn("Token format validation failed - invalid characters");
      return false;
    }

    return true;
  }
}

/**
 * Factory function to create WebSocket token extractor
 */
export const createWebSocketTokenExtractor = (
  config?: Partial<TokenExtractionConfig>
): WebSocketTokenExtractor => {
  const finalConfig = { ...DEFAULT_TOKEN_EXTRACTION_CONFIG, ...config };
  return new WebSocketTokenExtractor(finalConfig);
};
