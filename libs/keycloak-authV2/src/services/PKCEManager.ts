/**
 * PKCE (Proof Key for Code Exchange) Manager
 * Implements RFC 7636 for OAuth 2.1 and OpenID Connect security enhancements
 * Provides secure code verifier/challenge generation, validation, and management
 *
 * Enhanced with battle-tested 'pkce-challenge' npm package for core PKCE operations
 */

import crypto from "crypto";
// @ts-ignore - pkce-challenge doesn't have TypeScript definitions
import pkceChallenge from "pkce-challenge";
import { createLogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import { CacheService } from "@libs/database";

/**
 * PKCE configuration options
 */
export interface PKCEConfig {
  /** Code verifier length (43-128 characters, default: 128) */
  codeVerifierLength: number;
  /** Code challenge method (S256 only for security) */
  codeChallengeMethod: "S256";
  /** Cache TTL for PKCE pairs in seconds (default: 600 = 10 minutes) */
  cacheTTL: number;
  /** Maximum number of concurrent PKCE sessions per user (default: 5) */
  maxConcurrentSessions: number;
  /** Enable metrics collection (default: true) */
  enableMetrics: boolean;
}

/**
 * PKCE key pair with metadata
 */
export interface PKCEPair {
  readonly codeVerifier: string;
  readonly codeChallenge: string;
  readonly codeChallengeMethod: "S256";
  readonly state: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly userId?: string | undefined;
  readonly clientId?: string | undefined;
  readonly sessionId: string;
}

/**
 * PKCE validation result
 */
export interface PKCEValidationResult {
  readonly valid: boolean;
  readonly pkce?: PKCEPair;
  readonly error?: string;
  readonly errorCode?: string;
}

/**
 * Default PKCE configuration
 */
export const DEFAULT_PKCE_CONFIG: PKCEConfig = {
  codeVerifierLength: 128,
  codeChallengeMethod: "S256",
  cacheTTL: 600, // 10 minutes
  maxConcurrentSessions: 5,
  enableMetrics: true,
};

/**
 * PKCE Manager Service
 * Handles secure PKCE flows for OAuth 2.1 and OpenID Connect
 */
export class PKCEManager {
  private readonly logger = createLogger("PKCEManager");
  private cacheService?: CacheService;
  private readonly config: PKCEConfig;

  constructor(
    config: Partial<PKCEConfig> = {},
    private readonly metrics?: IMetricsCollector
  ) {
    this.config = { ...DEFAULT_PKCE_CONFIG, ...config };

    // Initialize cache service for PKCE pair storage
    if (this.metrics) {
      this.cacheService = CacheService.create(this.metrics);
    }

    this.logger.info("PKCE Manager initialized", {
      codeVerifierLength: this.config.codeVerifierLength,
      cacheTTL: this.config.cacheTTL,
      maxConcurrentSessions: this.config.maxConcurrentSessions,
      cacheEnabled: !!this.cacheService,
    });
  }

  /**
   * Generate a cryptographically secure code verifier using battle-tested package
   */
  generateCodeVerifier(): string {
    const { code_verifier } = pkceChallenge({
      length: this.config.codeVerifierLength,
      method: "S256",
    });
    return code_verifier;
  }

  /**
   * Generate code challenge from verifier using battle-tested package
   */
  generateCodeChallenge(codeVerifier: string): string {
    if (!this.isValidCodeVerifier(codeVerifier)) {
      throw new Error(
        'Invalid code verifier: must be 43-128 characters using [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"'
      );
    }

    // Use the battle-tested package for challenge generation
    const { code_challenge } = pkceChallenge({
      code_verifier: codeVerifier,
      method: "S256",
    });
    return code_challenge;
  }

  /**
   * Generate complete PKCE pair with state and metadata
   */
  async generatePKCEPair(
    options: {
      userId?: string;
      clientId?: string;
      customTTL?: number;
    } = {}
  ): Promise<PKCEPair> {
    const startTime = performance.now();

    try {
      // Check concurrent session limits if userId provided
      if (options.userId) {
        await this.enforceConcurrentSessionLimits(options.userId);
      }

      const codeVerifier = this.generateCodeVerifier();
      const codeChallenge = this.generateCodeChallenge(codeVerifier);
      const state = this.generateSecureState();
      const sessionId = this.generateSessionId();
      const now = new Date();
      const ttl = options.customTTL || this.config.cacheTTL;

      const pkcePair: PKCEPair = {
        codeVerifier,
        codeChallenge,
        codeChallengeMethod: "S256",
        state,
        createdAt: now,
        expiresAt: new Date(now.getTime() + ttl * 1000),
        userId: options.userId,
        clientId: options.clientId,
        sessionId,
      };

      // Store in cache for later validation
      if (this.cacheService) {
        const cacheKey = this.getCacheKey(state);
        await this.cacheService.set(cacheKey, pkcePair, ttl);
      }

      // Record metrics
      this.metrics?.recordCounter("pkce.pair_generated", 1);
      this.metrics?.recordTimer(
        "pkce.generation_duration",
        performance.now() - startTime
      );

      this.logger.debug("PKCE pair generated", {
        sessionId,
        userId: options.userId,
        clientId: options.clientId,
        ttl,
        codeChallengeLength: codeChallenge.length,
      });

      return pkcePair;
    } catch (error) {
      this.metrics?.recordCounter("pkce.generation_error", 1);
      this.logger.error("Failed to generate PKCE pair", { error, options });
      throw new Error("PKCE pair generation failed");
    }
  }

  /**
   * Validate code verifier against stored PKCE pair
   */
  async validatePKCE(
    state: string,
    codeVerifier: string
  ): Promise<PKCEValidationResult> {
    const startTime = performance.now();

    try {
      if (!state || !codeVerifier) {
        return {
          valid: false,
          error: "Missing state or code verifier",
          errorCode: "invalid_request",
        };
      }

      // Retrieve PKCE pair from cache
      let pkcePair: PKCEPair | undefined;
      if (this.cacheService) {
        const cacheKey = this.getCacheKey(state);
        const cached = await this.cacheService.get<PKCEPair>(cacheKey);
        pkcePair = cached.data || undefined;
      }

      if (!pkcePair) {
        this.metrics?.recordCounter("pkce.validation_not_found", 1);
        return {
          valid: false,
          error: "PKCE pair not found or expired",
          errorCode: "invalid_grant",
        };
      }

      // Check expiration
      if (new Date() > pkcePair.expiresAt) {
        this.metrics?.recordCounter("pkce.validation_expired", 1);
        return {
          valid: false,
          error: "PKCE pair has expired",
          errorCode: "invalid_grant",
        };
      }

      // Validate code verifier using battle-tested approach
      const { code_challenge: expectedChallenge } = pkceChallenge({
        code_verifier: codeVerifier,
        method: "S256",
      });
      const isValid = pkcePair.codeChallenge === expectedChallenge;

      if (!isValid) {
        this.metrics?.recordCounter("pkce.validation_failed", 1);
        this.logger.warn("PKCE validation failed - challenge mismatch", {
          sessionId: pkcePair.sessionId,
          userId: pkcePair.userId,
          expectedLength: expectedChallenge.length,
          actualLength: pkcePair.codeChallenge.length,
        });

        return {
          valid: false,
          error: "Code challenge verification failed",
          errorCode: "invalid_grant",
        };
      }

      // Clean up used PKCE pair
      if (this.cacheService) {
        const cacheKey = this.getCacheKey(state);
        await this.cacheService.invalidate(cacheKey);
      }

      // Record successful validation
      this.metrics?.recordCounter("pkce.validation_success", 1);
      this.metrics?.recordTimer(
        "pkce.validation_duration",
        performance.now() - startTime
      );

      this.logger.debug("PKCE validation successful", {
        sessionId: pkcePair.sessionId,
        userId: pkcePair.userId,
        clientId: pkcePair.clientId,
      });

      return {
        valid: true,
        pkce: pkcePair,
      };
    } catch (error) {
      this.metrics?.recordCounter("pkce.validation_error", 1);
      this.logger.error("PKCE validation error", { error, state });

      return {
        valid: false,
        error: "PKCE validation failed due to internal error",
        errorCode: "server_error",
      };
    }
  }

  /**
   * Generate authorization URL with PKCE parameters
   */
  addPKCEToAuthorizationUrl(
    baseUrl: string,
    pkcePair: PKCEPair,
    additionalParams: Record<string, string> = {}
  ): string {
    try {
      const url = new URL(baseUrl);

      // Add PKCE parameters
      url.searchParams.set("code_challenge", pkcePair.codeChallenge);
      url.searchParams.set(
        "code_challenge_method",
        pkcePair.codeChallengeMethod
      );
      url.searchParams.set("state", pkcePair.state);

      // Add additional parameters
      Object.entries(additionalParams).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });

      this.logger.debug("Authorization URL enhanced with PKCE", {
        sessionId: pkcePair.sessionId,
        hasState: !!pkcePair.state,
        hasChallenge: !!pkcePair.codeChallenge,
        additionalParamsCount: Object.keys(additionalParams).length,
      });

      return url.toString();
    } catch (error) {
      this.logger.error("Failed to add PKCE to authorization URL", {
        error,
        baseUrl,
      });
      throw new Error("Invalid authorization URL format");
    }
  }

  /**
   * Clean up expired PKCE pairs
   * Should be called periodically by a background job
   */
  async cleanupExpiredPairs(): Promise<number> {
    // Note: This would be implemented with a proper cache cleanup mechanism
    // For now, we rely on Redis TTL for automatic cleanup
    this.logger.debug(
      "PKCE cleanup triggered - relying on cache TTL for expired pairs"
    );
    return 0;
  }

  /**
   * Get PKCE statistics for monitoring
   */
  getStats(): {
    cacheEnabled: boolean;
    config: PKCEConfig;
    uptime: number;
  } {
    return {
      cacheEnabled: !!this.cacheService,
      config: { ...this.config },
      uptime: process.uptime(),
    };
  }

  /**
   * Validate code verifier format according to RFC 7636
   */
  private isValidCodeVerifier(codeVerifier: string): boolean {
    // RFC 7636: 43-128 characters, [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"
    const validPattern = /^[A-Za-z0-9\-._~]{43,128}$/;
    return validPattern.test(codeVerifier);
  }

  /**
   * Generate secure state parameter
   */
  private generateSecureState(): string {
    return crypto.randomBytes(32).toString("base64url");
  }

  /**
   * Generate unique session ID for PKCE pair
   */
  private generateSessionId(): string {
    return crypto.randomUUID() + "." + Date.now().toString(36);
  }

  /**
   * Generate cache key for PKCE pair storage
   */
  private getCacheKey(state: string): string {
    return `pkce:${crypto
      .createHash("sha256")
      .update(state)
      .digest("hex")
      .substring(0, 32)}`;
  }

  /**
   * Enforce concurrent session limits for PKCE pairs
   */
  private async enforceConcurrentSessionLimits(userId: string): Promise<void> {
    // Note: This would require a more sophisticated cache implementation
    // to track concurrent sessions per user. For now, we log the intent.
    this.logger.debug("Concurrent session limit check", {
      userId: userId.substring(0, 8) + "...",
      maxSessions: this.config.maxConcurrentSessions,
    });
  }
}

/**
 * Create PKCE Manager instance with configuration
 */
export function createPKCEManager(
  config?: Partial<PKCEConfig>,
  metrics?: IMetricsCollector
): PKCEManager {
  return new PKCEManager(config, metrics);
}

/**
 * Utility functions for PKCE operations using battle-tested package
 */
export const PKCEUtils = {
  /**
   * Generate a single code verifier using battle-tested package
   */
  generateCodeVerifier: (length = 128): string => {
    const { code_verifier } = pkceChallenge({
      length,
      method: "S256",
    });
    return code_verifier;
  },

  /**
   * Generate code challenge from verifier using battle-tested package
   */
  generateCodeChallenge: (codeVerifier: string): string => {
    const { code_challenge } = pkceChallenge({
      code_verifier: codeVerifier,
      method: "S256",
    });
    return code_challenge;
  },

  /**
   * Validate code verifier format
   */
  isValidCodeVerifier: (codeVerifier: string): boolean => {
    const validPattern = /^[A-Za-z0-9\-._~]{43,128}$/;
    return validPattern.test(codeVerifier);
  },

  /**
   * Generate PKCE pair (standalone utility) using battle-tested package
   */
  generatePKCEPair: (): {
    codeVerifier: string;
    codeChallenge: string;
    state: string;
  } => {
    const { code_verifier, code_challenge } = pkceChallenge({
      length: 128,
      method: "S256",
    });
    const state = crypto.randomBytes(32).toString("base64url");

    return {
      codeVerifier: code_verifier,
      codeChallenge: code_challenge,
      state,
    };
  },
};

export default PKCEManager;
