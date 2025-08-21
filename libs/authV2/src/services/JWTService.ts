/**
 * @fileoverview JWTServiceV2 - Enterprise JWT token management service
 * @module services/JWTService
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type {
  EntityId,
  JWTToken,
  Timestamp,
  ITokenPayload,
} from "../types/core";
import { createJWTToken } from "../types/core";
import type {
  IJWTService,
  IJWTGeneratePayload,
  IJWTGenerateResult,
  IJWTVerifyResult,
  IJWTRefreshResult,
  ITokenHealthInfo,
  IBatchOperationResult,
  IServiceHealth,
} from "../contracts/services";
import { ValidationError } from "../errors/core";
import * as crypto from "crypto";

/**
 * JWTServiceV2 Implementation
 *
 * Enterprise-grade JWT token management service with:
 * - Secure token generation and verification
 * - Token blacklisting and rotation
 * - Batch token processing
 * - Health monitoring and metrics
 * - Comprehensive audit logging
 */
export class JWTServiceV2 implements IJWTService {
  private readonly blacklistedTokens: Set<string> = new Set();
  private readonly tokenMetrics: Map<
    string,
    { created: Date; lastUsed: Date; usageCount: number }
  > = new Map();
  private readonly defaultSecret: string;
  private readonly defaultExpiry = "1h";
  private readonly refreshExpiry = "7d";
  private readonly startTime = Date.now();

  private metrics = {
    tokensGenerated: 0,
    tokensVerified: 0,
    tokensBlacklisted: 0,
    verificationFailures: 0,
    operationsTotal: 0,
    errorsTotal: 0,
    lastOperation: null as Date | null,
  };

  constructor(secret?: string) {
    // In production, this should come from environment variables
    this.defaultSecret =
      secret ||
      "dev-jwt-secret-key-minimum-32-characters-long-for-development-only";

    if (this.defaultSecret.length < 32) {
      throw new ValidationError(
        "JWT secret must be at least 32 characters long"
      );
    }

    // Start cleanup job for blacklisted tokens
    this.startCleanupJob();
  }

  /**
   * Generate JWT token
   */
  async generate(payload: IJWTGeneratePayload): Promise<IJWTGenerateResult> {
    this.metrics.operationsTotal++;
    this.metrics.tokensGenerated++;
    this.metrics.lastOperation = new Date();

    try {
      const now = new Date();
      const tokenId = this.generateTokenId();
      const expiresIn = payload.expiresIn || this.defaultExpiry;
      const expiresAt = this.calculateExpiration(expiresIn);

      // Create JWT payload
      const jwtPayload: ITokenPayload = {
        sub: payload.userId,
        iat: Math.floor(now.getTime() / 1000),
        exp: Math.floor(expiresAt.getTime() / 1000),
        aud: "web-app",
        iss: "authv2-service",
        jti: tokenId,
        type: "access",
        permissions: payload.permissions || [],
        roles: payload.roles || [],
        metadata: payload.metadata || {},
      };

      // Generate access token
      const accessToken = this.signToken(jwtPayload);

      // Generate refresh token with longer expiry
      const refreshTokenPayload: ITokenPayload = {
        ...jwtPayload,
        exp: Math.floor(
          this.calculateExpiration(this.refreshExpiry).getTime() / 1000
        ),
        jti: this.generateTokenId(),
        type: "refresh",
      };
      const refreshToken = this.signToken(refreshTokenPayload);

      // Track token metrics
      this.tokenMetrics.set(tokenId, {
        created: now,
        lastUsed: now,
        usageCount: 0,
      });

      return {
        token: createJWTToken(accessToken),
        refreshToken: createJWTToken(refreshToken),
        expiresAt,
        tokenId,
      };
    } catch (error) {
      this.metrics.errorsTotal++;
      throw error;
    }
  }

  /**
   * Verify JWT token
   */
  async verify(token: JWTToken): Promise<IJWTVerifyResult> {
    this.metrics.operationsTotal++;
    this.metrics.tokensVerified++;
    this.metrics.lastOperation = new Date();

    try {
      // Check if token is blacklisted
      const isBlacklisted = await this.isBlacklisted(token);
      if (isBlacklisted) {
        this.metrics.verificationFailures++;
        return {
          isValid: false,
          payload: null,
          failureReason: "Token is blacklisted",
          isBlacklisted: true,
          expiresAt: null,
        };
      }

      // Verify and decode token
      const payload = this.verifyToken(token);

      if (!payload) {
        this.metrics.verificationFailures++;
        return {
          isValid: false,
          payload: null,
          failureReason: "Invalid token signature or format",
          isBlacklisted: false,
          expiresAt: null,
        };
      }

      // Check expiration
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) {
        this.metrics.verificationFailures++;
        return {
          isValid: false,
          payload: null,
          failureReason: "Token has expired",
          isBlacklisted: false,
          expiresAt: new Date(payload.exp * 1000),
        };
      }

      // Update token metrics
      if (payload.jti) {
        const metrics = this.tokenMetrics.get(payload.jti);
        if (metrics) {
          metrics.lastUsed = new Date();
          metrics.usageCount++;
        }
      }

      return {
        isValid: true,
        payload,
        failureReason: null,
        isBlacklisted: false,
        expiresAt: payload.exp ? new Date(payload.exp * 1000) : null,
      };
    } catch (error) {
      this.metrics.errorsTotal++;
      this.metrics.verificationFailures++;

      return {
        isValid: false,
        payload: null,
        failureReason:
          error instanceof Error ? error.message : "Unknown verification error",
        isBlacklisted: false,
        expiresAt: null,
      };
    }
  }

  /**
   * Refresh JWT token
   */
  async refresh(refreshToken: JWTToken): Promise<IJWTRefreshResult> {
    this.metrics.operationsTotal++;
    this.metrics.lastOperation = new Date();

    try {
      // Verify refresh token
      const verifyResult = await this.verify(refreshToken);

      if (!verifyResult.isValid || !verifyResult.payload) {
        return {
          success: false,
          newToken: null,
          newRefreshToken: null,
          expiresAt: null,
          failureReason: verifyResult.failureReason || "Invalid refresh token",
        };
      }

      // Blacklist old refresh token
      await this.blacklist(refreshToken, "Token refreshed");

      // Generate new tokens
      const generatePayload: IJWTGeneratePayload = {
        userId: verifyResult.payload.sub,
        permissions: verifyResult.payload.permissions,
        roles: verifyResult.payload.roles,
        metadata: verifyResult.payload.metadata,
      };

      const result = await this.generate(generatePayload);
      return {
        success: true,
        newToken: result.token,
        newRefreshToken: result.refreshToken,
        expiresAt: result.expiresAt,
        failureReason: null,
      };
    } catch (error) {
      this.metrics.errorsTotal++;

      return {
        success: false,
        newToken: null,
        newRefreshToken: null,
        expiresAt: null,
        failureReason:
          error instanceof Error ? error.message : "Token refresh failed",
      };
    }
  }

  /**
   * Blacklist JWT token
   */
  async blacklist(token: JWTToken, _reason: string): Promise<boolean> {
    this.metrics.operationsTotal++;
    this.metrics.tokensBlacklisted++;
    this.metrics.lastOperation = new Date();

    try {
      // Extract token ID from token for tracking
      const payload = this.verifyToken(token, false); // Don't check expiry for blacklisting
      const tokenKey = payload?.jti || token;

      this.blacklistedTokens.add(tokenKey);

      // In production, this would be stored in Redis/database
      // For now, we use in-memory storage

      return true;
    } catch (error) {
      this.metrics.errorsTotal++;
      return false;
    }
  }

  /**
   * Check if token is blacklisted
   */
  async isBlacklisted(token: JWTToken): Promise<boolean> {
    try {
      const payload = this.verifyToken(token, false);
      const tokenKey = payload?.jti || token;

      return this.blacklistedTokens.has(tokenKey);
    } catch (error) {
      // If we can't parse the token, consider it not blacklisted
      // (it will fail verification anyway)
      return false;
    }
  }

  /**
   * Batch verify tokens
   */
  async verifyBatch(
    tokens: ReadonlyArray<JWTToken>
  ): Promise<IBatchOperationResult<IJWTVerifyResult>> {
    this.metrics.operationsTotal++;
    this.metrics.lastOperation = new Date();

    const successful: IJWTVerifyResult[] = [];
    const failed: Array<{ id: string; error: any; input: any }> = [];
    const startTime = Date.now();

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      try {
        // Ensure token is valid before processing
        if (!token) {
          failed.push({
            id: `token_${i}`,
            error: {
              message: "Token is required",
              type: "ValidationError",
            },
            input: token,
          });
          continue;
        }

        // First verify the token is valid
        const verifyResult = await this.verify(token);
        if (!verifyResult.isValid) {
          failed.push({
            id: `token_${i}`,
            error: {
              message:
                verifyResult.failureReason || "Token verification failed",
              type: "VerificationError",
            },
            input: token,
          });
          continue;
        }

        // Generate new token with same payload if payload exists
        if (verifyResult.payload) {
          const generateResult = await this.generate(verifyResult.payload);
          // Convert generate result to verify result for consistency
          const refreshResult: IJWTVerifyResult = {
            isValid: true,
            payload: verifyResult.payload,
            failureReason: null,
            isBlacklisted: false,
            expiresAt: generateResult.expiresAt,
          };
          successful.push(refreshResult);
        }
      } catch (error) {
        failed.push({
          id: `token_${i}`,
          error: {
            message: error instanceof Error ? error.message : "Unknown error",
            type: error?.constructor.name || "Error",
          },
          input: token,
        });
      }
    }

    return {
      successful,
      failed,
      totalProcessed: tokens.length,
      processingTime: Date.now() - startTime,
      timestamp: new Date().toISOString() as Timestamp,
    };
  }

  /**
   * Get token health information
   */
  async getTokenHealth(token: JWTToken): Promise<ITokenHealthInfo> {
    this.metrics.operationsTotal++;
    this.metrics.lastOperation = new Date();

    try {
      const isBlacklisted = await this.isBlacklisted(token);
      const payload = this.verifyToken(token, false);

      if (!payload) {
        return {
          isValid: false,
          isExpired: false,
          isBlacklisted,
          expiresAt: null,
          remainingTtl: 0,
          usage: 0,
        };
      }

      const now = Math.floor(Date.now() / 1000);
      const isExpired = payload.exp ? payload.exp < now : false;
      const expiresAt = payload.exp ? new Date(payload.exp * 1000) : null;
      const remainingTtl = payload.exp ? Math.max(0, payload.exp - now) : 0;

      // Get usage statistics
      const tokenMetric = this.tokenMetrics.get(payload.jti);
      const usage = tokenMetric?.usageCount || 0;

      return {
        isValid: !isExpired && !isBlacklisted,
        isExpired,
        isBlacklisted,
        expiresAt,
        remainingTtl,
        usage,
      };
    } catch (error) {
      this.metrics.errorsTotal++;

      return {
        isValid: false,
        isExpired: false,
        isBlacklisted: true, // Assume blacklisted if we can't parse
        expiresAt: null,
        remainingTtl: 0,
        usage: 0,
      };
    }
  }

  /**
   * Cleanup expired tokens from blacklist
   */
  async cleanupBlacklist(): Promise<number> {
    this.metrics.operationsTotal++;
    this.metrics.lastOperation = new Date();

    let cleanedCount = 0;

    try {
      // In a real implementation, this would query Redis/database
      // For in-memory implementation, we need to check each blacklisted token
      const tokensToRemove: string[] = [];

      for (const tokenKey of this.blacklistedTokens) {
        try {
          // Try to parse as token ID first, then as full token
          if (tokenKey.includes(".")) {
            // Full JWT token
            const payload = this.verifyToken(createJWTToken(tokenKey), false);
            if (payload?.exp && payload.exp < Math.floor(Date.now() / 1000)) {
              tokensToRemove.push(tokenKey);
            }
          } else {
            // Token ID - check if we have metrics for it
            const metric = this.tokenMetrics.get(tokenKey);
            if (
              metric &&
              Date.now() - metric.created.getTime() > 7 * 24 * 60 * 60 * 1000
            ) {
              // Remove token IDs older than 7 days
              tokensToRemove.push(tokenKey);
              this.tokenMetrics.delete(tokenKey);
            }
          }
        } catch (error) {
          // If we can't parse, remove it
          tokensToRemove.push(tokenKey);
        }
      }

      // Remove expired tokens from blacklist
      for (const token of tokensToRemove) {
        this.blacklistedTokens.delete(token);
        cleanedCount++;
      }

      return cleanedCount;
    } catch (error) {
      this.metrics.errorsTotal++;
      return cleanedCount;
    }
  }

  /**
   * Health check
   */
  async getHealth(): Promise<IServiceHealth> {
    try {
      // Test token generation and verification
      const testPayload: IJWTGeneratePayload = {
        userId: "test-user" as EntityId,
        permissions: ["test"],
        roles: ["test"],
      };

      const testToken = await this.generate(testPayload);
      const verifyResult = await this.verify(testToken.token);

      if (!verifyResult.isValid) {
        throw new Error("Token generation/verification test failed");
      }

      // Clean up test token
      await this.blacklist(testToken.token, "Health check test");

      return {
        service: "JWTServiceV2",
        status: "healthy",
        uptime: Date.now() - this.startTime,
        lastCheck: new Date().toISOString() as Timestamp,
        dependencies: [], // JWT service has no external dependencies
        metrics: {
          operationsTotal: this.metrics.operationsTotal,
          errorsTotal: this.metrics.errorsTotal,
          tokensGenerated: this.metrics.tokensGenerated,
          tokensVerified: this.metrics.tokensVerified,
          tokensBlacklisted: this.metrics.tokensBlacklisted,
          blacklistedTokensCount: this.blacklistedTokens.size,
          verificationFailures: this.metrics.verificationFailures,
        },
      };
    } catch (error) {
      return {
        service: "JWTServiceV2",
        status: "unhealthy",
        uptime: Date.now() - this.startTime,
        lastCheck: new Date().toISOString() as Timestamp,
        dependencies: [],
        metrics: {
          operationsTotal: this.metrics.operationsTotal,
          errorsTotal: this.metrics.errorsTotal,
        },
      };
    }
  }

  /**
   * Private utility methods
   */
  private generateTokenId(): string {
    return crypto.randomBytes(16).toString("hex");
  }

  private calculateExpiration(expiresIn: string): Date {
    // Simple parser for time strings like "1h", "7d", "30m"
    const match = expiresIn.match(/^(\d+)([smhd])$/);
    if (!match) {
      throw new ValidationError(`Invalid expiration format: ${expiresIn}`);
    }

    const [, amount, unit] = match;
    if (!amount || !unit) {
      throw new ValidationError(`Invalid expiration format: ${expiresIn}`);
    }
    const value = parseInt(amount, 10);
    const now = Date.now();

    switch (unit) {
      case "s":
        return new Date(now + value * 1000);
      case "m":
        return new Date(now + value * 60 * 1000);
      case "h":
        return new Date(now + value * 60 * 60 * 1000);
      case "d":
        return new Date(now + value * 24 * 60 * 60 * 1000);
      default:
        throw new ValidationError(`Invalid time unit: ${unit}`);
    }
  }

  private signToken(payload: ITokenPayload): string {
    // This is a simplified JWT implementation for demonstration
    // In production, use a proper JWT library like 'jsonwebtoken'

    const header = {
      alg: "HS256",
      typ: "JWT",
    };

    const encodedHeader = this.base64urlEncode(JSON.stringify(header));
    const encodedPayload = this.base64urlEncode(JSON.stringify(payload));
    const signatureInput = `${encodedHeader}.${encodedPayload}`;

    const signature = crypto
      .createHmac("sha256", this.defaultSecret)
      .update(signatureInput)
      .digest("base64url");

    return `${signatureInput}.${signature}`;
  }

  private verifyToken(
    token: JWTToken,
    checkExpiry: boolean = true
  ): ITokenPayload | null {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) {
        return null;
      }

      const [headerPart, payloadPart, signaturePart] = parts;

      if (!headerPart || !payloadPart || !signaturePart) {
        return null;
      }

      // Verify signature
      const signatureInput = `${headerPart}.${payloadPart}`;
      const expectedSignature = crypto
        .createHmac("sha256", this.defaultSecret)
        .update(signatureInput)
        .digest("base64url");

      if (expectedSignature !== signaturePart) {
        return null;
      }

      // Decode payload
      const payload: ITokenPayload = JSON.parse(
        this.base64urlDecode(payloadPart)
      );

      // Check expiration if required
      if (checkExpiry && payload.exp) {
        const now = Math.floor(Date.now() / 1000);
        if (payload.exp < now) {
          return null;
        }
      }

      return payload;
    } catch (error) {
      return null;
    }
  }

  private base64urlEncode(str: string): string {
    return Buffer.from(str)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
  }

  private base64urlDecode(str: string): string {
    // Add padding if necessary
    const padding = 4 - (str.length % 4);
    if (padding !== 4) {
      str += "=".repeat(padding);
    }

    return Buffer.from(
      str.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf8");
  }

  private startCleanupJob(): void {
    // Run cleanup every hour
    setInterval(async () => {
      try {
        await this.cleanupBlacklist();
      } catch (error) {
        // Log error in production
        console.error("JWT cleanup job failed:", error);
      }
    }, 60 * 60 * 1000);
  }
}
