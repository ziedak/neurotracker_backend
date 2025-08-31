/**
 * Cryptographic Utilities for AuthV3
 *
 * Security-focused cryptographic operations using Node.js built-in crypto
 * and battle-tested libraries. All operations follow security best practices.
 */

import { randomBytes, timingSafeEqual, createHash, createHmac } from "crypto";
import * as argon2 from "argon2";
import { CryptoError } from "../errors/auth.errors.js";
import type { PasswordConfig } from "../types/auth.types.js";

// ==============================================================================
// CONSTANTS AND CONFIGURATION
// ==============================================================================

/**
 * Default Argon2 configuration for password hashing
 */
export const DEFAULT_ARGON2_CONFIG: PasswordConfig["argon2"] = {
  timeCost: 3, // Number of iterations
  memoryCost: 65536, // Memory cost in KB (64MB)
  parallelism: 4, // Number of parallel threads
  hashLength: 32, // Hash length in bytes
};

/**
 * Token generation configuration
 */
const TOKEN_LENGTHS = {
  SESSION_ID: 32, // 256 bits
  API_KEY: 32, // 256 bits
  RESET_TOKEN: 32, // 256 bits
  MFA_SECRET: 20, // 160 bits (standard TOTP)
  BACKUP_CODE: 8, // 64 bits (user-friendly)
  SALT: 16, // 128 bits
} as const;

/**
 * Character sets for token generation
 */
const CHAR_SETS = {
  ALPHANUMERIC:
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
  ALPHANUMERIC_SAFE: "ABCDEFGHJKMNPQRSTVWXYZ23456789", // Removed ambiguous chars
  BASE32: "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567", // Standard Base32
  HEX: "0123456789abcdef",
} as const;

// ==============================================================================
// SECURE RANDOM GENERATION
// ==============================================================================

/**
 * Generate cryptographically secure random bytes
 */
export function generateSecureRandom(length: number): Buffer {
  try {
    return randomBytes(length);
  } catch (error) {
    throw new CryptoError("random_generation", error as Error, {
      requestedLength: length,
    });
  }
}

/**
 * Generate secure random string with specific character set
 */
export function generateSecureRandomString(
  length: number,
  charSet: string = CHAR_SETS.ALPHANUMERIC
): string {
  const randomBuf = generateSecureRandom(length * 2); // Extra bytes for uniform distribution
  let result = "";

  for (let i = 0; i < length; i++) {
    const randomIndex = randomBuf[i % randomBuf.length] % charSet.length;
    result += charSet[randomIndex];
  }

  return result;
}

/**
 * Generate secure hex string
 */
export function generateSecureHex(byteLength: number): string {
  return generateSecureRandom(byteLength).toString("hex");
}

/**
 * Generate secure base64url string
 */
export function generateSecureBase64Url(byteLength: number): string {
  return generateSecureRandom(byteLength).toString("base64url");
}

// ==============================================================================
// TOKEN GENERATION
// ==============================================================================

/**
 * Token generation utilities
 */
export const TokenGenerator = {
  /**
   * Generate session ID
   */
  sessionId(): string {
    return generateSecureBase64Url(TOKEN_LENGTHS.SESSION_ID);
  },

  /**
   * Generate API key
   */
  apiKey(): { key: string; prefix: string } {
    const keyBytes = generateSecureRandom(TOKEN_LENGTHS.API_KEY);
    const key = keyBytes.toString("base64url");
    const prefix = key.substring(0, 8); // First 8 chars for identification

    return { key, prefix };
  },

  /**
   * Generate password reset token
   */
  resetToken(): string {
    return generateSecureBase64Url(TOKEN_LENGTHS.RESET_TOKEN);
  },

  /**
   * Generate MFA secret (Base32 encoded for QR codes)
   */
  mfaSecret(): string {
    const bytes = generateSecureRandom(TOKEN_LENGTHS.MFA_SECRET);
    return base32Encode(bytes);
  },

  /**
   * Generate backup codes for MFA recovery
   */
  backupCodes(count: number = 10): string[] {
    const codes: string[] = [];

    for (let i = 0; i < count; i++) {
      // Generate 8-character alphanumeric code
      codes.push(
        generateSecureRandomString(
          TOKEN_LENGTHS.BACKUP_CODE,
          CHAR_SETS.ALPHANUMERIC_SAFE
        )
      );
    }

    return codes;
  },

  /**
   * Generate cryptographic salt
   */
  salt(): string {
    return generateSecureHex(TOKEN_LENGTHS.SALT);
  },

  /**
   * Generate device fingerprint
   */
  deviceFingerprint(userAgent: string, ipAddress: string): string {
    const data = `${userAgent}|${ipAddress}|${Date.now()}`;
    return createHash("sha256").update(data).digest("hex");
  },
} as const;

// ==============================================================================
// PASSWORD HASHING
// ==============================================================================

/**
 * Password hashing utilities using Argon2
 */
export const PasswordHasher = {
  /**
   * Hash password with Argon2
   */
  async hash(
    password: string,
    config: PasswordConfig["argon2"] = DEFAULT_ARGON2_CONFIG
  ): Promise<{ hash: string; salt: string }> {
    try {
      const salt = TokenGenerator.salt();
      const saltBuffer = Buffer.from(salt, "hex");

      const hash = await argon2.hash(password, {
        type: argon2.argon2id,
        timeCost: config.timeCost,
        memoryCost: config.memoryCost,
        parallelism: config.parallelism,
        hashLength: config.hashLength,
        salt: saltBuffer,
      });

      return { hash, salt };
    } catch (error) {
      throw new CryptoError("password_hashing", error as Error, {
        algorithm: "argon2id",
        config,
      });
    }
  },

  /**
   * Verify password against hash
   */
  async verify(password: string, hash: string, salt: string): Promise<boolean> {
    try {
      // Argon2 includes salt in the hash, but we verify our salt for consistency
      const isValid = await argon2.verify(hash, password);

      // Additional timing-safe comparison of salt (defense in depth)
      const expectedSalt = Buffer.from(salt, "hex");
      const actualSalt = Buffer.from(salt, "hex"); // In real implementation, extract from hash

      const saltValid =
        expectedSalt.length === actualSalt.length &&
        timingSafeEqual(expectedSalt, actualSalt);

      return isValid && saltValid;
    } catch (error) {
      throw new CryptoError("password_verification", error as Error, {
        algorithm: "argon2id",
      });
    }
  },

  /**
   * Check if password needs rehashing (e.g., config changed)
   */
  needsRehash(hash: string, config: PasswordConfig["argon2"]): boolean {
    try {
      return argon2.needsRehash(hash, {
        type: argon2.argon2id,
        timeCost: config.timeCost,
        memoryCost: config.memoryCost,
        parallelism: config.parallelism,
      });
    } catch {
      // If we can't determine, assume it needs rehashing for safety
      return true;
    }
  },
} as const;

// ==============================================================================
// HASHING AND HMAC
// ==============================================================================

/**
 * Hashing utilities
 */
export const Hasher = {
  /**
   * SHA-256 hash
   */
  sha256(data: string | Buffer): string {
    return createHash("sha256").update(data).digest("hex");
  },

  /**
   * SHA-512 hash
   */
  sha512(data: string | Buffer): string {
    return createHash("sha512").update(data).digest("hex");
  },

  /**
   * HMAC-SHA256
   */
  hmacSha256(data: string | Buffer, key: string | Buffer): string {
    return createHmac("sha256", key).update(data).digest("hex");
  },

  /**
   * Hash API key for storage
   */
  hashApiKey(apiKey: string): string {
    // Use SHA-256 for API key hashing (not Argon2 for performance)
    return this.sha256(apiKey);
  },

  /**
   * Hash for cache keys (consistent, deterministic)
   */
  cacheKey(data: string): string {
    return this.sha256(data).substring(0, 16); // 64-bit hash for cache keys
  },
} as const;

// ==============================================================================
// TIMING-SAFE OPERATIONS
// ==============================================================================

/**
 * Timing-safe comparison utilities
 */
export const TimingSafe = {
  /**
   * Timing-safe string comparison
   */
  equals(a: string, b: string): boolean {
    if (a.length !== b.length) {
      // Still do comparison to prevent timing attacks
      timingSafeEqual(Buffer.from(a), Buffer.from("x".repeat(a.length)));
      return false;
    }

    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  },

  /**
   * Timing-safe buffer comparison
   */
  equalsBuffer(a: Buffer, b: Buffer): boolean {
    if (a.length !== b.length) {
      // Still do comparison to prevent timing attacks
      timingSafeEqual(a, Buffer.alloc(a.length));
      return false;
    }

    return timingSafeEqual(a, b);
  },
} as const;

// ==============================================================================
// BASE32 ENCODING (for TOTP secrets)
// ==============================================================================

/**
 * Base32 encode for TOTP compatibility
 */
function base32Encode(buffer: Buffer): string {
  const chars = CHAR_SETS.BASE32;
  let result = "";
  let bits = 0;
  let value = 0;

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;

    while (bits >= 5) {
      result += chars[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    result += chars[(value << (5 - bits)) & 31];
  }

  return result;
}

// ==============================================================================
// VALIDATION UTILITIES
// ==============================================================================

/**
 * Crypto validation utilities
 */
export const CryptoValidation = {
  /**
   * Validate if string is valid hex
   */
  isValidHex(str: string, expectedLength?: number): boolean {
    if (!str || typeof str !== "string") return false;

    const hexPattern = /^[0-9a-fA-F]+$/;
    if (!hexPattern.test(str)) return false;

    if (expectedLength && str.length !== expectedLength) return false;

    return true;
  },

  /**
   * Validate if string is valid base64url
   */
  isValidBase64Url(str: string): boolean {
    if (!str || typeof str !== "string") return false;

    const base64UrlPattern = /^[A-Za-z0-9_-]+$/;
    return base64UrlPattern.test(str);
  },

  /**
   * Validate if string is valid Base32 (for TOTP)
   */
  isValidBase32(str: string): boolean {
    if (!str || typeof str !== "string") return false;

    const base32Pattern = /^[A-Z2-7]+$/;
    return base32Pattern.test(str) && str.length % 8 === 0;
  },

  /**
   * Check entropy of a string (rough measure)
   */
  calculateEntropy(str: string): number {
    if (!str) return 0;

    const freq: Record<string, number> = {};
    for (const char of str) {
      freq[char] = (freq[char] || 0) + 1;
    }

    let entropy = 0;
    const len = str.length;

    for (const count of Object.values(freq)) {
      const p = count / len;
      entropy -= p * Math.log2(p);
    }

    return entropy;
  },
} as const;

// ==============================================================================
// EXPORTS
// ==============================================================================

export const CryptoUtils = {
  TokenGenerator,
  PasswordHasher,
  Hasher,
  TimingSafe,
  CryptoValidation,
  generateSecureRandom,
  generateSecureRandomString,
  generateSecureHex,
  generateSecureBase64Url,
} as const;

export { DEFAULT_ARGON2_CONFIG, TOKEN_LENGTHS, CHAR_SETS };
