import crypto from "crypto";

/**
 * AES-256-GCM Token Encryption Service
 *
 * Provides cryptographic operations for securing authentication tokens
 * before storage in the database.
 */
export class TokenEncryption {
  private readonly algorithm = "aes-256-gcm";
  private readonly key: Buffer;

  constructor(encryptionKey: string) {
    if (!encryptionKey || encryptionKey.length < 32) {
      throw new Error("Encryption key must be at least 32 characters");
    }
    this.key = crypto.scryptSync(encryptionKey, "session-tokens-salt", 32);
  }

  /**
   * Encrypt a plaintext token
   * Format: iv:authTag:encryptedData
   */
  encrypt(plaintext: string): string {
    if (!plaintext) throw new Error("Cannot encrypt empty token");

    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);

    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");

    const authTag = cipher.getAuthTag();

    return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
  }

  /**
   * Decrypt a ciphertext token
   */
  decrypt(ciphertext: string): string {
    if (!ciphertext) throw new Error("Cannot decrypt empty ciphertext");

    const [ivHex, authTagHex, encrypted] = ciphertext.split(":");
    if (!ivHex || !authTagHex || !encrypted) {
      throw new Error("Invalid ciphertext format");
    }

    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");

    const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  }

  /**
   * Encrypt a set of tokens
   */
  encryptTokens(tokens: {
    accessToken?: string | null;
    refreshToken?: string | null;
    idToken?: string | null;
  }): {
    accessToken?: string | null;
    refreshToken?: string | null;
    idToken?: string | null;
  } {
    return {
      accessToken: tokens.accessToken ? this.encrypt(tokens.accessToken) : null,
      refreshToken: tokens.refreshToken
        ? this.encrypt(tokens.refreshToken)
        : null,
      idToken: tokens.idToken ? this.encrypt(tokens.idToken) : null,
    };
  }

  /**
   * Decrypt a set of tokens
   */
  decryptTokens(encryptedTokens: {
    accessToken?: string | null;
    refreshToken?: string | null;
    idToken?: string | null;
  }): {
    accessToken?: string | null;
    refreshToken?: string | null;
    idToken?: string | null;
  } {
    return {
      accessToken: encryptedTokens.accessToken
        ? this.decrypt(encryptedTokens.accessToken)
        : null,
      refreshToken: encryptedTokens.refreshToken
        ? this.decrypt(encryptedTokens.refreshToken)
        : null,
      idToken: encryptedTokens.idToken
        ? this.decrypt(encryptedTokens.idToken)
        : null,
    };
  }
}

// Singleton instance
let instance: TokenEncryption | null = null;

/**
 * Get or create singleton TokenEncryption instance
 */
export function getTokenEncryption(): TokenEncryption {
  if (!instance) {
    const key = process.env["SESSION_TOKEN_ENCRYPTION_KEY"];
    if (!key) {
      throw new Error(
        "SESSION_TOKEN_ENCRYPTION_KEY environment variable not set"
      );
    }
    instance = new TokenEncryption(key);
  }
  return instance;
}
