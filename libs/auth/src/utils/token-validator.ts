/** * Token Validation Utilities * Helper functions for JWT token parsing and validation */

import * as jose from "jose";

/** * Extracted token information interface */
export interface ExtractedTokenInfo {
  jti?: string;
  sub?: string;
  exp?: number;
  iat?: number;
  iss?: string;
  aud?: string | string[];
}
/** * Security level enumeration */ export enum SecurityLevel {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  CRITICAL = "critical",
}
/** * Token validation error class */ export class TokenValidationError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = "TokenValidationError";
  }
}
/** * Error classification helper for JWT operations */ export class ErrorClassificationHelper {
  /**   * Classify JWT-related errors for monitoring and debugging   */ static classifyJWTError(
    error: Error
  ): string {
    if (error.name === "JWTExpired") return "JWT_EXPIRED";
    if (error.name === "JWTInvalid") return "JWT_INVALID";
    if (error.name === "JWTMalformed") return "JWT_MALFORMED";
    if (error.message.includes("Redis")) return "REDIS_ERROR";
    if (error.message.includes("Network")) return "NETWORK_ERROR";
    if (error.message.includes("timeout")) return "TIMEOUT_ERROR";
    return "UNKNOWN_ERROR";
  }
  /**   * Get human-readable error message for error codes   */ static getErrorMessage(
    errorCode: string
  ): string {
    const messages: Record<string, string> = {
      JWT_EXPIRED: "Token has expired",
      JWT_INVALID: "Token is invalid",
      JWT_MALFORMED: "Token format is malformed",
      REDIS_ERROR: "Redis operation failed",
      NETWORK_ERROR: "Network connectivity issue",
      TIMEOUT_ERROR: "Operation timed out",
      UNKNOWN_ERROR: "An unknown error occurred",
    };
    return messages[errorCode] || "Unknown error";
  }
}

/**
 * Token extraction result interface
 */
export interface TokenExtractionResult {
  success: boolean;
  data?: ExtractedTokenInfo & {
    tokenId: string;
    userId: string;
    expiresAt: number;
    issuedAt: number;
  };
  error?: string;
}

/** * Token extraction helper */ export class TokenExtractionHelper {
  static async extractTokenInfo(token: string): Promise<TokenExtractionResult> {
    try {
      const payload = jose.decodeJwt(token);
      const extractedInfo: ExtractedTokenInfo = {
        jti: payload.jti as string,
        sub: payload.sub as string,
        exp: payload.exp as number,
        iat: payload.iat as number,
        iss: payload.iss as string,
        aud: payload.aud as string | string[],
      };

      return {
        success: true,
        data: {
          ...extractedInfo,
          tokenId: extractedInfo.jti || "unknown",
          userId: extractedInfo.sub || "unknown",
          expiresAt: extractedInfo.exp || 0,
          issuedAt: extractedInfo.iat || 0,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  // Keep the old method for backward compatibility
  static async extractTokenInfoDirect(
    token: string
  ): Promise<ExtractedTokenInfo> {
    try {
      const payload = jose.decodeJwt(token);
      return {
        jti: payload.jti as string,
        sub: payload.sub as string,
        exp: payload.exp as number,
        iat: payload.iat as number,
        iss: payload.iss as string,
        aud: payload.aud as string | string[],
      };
    } catch (error) {
      throw new TokenValidationError(
        `Failed to extract token info: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }
}

/**
 * Token time helper
 */
export class TokenTimeHelper {
  static isExpired(tokenInfo: ExtractedTokenInfo): boolean {
    if (!tokenInfo.exp) return false;
    return Date.now() >= tokenInfo.exp * 1000;
  }

  static getRemainingTime(tokenInfo: ExtractedTokenInfo): number {
    if (!tokenInfo.exp) return 0;
    const remaining = tokenInfo.exp - Math.floor(Date.now() / 1000);
    return Math.max(0, remaining);
  }
}

/**
 * Batch operation helper
 */
export class BatchOperationHelper {
  static async processBatch<T, R>(
    items: T[],
    processor: (item: T) => Promise<R>,
    batchSize: number = 100
  ): Promise<R[]> {
    const results: R[] = [];

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map(processor));
      results.push(...batchResults);
    }

    return results;
  }
}

/**
 * Security level helper
 */
export class SecurityLevelHelper {
  static getNumericLevel(level: SecurityLevel): number {
    const levels = {
      [SecurityLevel.LOW]: 1,
      [SecurityLevel.MEDIUM]: 2,
      [SecurityLevel.HIGH]: 3,
      [SecurityLevel.CRITICAL]: 4,
    };
    return levels[level] || 1;
  }

  static fromString(level: string): SecurityLevel {
    const normalized = level.toLowerCase();
    switch (normalized) {
      case "low":
        return SecurityLevel.LOW;
      case "medium":
        return SecurityLevel.MEDIUM;
      case "high":
        return SecurityLevel.HIGH;
      case "critical":
        return SecurityLevel.CRITICAL;
      default:
        return SecurityLevel.LOW;
    }
  }
}

/**
 * Extract token information from JWT string
 */
export async function extractTokenInfo(
  token: string
): Promise<ExtractedTokenInfo> {
  return TokenExtractionHelper.extractTokenInfoDirect(token);
}

/**
 * Check if token is expired based on exp claim
 */
export function isTokenExpired(tokenInfo: ExtractedTokenInfo): boolean {
  return TokenTimeHelper.isExpired(tokenInfo);
}

/**
 * Get token remaining time in seconds
 */
export function getTokenRemainingTime(tokenInfo: ExtractedTokenInfo): number {
  return TokenTimeHelper.getRemainingTime(tokenInfo);
}
