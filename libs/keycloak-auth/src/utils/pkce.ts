/**
 * PKCE (Proof Key for Code Exchange) Utilities
 * Implements RFC 7636 for enhanced security in OAuth Authorization Code flow
 */

import { randomBytes, createHash } from "crypto";

/**
 * Generate a cryptographically secure code verifier for PKCE
 * @param length Length of the code verifier (43-128 characters, default 128)
 * @returns Base64URL-encoded code verifier
 */
export function generateCodeVerifier(length: number = 128): string {
  if (length < 43 || length > 128) {
    throw new Error(
      "Code verifier length must be between 43 and 128 characters"
    );
  }

  // Generate random bytes and encode as base64url
  const buffer = randomBytes(Math.ceil((length * 3) / 4));
  return base64URLEncode(buffer).slice(0, length);
}

/**
 * Generate code challenge from code verifier using S256 method
 * @param codeVerifier The code verifier string
 * @returns Base64URL-encoded SHA256 hash of the code verifier
 */
export function generateCodeChallenge(codeVerifier: string): string {
  const hash = createHash("sha256").update(codeVerifier).digest();
  return base64URLEncode(hash);
}

/**
 * Generate both code verifier and challenge
 * @param length Length of the code verifier (43-128 characters, default 128)
 * @returns Object containing both codeVerifier and codeChallenge
 */
export function generatePKCEPair(length: number = 128): {
  codeVerifier: string;
  codeChallenge: string;
} {
  const codeVerifier = generateCodeVerifier(length);
  const codeChallenge = generateCodeChallenge(codeVerifier);

  return {
    codeVerifier,
    codeChallenge,
  };
}

/**
 * Validate PKCE code verifier format
 * @param codeVerifier The code verifier to validate
 * @returns True if valid, false otherwise
 */
export function validateCodeVerifier(codeVerifier: string): boolean {
  // RFC 7636: code verifier must be 43-128 characters long
  // and contain only unreserved characters [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"
  const codeVerifierRegex = /^[A-Za-z0-9\-\._~]{43,128}$/;
  return codeVerifierRegex.test(codeVerifier);
}

/**
 * Validate PKCE code challenge format
 * @param codeChallenge The code challenge to validate
 * @returns True if valid, false otherwise
 */
export function validateCodeChallenge(codeChallenge: string): boolean {
  // Code challenge should be base64url encoded (43 characters for S256)
  const codeChallengeRegex = /^[A-Za-z0-9\-_]{43}$/;
  return codeChallengeRegex.test(codeChallenge);
}

/**
 * Verify code verifier against code challenge
 * @param codeVerifier The original code verifier
 * @param codeChallenge The code challenge to verify against
 * @returns True if verification succeeds
 */
export function verifyPKCE(
  codeVerifier: string,
  codeChallenge: string
): boolean {
  if (
    !validateCodeVerifier(codeVerifier) ||
    !validateCodeChallenge(codeChallenge)
  ) {
    return false;
  }

  const generatedChallenge = generateCodeChallenge(codeVerifier);
  return generatedChallenge === codeChallenge;
}

/**
 * Base64URL encode a buffer (without padding)
 * @param buffer Buffer to encode
 * @returns Base64URL encoded string
 */
function base64URLEncode(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/**
 * PKCE Configuration interface
 */
export interface PKCEConfig {
  /** Length of the code verifier (43-128 characters) */
  codeVerifierLength: number;
  /** Whether to enforce PKCE for all public clients */
  enforceForPublicClients: boolean;
  /** Whether to allow PKCE for confidential clients */
  allowForConfidentialClients: boolean;
}

/**
 * Default PKCE configuration
 */
export const DEFAULT_PKCE_CONFIG: PKCEConfig = {
  codeVerifierLength: 128,
  enforceForPublicClients: true,
  allowForConfidentialClients: true,
};

/**
 * PKCE Manager class for handling PKCE flows with proper memory management
 */
export class PKCEManager {
  private config: PKCEConfig;
  private activeChallenges = new Map<
    string,
    {
      codeVerifier: string;
      timestamp: number;
      accessed: number;
    }
  >(); // Enhanced tracking with timestamps

  // Memory management settings
  private readonly maxChallenges = 1000; // Maximum stored challenges
  private readonly defaultMaxAge = 10 * 60 * 1000; // 10 minutes default
  private readonly cleanupInterval = 5 * 60 * 1000; // 5 minutes cleanup
  private cleanupTimer?: ReturnType<typeof setInterval> | undefined;
  private isShuttingDown = false;

  constructor(config: Partial<PKCEConfig> = {}) {
    this.config = { ...DEFAULT_PKCE_CONFIG, ...config };
    this.startCleanupTimer();
  }

  /**
   * Generate and store PKCE pair for a state with timestamp tracking
   * @param state OAuth state parameter
   * @returns PKCE pair
   */
  public generateAndStore(state: string): {
    codeVerifier: string;
    codeChallenge: string;
  } {
    const { codeVerifier, codeChallenge } = generatePKCEPair(
      this.config.codeVerifierLength
    );

    const now = Date.now();

    // Proactive cleanup before adding if approaching limits
    if (this.activeChallenges.size >= this.maxChallenges - 10) {
      this.cleanup(this.defaultMaxAge);
    }

    // Store code verifier with timestamp for proper cleanup
    this.activeChallenges.set(state, {
      codeVerifier,
      timestamp: now,
      accessed: now,
    });

    return { codeVerifier, codeChallenge };
  }

  /**
   * Retrieve and remove code verifier for a state
   * @param state OAuth state parameter
   * @returns Code verifier if found
   */
  public retrieveAndRemove(state: string): string | undefined {
    const challenge = this.activeChallenges.get(state);
    if (challenge) {
      this.activeChallenges.delete(state);
      // Update access time for monitoring
      challenge.accessed = Date.now();
      return challenge.codeVerifier;
    }
    return undefined;
  }

  /**
   * Cleanup expired challenges with proper timestamp-based logic
   * @param maxAge Maximum age in milliseconds (default: 10 minutes)
   */
  public cleanup(maxAge: number = this.defaultMaxAge): number {
    if (this.isShuttingDown) {
      // During shutdown, clear everything
      const count = this.activeChallenges.size;
      this.activeChallenges.clear();
      return count;
    }

    const now = Date.now();
    let removedCount = 0;

    // Remove expired challenges based on timestamp
    for (const [state, challenge] of this.activeChallenges.entries()) {
      const age = now - challenge.timestamp;
      if (age > maxAge) {
        this.activeChallenges.delete(state);
        removedCount++;
      }
    }

    // Enforce maximum size with LRU eviction if still over limit
    if (this.activeChallenges.size > this.maxChallenges) {
      const excess = this.activeChallenges.size - this.maxChallenges;
      removedCount += this.evictOldestChallenges(excess);
    }

    return removedCount;
  }

  /**
   * Evict oldest challenges (LRU-style eviction)
   * @param count Number of challenges to evict
   * @returns Number of challenges actually evicted
   */
  private evictOldestChallenges(count: number): number {
    if (count <= 0) return 0;

    // Sort by timestamp (oldest first)
    const entries = Array.from(this.activeChallenges.entries()).sort(
      ([, a], [, b]) => a.timestamp - b.timestamp
    );

    let removedCount = 0;
    for (let i = 0; i < count && i < entries.length; i++) {
      const entry = entries[i];
      if (entry) {
        const [state] = entry;
        this.activeChallenges.delete(state);
        removedCount++;
      }
    }

    return removedCount;
  }

  /**
   * Start automatic cleanup timer
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      const removed = this.cleanup();
      if (removed > 0) {
        console.debug(`PKCE cleanup removed ${removed} expired challenges`);
      }
    }, this.cleanupInterval);

    // Ensure timer doesn't prevent process exit
    this.cleanupTimer.unref();
  }

  /**
   * Shutdown cleanup timer and clear all challenges
   */
  public shutdown(): void {
    this.isShuttingDown = true;

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    const challengeCount = this.activeChallenges.size;
    this.activeChallenges.clear();

    console.info(`PKCE Manager shutdown: cleared ${challengeCount} challenges`);
  }

  /**
   * Get active challenges count (for monitoring)
   */
  public getActiveChallengesCount(): number {
    return this.activeChallenges.size;
  }

  /**
   * Get detailed health statistics for monitoring
   */
  public getHealthStats(): {
    totalChallenges: number;
    maxChallenges: number;
    oldestChallengeAge: number;
    averageAge: number;
    shutdownStatus: boolean;
  } {
    const now = Date.now();
    const challenges = Array.from(this.activeChallenges.values());

    const ages = challenges.map((c) => now - c.timestamp);
    const oldestAge = ages.length > 0 ? Math.max(...ages) : 0;
    const averageAge =
      ages.length > 0 ? ages.reduce((a, b) => a + b, 0) / ages.length : 0;

    return {
      totalChallenges: this.activeChallenges.size,
      maxChallenges: this.maxChallenges,
      oldestChallengeAge: oldestAge,
      averageAge: averageAge,
      shutdownStatus: this.isShuttingDown,
    };
  }
}

/**
 * Singleton PKCE manager instance
 */
export const pkceManager = new PKCEManager();

/**
 * Helper function for creating PKCE-enabled authorization URLs
 * @param baseUrl The base authorization URL
 * @param state OAuth state parameter
 * @returns Enhanced URL with PKCE parameters
 */
export function addPKCEToAuthorizationUrl(
  baseUrl: string,
  state: string
): {
  url: string;
  codeVerifier: string;
} {
  const { codeVerifier, codeChallenge } = pkceManager.generateAndStore(state);

  const url = new URL(baseUrl);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  return {
    url: url.toString(),
    codeVerifier,
  };
}

/**
 * Helper function for token exchange with PKCE
 * @param state OAuth state parameter
 * @returns Code verifier for token exchange
 */
export function getPKCEVerifierForTokenExchange(
  state: string
): string | undefined {
  return pkceManager.retrieveAndRemove(state);
}
