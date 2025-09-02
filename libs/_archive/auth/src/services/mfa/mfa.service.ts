import { verifyTOTP, createTOTPKeyURI } from "@oslojs/otp";
import * as crypto from "node:crypto";
import { encodeBase32, decodeBase32 } from "@oslojs/encoding";
import {
  OsloCryptographicService,
  PasswordHashResult,
} from "../oslo-cryptographic.service";

/**
 * Phase 6 Component 1: Multi-Factor Authentication Service
 *
 * Enterprise-grade MFA implementation supporting:
 * - TOTP (Time-based One-Time Password)
 * - SMS-based verification codes
 * - Email-based verification codes
 * - Backup recovery codes
 *
 * Built on Oslo cryptographic foundation for maximum security.
 */

export interface MFASecret {
  secret: string;
  qrCode: string;
  backupCodes: string[];
}

export interface MFAStatus {
  enabled: boolean;
  methods: MFAMethod[];
  backupCodesRemaining: number;
  lastUsed: Date | null;
}

export enum MFAMethod {
  TOTP = "totp",
  SMS = "sms",
  EMAIL = "email",
  BACKUP_CODE = "backup_code",
}

interface MFAConfiguration {
  userId: string;
  method: MFAMethod;
  secret?: string;
  phoneNumber?: string;
  email?: string;
  enabled: boolean;
  createdAt: Date;
  lastUsed?: Date;
}

interface BackupCode {
  userId: string;
  hashedCode: PasswordHashResult; // Store full hash result
  used: boolean;
  createdAt: Date;
  usedAt?: Date;
}

interface VerificationCode {
  userId: string;
  hashedCode: PasswordHashResult; // Store full hash result
  method: MFAMethod;
  expiresAt: Date;
  attempts: number;
  verified: boolean;
}

export interface IMFAService {
  // TOTP (Time-based One-Time Password)
  generateTOTPSecret(userId: string): Promise<MFASecret>;
  verifyTOTP(userId: string, token: string): Promise<boolean>;

  // SMS-based MFA
  sendSMSCode(userId: string, phoneNumber: string): Promise<void>;
  verifySMSCode(userId: string, code: string): Promise<boolean>;

  // Email-based MFA
  sendEmailCode(userId: string, email: string): Promise<void>;
  verifyEmailCode(userId: string, code: string): Promise<boolean>;

  // Backup codes
  generateBackupCodes(userId: string): Promise<string[]>;
  verifyBackupCode(userId: string, code: string): Promise<boolean>;

  // MFA management
  enableMFA(userId: string, method: MFAMethod, config?: any): Promise<void>;
  disableMFA(userId: string, method: MFAMethod): Promise<void>;
  getMFAStatus(userId: string): Promise<MFAStatus>;
}

export class MFAService implements IMFAService {
  private readonly oslo: OsloCryptographicService;
  private readonly configurations = new Map<string, MFAConfiguration[]>();
  private readonly backupCodes = new Map<string, BackupCode[]>();
  private readonly verificationCodes = new Map<string, VerificationCode>();

  // Configuration constants
  private readonly TOTP_PERIOD = 30; // 30-second periods
  private readonly TOTP_DIGITS = 6;
  private readonly BACKUP_CODE_COUNT = 10;
  private readonly VERIFICATION_CODE_LENGTH = 6;
  private readonly VERIFICATION_CODE_EXPIRY = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_VERIFICATION_ATTEMPTS = 3;

  constructor(osloService: OsloCryptographicService) {
    this.oslo = osloService;
  }

  /**
   * Generate TOTP secret with QR code for authenticator apps
   * Uses Oslo OTP implementation following RFC 6238 TOTP specification
   */
  async generateTOTPSecret(userId: string): Promise<MFASecret> {
    try {
      // Generate cryptographically secure random secret (20 bytes = 160 bits)
      const secretBytes = crypto.randomBytes(20);
      const secret = encodeBase32(secretBytes);

      // Create TOTP Key URI for QR code generation using Oslo
      const qrCodeData = createTOTPKeyURI(
        "AuthV2-Enterprise", // issuer
        `user-${userId}`, // account name
        secretBytes,
        this.TOTP_PERIOD, // period in seconds
        this.TOTP_DIGITS // number of digits
      );

      // Generate backup codes
      const backupCodes = await this.generateSecureBackupCodes(userId);

      // Store encrypted configuration
      await this.storeEncryptedMFAConfig(userId, MFAMethod.TOTP, secret);

      return {
        secret,
        qrCode: qrCodeData,
        backupCodes,
      };
    } catch (error) {
      throw new Error(
        `Failed to generate TOTP secret: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Verify TOTP token from authenticator app
   * Uses Oslo OTP implementation with time window tolerance for clock skew
   */
  async verifyTOTP(userId: string, token: string): Promise<boolean> {
    try {
      const config = await this.getMFAConfig(userId, MFAMethod.TOTP);
      if (!config || !config.enabled) {
        return false;
      }

      const secret = await this.decryptMFASecret(config.secret!);
      const secretBytes = decodeBase32(secret);

      // Use Oslo TOTP verification with grace period for clock skew
      // This automatically handles ±1 time window tolerance
      const isValid = verifyTOTP(
        secretBytes,
        this.TOTP_PERIOD, // period in seconds
        this.TOTP_DIGITS, // number of digits
        token
      );

      if (isValid) {
        await this.updateMFALastUsed(userId, MFAMethod.TOTP);
        return true;
      }

      return false;
    } catch (error) {
      console.error("TOTP verification error:", error);
      return false;
    }
  }

  /**
   * Send SMS verification code
   */
  async sendSMSCode(userId: string, phoneNumber: string): Promise<void> {
    try {
      const code = this.generateNumericCode(this.VERIFICATION_CODE_LENGTH);

      // Store verification code with expiration
      const verificationKey = `${userId}:sms`;
      const hashedCode = await this.oslo.hashPassword(code);
      this.verificationCodes.set(verificationKey, {
        userId,
        hashedCode, // Store the full PasswordHashResult
        method: MFAMethod.SMS,
        expiresAt: new Date(Date.now() + this.VERIFICATION_CODE_EXPIRY),
        attempts: 0,
        verified: false,
      });

      // TODO: Integrate with SMS provider (Twilio, AWS SNS, etc.)
      console.log(
        `SMS Code for ${phoneNumber}: ${code} (expires in 5 minutes)`
      );
    } catch (error) {
      throw new Error(
        `Failed to send SMS code: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Verify SMS code with rate limiting and attempt tracking
   */
  async verifySMSCode(userId: string, code: string): Promise<boolean> {
    try {
      const verificationKey = `${userId}:sms`;
      const verification = this.verificationCodes.get(verificationKey);

      if (!verification) {
        return false;
      }

      // Check expiration
      if (Date.now() > verification.expiresAt.getTime()) {
        this.verificationCodes.delete(verificationKey);
        return false;
      }

      // Check attempt limit
      if (verification.attempts >= this.MAX_VERIFICATION_ATTEMPTS) {
        this.verificationCodes.delete(verificationKey);
        return false;
      }

      // Increment attempts
      verification.attempts++;

      // Verify code
      const isValid = await this.oslo.verifyPassword(
        code,
        verification.hashedCode
      );

      if (isValid) {
        verification.verified = true;
        await this.updateMFALastUsed(userId, MFAMethod.SMS);
        this.verificationCodes.delete(verificationKey);
        return true;
      }

      return false;
    } catch (error) {
      console.error("SMS verification error:", error);
      return false;
    }
  }

  /**
   * Send email verification code
   */
  async sendEmailCode(userId: string, email: string): Promise<void> {
    try {
      const code = this.generateNumericCode(this.VERIFICATION_CODE_LENGTH);

      // Store verification code with expiration
      const verificationKey = `${userId}:email`;
      this.verificationCodes.set(verificationKey, {
        userId,
        hashedCode: await this.oslo.hashPassword(code), // Store hashed
        method: MFAMethod.EMAIL,
        expiresAt: new Date(Date.now() + this.VERIFICATION_CODE_EXPIRY),
        attempts: 0,
        verified: false,
      });

      // TODO: Integrate with email provider (SendGrid, AWS SES, etc.)
      console.log(`Email Code for ${email}: ${code} (expires in 5 minutes)`);
    } catch (error) {
      throw new Error(
        `Failed to send email code: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Verify email code
   */
  async verifyEmailCode(userId: string, code: string): Promise<boolean> {
    try {
      const verificationKey = `${userId}:email`;
      const verification = this.verificationCodes.get(verificationKey);

      if (!verification) {
        return false;
      }

      // Check expiration
      if (Date.now() > verification.expiresAt.getTime()) {
        this.verificationCodes.delete(verificationKey);
        return false;
      }

      // Check attempt limit
      if (verification.attempts >= this.MAX_VERIFICATION_ATTEMPTS) {
        this.verificationCodes.delete(verificationKey);
        return false;
      }

      // Increment attempts
      verification.attempts++;

      // Verify code
      const isValid = await this.oslo.verifyPassword(
        code,
        verification.hashedCode
      );

      if (isValid) {
        verification.verified = true;
        await this.updateMFALastUsed(userId, MFAMethod.EMAIL);
        this.verificationCodes.delete(verificationKey);
        return true;
      }

      return false;
    } catch (error) {
      console.error("Email verification error:", error);
      return false;
    }
  }

  /**
   * Generate secure backup codes
   */
  async generateBackupCodes(userId: string): Promise<string[]> {
    return this.generateSecureBackupCodes(userId);
  }

  /**
   * Verify backup recovery code (single use)
   */
  async verifyBackupCode(userId: string, code: string): Promise<boolean> {
    try {
      const userBackupCodes = this.backupCodes.get(userId) || [];

      for (const backupCode of userBackupCodes) {
        if (!backupCode.used) {
          const isValid = await this.oslo.verifyPassword(
            code,
            backupCode.hashedCode
          );
          if (isValid) {
            // Mark as used (single use only)
            backupCode.used = true;
            backupCode.usedAt = new Date();
            await this.updateMFALastUsed(userId, MFAMethod.BACKUP_CODE);
            return true;
          }
        }
      }

      return false;
    } catch (error) {
      console.error("Backup code verification error:", error);
      return false;
    }
  }

  /**
   * Enable MFA method for user
   */
  async enableMFA(
    userId: string,
    method: MFAMethod,
    config?: any
  ): Promise<void> {
    try {
      const configurations = this.configurations.get(userId) || [];

      // Remove existing configuration for this method
      const filteredConfigs = configurations.filter((c) => c.method !== method);

      // Add new configuration
      const newConfig: MFAConfiguration = {
        userId,
        method,
        enabled: true,
        createdAt: new Date(),
        ...config,
      };

      filteredConfigs.push(newConfig);
      this.configurations.set(userId, filteredConfigs);
    } catch (error) {
      throw new Error(
        `Failed to enable MFA: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Disable MFA method for user
   */
  async disableMFA(userId: string, method: MFAMethod): Promise<void> {
    try {
      const configurations = this.configurations.get(userId) || [];
      const updatedConfigs = configurations.map((config) =>
        config.method === method ? { ...config, enabled: false } : config
      );

      this.configurations.set(userId, updatedConfigs);
    } catch (error) {
      throw new Error(
        `Failed to disable MFA: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Get comprehensive MFA status for user
   */
  async getMFAStatus(userId: string): Promise<MFAStatus> {
    try {
      const configurations = this.configurations.get(userId) || [];
      const enabledConfigs = configurations.filter((c) => c.enabled);

      const backupCodes = this.backupCodes.get(userId) || [];
      const unusedBackupCodes = backupCodes.filter((c) => !c.used);

      const lastUsed = enabledConfigs.reduce((latest, config) => {
        if (config.lastUsed && (!latest || config.lastUsed > latest)) {
          return config.lastUsed;
        }
        return latest;
      }, null as Date | null);

      return {
        enabled: enabledConfigs.length > 0,
        methods: enabledConfigs.map((c) => c.method),
        backupCodesRemaining: unusedBackupCodes.length,
        lastUsed,
      };
    } catch (error) {
      throw new Error(
        `Failed to get MFA status: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  // Private helper methods

  private async generateSecureBackupCodes(userId: string): Promise<string[]> {
    const codes: string[] = [];
    const hashedCodes: BackupCode[] = [];

    for (let i = 0; i < this.BACKUP_CODE_COUNT; i++) {
      // Generate 8-character alphanumeric code
      const code = this.generateAlphanumericCode(8);
      codes.push(code);

      // Store hashed version
      hashedCodes.push({
        userId,
        hashedCode: await this.oslo.hashPassword(code),
        used: false,
        createdAt: new Date(),
      });
    }

    this.backupCodes.set(userId, hashedCodes);
    return codes;
  }

  private generateNumericCode(length: number): string {
    let code = "";
    for (let i = 0; i < length; i++) {
      code += crypto.randomInt(0, 10).toString();
    }
    return code;
  }

  private generateAlphanumericCode(length: number): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let code = "";
    for (let i = 0; i < length; i++) {
      code += chars.charAt(crypto.randomInt(0, chars.length));
    }
    return code;
  }

  private async storeEncryptedMFAConfig(
    userId: string,
    method: MFAMethod,
    secret: string
  ): Promise<void> {
    // In a real implementation, encrypt and store the secret in database
    // For now, store in memory with encrypted token representation
    const secureToken = await this.oslo.generateSecureToken("session"); // Use valid token type

    // Store configuration with encrypted secret
    const configurations = this.configurations.get(userId) || [];
    const newConfig: MFAConfiguration = {
      userId,
      method,
      secret: `${secureToken}_${secret}`, // Simple encryption placeholder
      enabled: false, // Will be enabled when user completes setup
      createdAt: new Date(),
    };

    configurations.push(newConfig);
    this.configurations.set(userId, configurations);
  }

  private async getMFAConfig(
    userId: string,
    method: MFAMethod
  ): Promise<MFAConfiguration | null> {
    const configurations = this.configurations.get(userId) || [];
    return configurations.find((c) => c.method === method) || null;
  }

  private async decryptMFASecret(encryptedSecret: string): Promise<string> {
    // In a real implementation, decrypt from database storage using Oslo encryption
    // For now, extract from simple placeholder format
    const parts = encryptedSecret.split("_");
    return parts.length > 1 ? parts.slice(1).join("_") : encryptedSecret;
  }

  private async updateMFALastUsed(
    userId: string,
    method: MFAMethod
  ): Promise<void> {
    const configurations = this.configurations.get(userId) || [];
    const updatedConfigs = configurations.map((config) =>
      config.method === method ? { ...config, lastUsed: new Date() } : config
    );
    this.configurations.set(userId, updatedConfigs);
  }
}
