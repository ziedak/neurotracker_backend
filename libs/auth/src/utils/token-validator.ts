/**
 * Token Validation Utilities
 *
 * Single Responsibility: Token structure validation and extraction
 * Clean helper functions following DRY principles
 */

/**
 * Token validation errors
 */
export enum TokenValidationError {
  INVALID_FORMAT = "invalid_format",
  MISSING_REQUIRED_CLAIMS = "missing_required_claims",
  INVALID_PAYLOAD_STRUCTURE = "invalid_payload_structure",
  EXTRACTION_FAILED = "extraction_failed",
}

/**
 * Token extraction result
 */
export interface TokenExtractionResult {
  readonly success: boolean;
  readonly data?: {
    readonly tokenId: string;
    readonly userId: string;
    readonly issuedAt: Date;
    readonly expiresAt: Date;
  };
  readonly error?: TokenValidationError;
}

/**
 * JWT payload interface for validation
 */
export interface JWTPayloadStructure {
  readonly sub: string;
  readonly iat: number;
  readonly exp: number;
  readonly jti?: string;
}

/**
 * Token Extraction Helper
 *
 * Single responsibility: Extract and validate JWT token components
 * No external dependencies, pure functions for testability
 */
export class TokenExtractionHelper {
  /**
   * Validate JWT token format (3 parts separated by dots)
   */
  static isValidJWTFormat(token: string): boolean {
    if (typeof token !== "string" || token.trim().length === 0) {
      return false;
    }

    const parts = token.split(".");
    return parts.length === 3 && parts.every((part) => part.length > 0);
  }

  /**
   * Extract payload from JWT without verification (for blacklist checking)
   */
  static extractPayload(token: string): JWTPayloadStructure | null {
    if (!this.isValidJWTFormat(token)) {
      return null;
    }

    try {
      const parts = token.split(".");
      const payloadBase64 = parts[1];

      // Add padding if needed
      const paddedPayload =
        payloadBase64 + "=".repeat((4 - (payloadBase64.length % 4)) % 4);

      const payloadJson = atob(paddedPayload);
      const payload = JSON.parse(payloadJson);

      return this.validatePayloadStructure(payload) ? payload : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Extract token information for blacklist operations
   */
  static extractTokenInfo(token: string): TokenExtractionResult {
    const payload = this.extractPayload(token);

    if (!payload) {
      return {
        success: false,
        error: TokenValidationError.EXTRACTION_FAILED,
      };
    }

    try {
      const tokenId =
        payload.jti || this.generateTokenId(payload.sub, payload.iat);

      return {
        success: true,
        data: {
          tokenId,
          userId: payload.sub,
          issuedAt: new Date(payload.iat * 1000),
          expiresAt: new Date(payload.exp * 1000),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: TokenValidationError.EXTRACTION_FAILED,
      };
    }
  }

  /**
   * Generate consistent token ID from sub and iat
   */
  static generateTokenId(userId: string, issuedAt: number): string {
    return `${userId}-${issuedAt}`;
  }

  /**
   * Validate payload has required structure
   */
  private static validatePayloadStructure(
    payload: unknown
  ): payload is JWTPayloadStructure {
    if (typeof payload !== "object" || payload === null) {
      return false;
    }

    const p = payload as Record<string, unknown>;

    return (
      typeof p.sub === "string" &&
      typeof p.iat === "number" &&
      typeof p.exp === "number" &&
      p.sub.length > 0 &&
      p.iat > 0 &&
      p.exp > p.iat
    );
  }
}

/**
 * Security levels type definition
 */
export type SecurityLevel = "low" | "medium" | "high" | "critical";

/**
 * Security Level Helper
 *
 * Single responsibility: Security level validation and comparison
 */
export class SecurityLevelHelper {
  /**
   * Security levels in order of strength
   */
  static readonly LEVELS: readonly SecurityLevel[] = [
    "low",
    "medium",
    "high",
    "critical",
  ] as const;

  /**
   * Check if security level is valid
   */
  static isValidSecurityLevel(level: string): level is SecurityLevel {
    return this.LEVELS.includes(level as SecurityLevel);
  }

  /**
   * Check if current level meets minimum requirement
   */
  static meetsMinimumLevel(
    current: SecurityLevel,
    minimum: SecurityLevel
  ): boolean {
    const currentIndex = this.LEVELS.indexOf(current);
    const minimumIndex = this.LEVELS.indexOf(minimum);

    return currentIndex >= minimumIndex;
  }

  /**
   * Get security level strength (numeric value for comparison)
   */
  static getLevelStrength(level: SecurityLevel): number {
    return this.LEVELS.indexOf(level);
  }
}

/**
 * Token Time Helper
 *
 * Single responsibility: Time-related token operations
 */
export class TokenTimeHelper {
  /**
   * Check if token is expired based on exp claim
   */
  static isExpired(expiresAt: Date): boolean {
    return Date.now() >= expiresAt.getTime();
  }

  /**
   * Calculate TTL in seconds from expiration date
   */
  static calculateTTLSeconds(expiresAt: Date): number {
    const ttlMs = expiresAt.getTime() - Date.now();
    return Math.max(Math.ceil(ttlMs / 1000), 0);
  }

  /**
   * Check if token is within acceptable time bounds
   */
  static isWithinTimeBounds(issuedAt: Date, expiresAt: Date): boolean {
    const now = Date.now();
    const iat = issuedAt.getTime();
    const exp = expiresAt.getTime();

    // Basic sanity checks
    return (
      iat <= now && // Not issued in future
      exp > iat && // Expires after issued
      exp > now // Not already expired
    );
  }

  /**
   * Get current Unix timestamp
   */
  static getCurrentTimestamp(): number {
    return Math.floor(Date.now() / 1000);
  }
}

/**
 * Token ID Generator
 *
 * Single responsibility: Generate unique, consistent token identifiers
 */
export class TokenIdGenerator {
  /**
   * Generate unique token ID with timestamp and randomness
   */
  static generateUniqueId(userId: string): string {
    const timestamp = TokenTimeHelper.getCurrentTimestamp();
    const random = Math.random().toString(36).substring(2, 10);
    return `${userId}-${timestamp}-${random}`;
  }

  /**
   * Generate deterministic token ID (for blacklist consistency)
   */
  static generateDeterministicId(userId: string, issuedAt: number): string {
    return `${userId}-${issuedAt}`;
  }

  /**
   * Validate token ID format
   */
  static isValidTokenId(tokenId: string): boolean {
    if (typeof tokenId !== "string" || tokenId.length < 3) {
      return false;
    }

    // Should contain at least userId and timestamp
    const parts = tokenId.split("-");
    return parts.length >= 2 && parts[0].length > 0 && /^\d+$/.test(parts[1]);
  }

  /**
   * Extract user ID from token ID
   */
  static extractUserIdFromTokenId(tokenId: string): string | null {
    if (!this.isValidTokenId(tokenId)) {
      return null;
    }

    const parts = tokenId.split("-");
    return parts[0];
  }
}

/**
 * Batch Operation Helper
 *
 * Single responsibility: Handle batch processing with proper chunking
 */
export class BatchOperationHelper {
  /**
   * Process array in batches with size limit
   */
  static chunkArray<T>(array: T[], chunkSize: number): T[][] {
    if (chunkSize <= 0) {
      throw new Error("Chunk size must be positive");
    }

    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }

    return chunks;
  }

  /**
   * Process batches with delay between each batch
   */
  static async processBatchesWithDelay<T, R>(
    items: T[],
    processor: (batch: T[]) => Promise<R[]>,
    batchSize: number,
    delayMs: number = 0
  ): Promise<R[]> {
    const chunks = this.chunkArray(items, batchSize);
    const results: R[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunkResults = await processor(chunks[i]);
      results.push(...chunkResults);

      // Add delay between batches (except for the last one)
      if (delayMs > 0 && i < chunks.length - 1) {
        await this.sleep(delayMs);
      }
    }

    return results;
  }

  /**
   * Sleep utility for delays
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Error Classification Helper
 *
 * Single responsibility: Classify and handle different types of validation errors
 */
export class ErrorClassificationHelper {
  /**
   * Classify JWT verification errors
   */
  static classifyJWTError(error: unknown): TokenValidationError {
    if (!error || typeof error !== "object") {
      return TokenValidationError.INVALID_FORMAT;
    }

    const err = error as { name?: string; message?: string };

    if (err.name === "JWTExpired") {
      return TokenValidationError.INVALID_FORMAT; // Let JWT service handle expiration
    }

    if (err.name === "JWTInvalid" || err.name === "JWTMalformed") {
      return TokenValidationError.INVALID_FORMAT;
    }

    if (err.name === "JWTClaimValidationFailed") {
      return TokenValidationError.MISSING_REQUIRED_CLAIMS;
    }

    return TokenValidationError.INVALID_PAYLOAD_STRUCTURE;
  }

  /**
   * Check if error is recoverable
   */
  static isRecoverableError(error: TokenValidationError): boolean {
    return ![
      TokenValidationError.INVALID_FORMAT,
      TokenValidationError.INVALID_PAYLOAD_STRUCTURE,
    ].includes(error);
  }

  /**
   * Get user-friendly error message
   */
  static getErrorMessage(error: TokenValidationError): string {
    const messages = {
      [TokenValidationError.INVALID_FORMAT]: "Token format is invalid",
      [TokenValidationError.MISSING_REQUIRED_CLAIMS]:
        "Token is missing required claims",
      [TokenValidationError.INVALID_PAYLOAD_STRUCTURE]:
        "Token payload structure is invalid",
      [TokenValidationError.EXTRACTION_FAILED]:
        "Failed to extract token information",
    };

    return messages[error] || "Unknown token validation error";
  }
}
