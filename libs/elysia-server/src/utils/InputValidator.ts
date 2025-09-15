/**
 * Production-grade input validation utilities
 */
import {
  HttpHeaders,
  ValidatedHeaders,
  JsonValue,
  JsonValidationOptions,
  WebSocketMessage,
  ValidatedWebSocketMessage,
  JsonTypeName,
} from "../types/validation.types";
export class InputValidator {
  /**
   * Validate authentication token
   */
  static validateToken(token: string | undefined): string {
    if (!token) {
      throw new Error("Authentication token is required");
    }

    if (typeof token !== "string") {
      throw new Error("Token must be a string");
    }

    // Remove Bearer prefix if present
    const cleanToken = token.replace(/^Bearer\s+/i, "");

    // Basic JWT format validation (3 parts separated by dots)
    const parts = cleanToken.split(".");
    if (parts.length !== 3) {
      throw new Error("Invalid token format - must be valid JWT");
    }

    // Validate each part contains only valid base64url characters
    const base64UrlPattern = /^[A-Za-z0-9\-_]+$/;
    for (const part of parts) {
      if (!base64UrlPattern.test(part)) {
        throw new Error("Invalid token format - contains invalid characters");
      }
    }

    if (cleanToken.length > 2048) {
      throw new Error("Token too long - maximum 2048 characters");
    }

    if (cleanToken.length < 16) {
      throw new Error("Token too short - minimum 16 characters");
    }

    return cleanToken;
  }

  /**
   * Validate URL
   */
  static validateUrl(
    url: string | undefined,
    allowedProtocols: string[] = ["http", "https", "ws", "wss"]
  ): string {
    if (!url) {
      throw new Error("URL is required");
    }

    if (typeof url !== "string") {
      throw new Error("URL must be a string");
    }

    if (url.length > 2048) {
      throw new Error("URL too long - maximum 2048 characters");
    }

    // Basic URL validation
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error("Invalid URL format");
    }

    // Check protocol
    const protocol = parsedUrl.protocol.slice(0, -1); // Remove trailing colon
    if (!allowedProtocols.includes(protocol)) {
      throw new Error(
        `Invalid protocol - allowed: ${allowedProtocols.join(", ")}`
      );
    }

    // Check for suspicious patterns (less strict)
    if (url.includes("..")) {
      throw new Error("URL contains suspicious patterns");
    }

    return url;
  }

  /**
   * Validate HTTP headers
   */
  static validateHeaders(headers: HttpHeaders): ValidatedHeaders {
    if (!headers || typeof headers !== "object") {
      return {};
    }

    const validated: ValidatedHeaders = {};
    const maxHeaders = 50;
    let headerCount = 0;

    for (const [key, value] of Object.entries(headers)) {
      if (headerCount >= maxHeaders) {
        break; // Limit number of headers
      }

      if (typeof key === "string") {
        // Validate header name
        if (!/^[a-zA-Z0-9\-_]+$/.test(key)) {
          continue; // Skip invalid header names
        }

        // Check for array values
        if (Array.isArray(value)) {
          throw new Error("Invalid header value: must be string");
        }

        // Check for numeric values
        if (typeof value === "number") {
          throw new Error("Invalid header value: must be string");
        }

        // Check for null values
        if (value === null) {
          throw new Error("Invalid header value: must be string");
        }

        if (typeof value === "string") {
          // Limit header sizes
          if (key.length > 100 || value.length > 1000) {
            continue; // Skip oversized headers
          }

          // Sanitize header value (remove control characters)
          const sanitizedValue = value.replace(/\p{C}/gu, "");

          validated[key.toLowerCase()] = sanitizedValue;
          headerCount++;
        }
      }
    }

    return validated;
  }

  /**
   * Validate JSON payload
   */
  static validateJsonPayload(
    payload: unknown,
    options: JsonValidationOptions = {}
  ): JsonValue {
    const {
      maxSizeBytes = 1024 * 1024, // 1MB default
      maxDepth = 10,
      allowedTypes = ["object", "array", "string", "number", "boolean"],
    } = options;

    if (payload === undefined) {
      throw new Error("Invalid JSON: undefined values not allowed");
    }

    if (payload === null) {
      return null;
    }

    // Check for functions
    if (typeof payload === "function") {
      throw new Error("Invalid JSON: functions not allowed");
    }

    // Check for symbols
    if (typeof payload === "symbol") {
      throw new Error("Invalid JSON: symbols not allowed");
    }

    // Check payload size
    const payloadString = JSON.stringify(payload);
    if (payloadString.length > maxSizeBytes) {
      throw new Error(`JSON size limit exceeded`);
    }

    // Check depth
    const depth = this.getObjectDepth(payload);
    if (depth > maxDepth) {
      throw new Error(`JSON depth limit exceeded`);
    }

    // Validate types
    if (!this.isValidType(payload, allowedTypes)) {
      throw new Error(
        `Invalid payload type - allowed: ${allowedTypes.join(", ")}`
      );
    }

    return payload as JsonValue;
  }

  /**
   * Validate WebSocket message
   */
  static validateWebSocketMessage(
    message: WebSocketMessage
  ): ValidatedWebSocketMessage {
    if (!message || typeof message !== "object") {
      throw new Error("Message must be an object");
    }

    if (message.type === null || message.type === undefined) {
      throw new Error("Invalid message: missing type");
    }

    if (typeof message.type !== "string") {
      throw new Error("Invalid message: type must be a string");
    }

    if (message.type.length === 0) {
      throw new Error("Invalid message: type cannot be empty");
    }

    if (message.type.length > 100) {
      throw new Error("Message type too long - maximum 100 characters");
    }

    // Validate type contains only safe characters
    if (!/^[a-zA-Z0-9\-_:.]+$/.test(message.type)) {
      throw new Error("Message type contains invalid characters");
    }

    const result: ValidatedWebSocketMessage = {
      type: message.type,
    };

    if (message.payload !== undefined) {
      result.payload = this.validateJsonPayload(message.payload, {
        maxSizeBytes: 64 * 1024, // 64KB for WebSocket messages
      });
    }

    if (message.id !== undefined) {
      if (typeof message.id !== "string" || message.id.length > 50) {
        throw new Error(
          "Message ID must be a string with maximum 50 characters"
        );
      }
      result.id = message.id;
    }

    return result;
  }

  /**
   * Validate IP address
   */
  static validateIpAddress(ip: string | undefined): string {
    if (!ip) {
      throw new Error("IP address is required");
    }

    if (typeof ip !== "string") {
      throw new Error("IP address must be a string");
    }

    // IPv4 validation
    const ipv4Pattern =
      /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

    // IPv6 validation (simplified)
    const ipv6Pattern = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;

    if (!ipv4Pattern.test(ip) && !ipv6Pattern.test(ip)) {
      throw new Error("Invalid IP address format");
    }

    return ip;
  }

  /**
   * Sanitize string input
   */
  static sanitizeString(
    input: string | undefined,
    options: {
      maxLength?: number;
      allowedChars?: RegExp;
      trimWhitespace?: boolean;
      removeHtml?: boolean;
    } = {}
  ): string {
    if (!input) {
      return "";
    }

    if (typeof input !== "string") {
      throw new Error("Input must be a string");
    }

    const {
      maxLength = 1000,
      allowedChars = /^[a-zA-Z0-9\s\-_.,!?@#$%^&*()+=[\]{}|;:'"<>?/\\`~]+$/,
      trimWhitespace = true,
      removeHtml = true, // Enable HTML removal by default to match test expectations
    } = options;

    let sanitized = input;

    if (trimWhitespace) {
      sanitized = sanitized.trim();
    }

    if (removeHtml) {
      // Remove HTML tags
      sanitized = sanitized.replace(/<[^>]*>/g, "");
    }

    if (sanitized.length > maxLength) {
      throw new Error(`String too long - maximum ${maxLength} characters`);
    }

    if (!allowedChars.test(sanitized)) {
      throw new Error("String contains invalid characters");
    }

    // Remove control characters
    sanitized = sanitized.replace(/\p{C}/gu, "");

    return sanitized;
  }

  /**
   * Get object depth for validation
   */
  private static getObjectDepth(obj: unknown, depth = 0): number {
    if (depth > 20) return depth; // Prevent infinite recursion

    if (obj === null || typeof obj !== "object") {
      return depth;
    }

    if (Array.isArray(obj)) {
      return Math.max(
        depth,
        ...obj.map((item) => this.getObjectDepth(item, depth + 1))
      );
    }

    const depths = Object.values(obj).map((value) =>
      this.getObjectDepth(value, depth + 1)
    );
    return depths.length > 0 ? Math.max(depth, ...depths) : depth;
  }

  /**
   * Check if value is of allowed type
   */
  private static isValidType(
    value: unknown,
    allowedTypes: JsonTypeName[]
  ): boolean {
    if (value === null) {
      return allowedTypes.includes("null");
    }

    if (Array.isArray(value)) {
      return allowedTypes.includes("array");
    }

    const jsType = typeof value;

    // Map JavaScript types to JsonTypeName
    let jsonType: JsonTypeName;
    switch (jsType) {
      case "string":
        jsonType = "string";
        break;
      case "number":
        jsonType = "number";
        break;
      case "boolean":
        jsonType = "boolean";
        break;
      case "object":
        jsonType = "object";
        break;
      default:
        return false; // Unsupported type
    }

    return allowedTypes.includes(jsonType);
  }
}

/**
 * Pre-configured validators for common use cases
 */
export const CommonValidators = {
  /**
   * Strict API validation
   */
  api: {
    validateToken: (token: string | undefined): string =>
      InputValidator.validateToken(token),
    validateHeaders: (headers: HttpHeaders): ValidatedHeaders =>
      InputValidator.validateHeaders(headers),
    validatePayload: (payload: unknown): JsonValue =>
      InputValidator.validateJsonPayload(payload, {
        maxSizeBytes: 10 * 1024 * 1024, // 10MB
        maxDepth: 15,
      }),
  },

  /**
   * WebSocket message validation
   */
  websocket: {
    validateMessage: (message: WebSocketMessage): ValidatedWebSocketMessage =>
      InputValidator.validateWebSocketMessage(message),
    validatePayload: (payload: unknown): JsonValue =>
      InputValidator.validateJsonPayload(payload, {
        maxSizeBytes: 64 * 1024, // 64KB
        maxDepth: 10,
      }),
  },

  /**
   * Basic string validation
   */
  string: {
    username: (input: string | undefined): string =>
      InputValidator.sanitizeString(input, {
        maxLength: 50,
        allowedChars: /^[a-zA-Z0-9\-_]+$/,
      }),
    email: (input: string | undefined): string =>
      InputValidator.sanitizeString(input, {
        maxLength: 254,
        allowedChars: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
      }),
    roomName: (input: string | undefined): string =>
      InputValidator.sanitizeString(input, {
        maxLength: 100,
        allowedChars: /^[a-zA-Z0-9\-_:]+$/,
      }),
  },
};
