/**
 * @fileoverview SessionEncryptionService - Enterprise session encryption and security
 * @module services/SessionEncryptionService
 * @author Enterprise Security Team
 * @since 1.0.0 - Phase 1.3 Session Security Enhancement
 */

import * as crypto from "crypto";
import { ValidationError } from "../errors/core";

/**
 * Session encryption configuration
 */
export interface ISessionEncryptionConfig {
  readonly algorithm: string;
  readonly keyLength: number;
  readonly ivLength: number;
  readonly tagLength: number;
  readonly secretKey: string;
}

/**
 * Encrypted session data
 */
export interface IEncryptedSessionData {
  readonly encryptedData: string;
  readonly iv: string;
  readonly tag: string;
  readonly algorithm: string;
}

/**
 * Session encryption result
 */
export interface ISessionEncryptionResult {
  readonly success: boolean;
  readonly encryptedData?: IEncryptedSessionData;
  readonly errors?: string[];
}

/**
 * Session decryption result
 */
export interface ISessionDecryptionResult {
  readonly success: boolean;
  readonly decryptedData?: Record<string, unknown>;
  readonly errors?: string[];
}

/**
 * Session fixation protection configuration
 */
interface ISessionFixationConfig {
  readonly regenerateOnLogin: boolean;
  readonly regenerateOnPrivilegeEscalation: boolean;
  readonly regenerateInterval: number; // milliseconds
  readonly maxSessionAge: number; // milliseconds
}

/**
 * Enterprise session encryption and security service
 *
 * Provides comprehensive session security including:
 * - AES-256-GCM encryption for session data
 * - Session fixation protection with regeneration
 * - Secure cookie configuration
 * - Session integrity validation
 * - Anti-tampering measures
 */
export class SessionEncryptionService {
  private readonly config: ISessionEncryptionConfig;
  private readonly fixationConfig: ISessionFixationConfig;

  constructor(
    secretKey?: string,
    customConfig?: Partial<ISessionEncryptionConfig>
  ) {
    if (!secretKey && !process.env["SESSION_SECRET_KEY"]) {
      throw new ValidationError(
        "Session secret key is required for encryption"
      );
    }

    this.config = {
      algorithm: "aes-256-gcm",
      keyLength: 32, // 256 bits
      ivLength: 16, // 128 bits
      tagLength: 16, // 128 bits
      secretKey: secretKey || process.env["SESSION_SECRET_KEY"]!,
      ...customConfig,
    };

    this.fixationConfig = {
      regenerateOnLogin: true,
      regenerateOnPrivilegeEscalation: true,
      regenerateInterval: 30 * 60 * 1000, // 30 minutes
      maxSessionAge: 24 * 60 * 60 * 1000, // 24 hours
    };

    this.validateConfiguration();
  }

  /**
   * Encrypt session data with AES-256-GCM
   *
   * @param sessionData - Session data to encrypt
   * @returns Encryption result with encrypted data or errors
   */
  public encryptSessionData(
    sessionData: Record<string, unknown>
  ): ISessionEncryptionResult {
    try {
      // Validate input data
      if (!sessionData || typeof sessionData !== "object") {
        return {
          success: false,
          errors: ["Invalid session data provided"],
        };
      }

      // Generate random IV
      const iv = crypto.randomBytes(this.config.ivLength);

      // Derive key from master key
      const key = crypto.scryptSync(
        this.config.secretKey,
        "salt",
        this.config.keyLength
      );

      // Create cipher with GCM mode
      const cipher = crypto.createCipheriv(
        this.config.algorithm,
        key,
        iv
      ) as crypto.CipherGCM;

      // Encrypt data
      const jsonData = JSON.stringify(sessionData);
      let encryptedData = cipher.update(jsonData, "utf8", "base64");
      encryptedData += cipher.final("base64");

      // Get authentication tag for GCM
      const tag = cipher.getAuthTag();

      return {
        success: true,
        encryptedData: {
          encryptedData,
          iv: iv.toString("base64"),
          tag: tag.toString("base64"),
          algorithm: this.config.algorithm,
        },
      };
    } catch (error) {
      return {
        success: false,
        errors: [
          `Encryption failed: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        ],
      };
    }
  }

  /**
   * Decrypt session data with integrity validation
   *
   * @param encryptedSession - Encrypted session data
   * @returns Decryption result with data or errors
   */
  public decryptSessionData(
    encryptedSession: IEncryptedSessionData
  ): ISessionDecryptionResult {
    try {
      // Validate input
      if (!this.validateEncryptedData(encryptedSession)) {
        return {
          success: false,
          errors: ["Invalid encrypted session data"],
        };
      }

      // Derive key from master key
      const key = crypto.scryptSync(
        this.config.secretKey,
        "salt",
        this.config.keyLength
      );
      const iv = Buffer.from(encryptedSession.iv, "base64");

      // Create decipher with GCM mode
      const decipher = crypto.createDecipheriv(
        encryptedSession.algorithm,
        key,
        iv
      ) as crypto.DecipherGCM;

      decipher.setAuthTag(Buffer.from(encryptedSession.tag, "base64"));

      // Decrypt data
      let decryptedData = decipher.update(
        encryptedSession.encryptedData,
        "base64",
        "utf8"
      );
      decryptedData += decipher.final("utf8");

      // Parse JSON
      const sessionData = JSON.parse(decryptedData);

      return {
        success: true,
        decryptedData: sessionData,
      };
    } catch (error) {
      return {
        success: false,
        errors: [
          `Decryption failed: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        ],
      };
    }
  }

  /**
   * Generate secure session ID with anti-fixation measures
   *
   * @param existingSessionId - Optional existing session ID for regeneration
   * @returns New secure session ID
   */
  public generateSecureSessionId(existingSessionId?: string): string {
    try {
      // Generate cryptographically secure random bytes
      const randomBytes = crypto.randomBytes(32);
      const timestamp = Date.now().toString(36);
      const entropy = crypto.randomBytes(16).toString("hex");

      // Include previous session ID in hash chain for regeneration tracking
      const hashInput = existingSessionId
        ? Buffer.concat([
            randomBytes,
            Buffer.from(timestamp),
            Buffer.from(entropy),
            Buffer.from(existingSessionId),
          ])
        : Buffer.concat([
            randomBytes,
            Buffer.from(timestamp),
            Buffer.from(entropy),
          ]);

      // Create secure hash
      const hash = crypto.createHash("sha256").update(hashInput).digest("hex");

      return `ses_${hash.substring(0, 32)}`;
    } catch (error) {
      throw new ValidationError(
        `Session ID generation failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Check if session requires regeneration for fixation protection
   *
   * @param sessionCreatedAt - Session creation timestamp
   * @param lastRegeneratedAt - Last regeneration timestamp
   * @param privilegeChanged - Whether user privilege changed
   * @returns True if regeneration is required
   */
  public requiresRegeneration(
    sessionCreatedAt: Date,
    lastRegeneratedAt?: Date,
    privilegeChanged: boolean = false
  ): boolean {
    const now = Date.now();
    const sessionAge = now - sessionCreatedAt.getTime();
    const lastRegeneration =
      lastRegeneratedAt?.getTime() || sessionCreatedAt.getTime();
    const timeSinceRegeneration = now - lastRegeneration;

    // Force regeneration on privilege change
    if (
      privilegeChanged &&
      this.fixationConfig.regenerateOnPrivilegeEscalation
    ) {
      return true;
    }

    // Force regeneration if session is too old
    if (sessionAge > this.fixationConfig.maxSessionAge) {
      return true;
    }

    // Regular regeneration interval
    if (timeSinceRegeneration > this.fixationConfig.regenerateInterval) {
      return true;
    }

    return false;
  }

  /**
   * Generate secure cookie configuration
   *
   * @param isSecure - Whether connection is HTTPS
   * @param domain - Cookie domain
   * @returns Secure cookie configuration object
   */
  public generateSecureCookieConfig(
    isSecure: boolean = true,
    domain?: string
  ): Record<string, unknown> {
    return {
      httpOnly: true, // Prevent XSS access
      secure: isSecure, // HTTPS only
      sameSite: "strict", // CSRF protection
      maxAge: this.fixationConfig.maxSessionAge,
      domain: domain || undefined,
      path: "/",
      // Additional security headers
      priority: "high",
      // Prevent client-side access
      __Secure: isSecure,
    };
  }

  /**
   * Validate session data integrity
   *
   * @param sessionData - Session data to validate
   * @param expectedChecksum - Expected integrity checksum
   * @returns True if integrity is valid
   */
  public validateSessionIntegrity(
    sessionData: Record<string, unknown>,
    expectedChecksum: string
  ): boolean {
    try {
      const actualChecksum = this.generateSessionChecksum(sessionData);
      return crypto.timingSafeEqual(
        Buffer.from(actualChecksum),
        Buffer.from(expectedChecksum)
      );
    } catch (error) {
      return false;
    }
  }

  /**
   * Generate session integrity checksum
   *
   * @param sessionData - Session data to hash
   * @returns HMAC checksum for integrity validation
   */
  public generateSessionChecksum(sessionData: Record<string, unknown>): string {
    try {
      const jsonData = JSON.stringify(sessionData);
      return crypto
        .createHmac("sha256", this.config.secretKey)
        .update(jsonData)
        .digest("hex");
    } catch (error) {
      throw new ValidationError(
        `Checksum generation failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Derive session key from master key and session ID
   *
   * @param sessionId - Session ID for key derivation
   * @param salt - Optional salt for key derivation
   * @returns Derived session-specific key
   */
  public deriveSessionKey(sessionId: string, salt?: string): string {
    try {
      const keyMaterial = salt
        ? `${this.config.secretKey}:${sessionId}:${salt}`
        : `${this.config.secretKey}:${sessionId}`;

      return crypto.createHash("sha256").update(keyMaterial).digest("hex");
    } catch (error) {
      throw new ValidationError(
        `Key derivation failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Private validation methods
   */
  private validateConfiguration(): void {
    if (!this.config.secretKey || this.config.secretKey.length < 32) {
      throw new ValidationError(
        "Session secret key must be at least 32 characters"
      );
    }

    if (this.config.keyLength < 32) {
      throw new ValidationError(
        "Key length must be at least 32 bytes for AES-256"
      );
    }

    if (!["aes-256-gcm", "aes-256-cbc"].includes(this.config.algorithm)) {
      throw new ValidationError("Unsupported encryption algorithm");
    }
  }

  private validateEncryptedData(data: IEncryptedSessionData): boolean {
    return !!(
      data &&
      data.encryptedData &&
      data.iv &&
      data.tag &&
      data.algorithm &&
      data.algorithm === this.config.algorithm
    );
  }

  /**
   * Get current encryption configuration
   *
   * @returns Read-only configuration object
   */
  public getConfig(): Readonly<ISessionEncryptionConfig> {
    return Object.freeze({ ...this.config });
  }

  /**
   * Get session fixation protection configuration
   *
   * @returns Read-only fixation configuration
   */
  public getFixationConfig(): Readonly<ISessionFixationConfig> {
    return Object.freeze({ ...this.fixationConfig });
  }
}
