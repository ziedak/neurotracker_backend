/**
 * Phase 4: Oslo Cryptographic Service
 * Modern cryptographic primitives using Oslo packages
 */

import { SHA256, sha256 } from "@oslojs/crypto/sha2";
import { encodeBase64, decodeBase64 } from "@oslojs/encoding";
import {
  parseJWT,
  encodeJWT,
  createJWTSignatureMessage,
  JWTRegisteredClaims,
  joseAlgorithmHS256,
} from "@oslojs/jwt";
import { type RandomReader } from "@oslojs/crypto/random";
import { hmac } from "@oslojs/crypto/hmac";
import { constantTimeEqual } from "@oslojs/crypto/subtle";
import { scrypt } from "node:crypto";
import { promisify } from "node:util";
import { Logger } from "@libs/monitoring";

const scryptAsync = promisify(scrypt);

// Create a random reader using Node.js crypto
const nodeRandomReader: RandomReader = {
  read(bytes: Uint8Array): void {
    const randomBytes = crypto.getRandomValues(new Uint8Array(bytes.length));
    bytes.set(randomBytes);
  },
};

export interface OsloCryptoConfig {
  readonly scryptN: number; // CPU/memory cost parameter
  readonly scryptR: number; // Block size parameter
  readonly scryptP: number; // Parallelization parameter
  readonly scryptKeyLength: number; // Derived key length
  readonly saltLength: number; // Salt length in bytes
  readonly tokenEntropy: number; // Token entropy in bytes
  readonly jwtAlgorithm: "HS256" | "HS384" | "HS512";
  readonly jwtIssuer: string;
  readonly jwtAudience: string;
}

export const DEFAULT_OSLO_CONFIG: OsloCryptoConfig = {
  scryptN: 16384, // 2^14, good balance of security and performance
  scryptR: 8, // Standard block size
  scryptP: 1, // Single thread (can be increased for parallel processing)
  scryptKeyLength: 64, // 512 bits
  saltLength: 32, // 256 bits
  tokenEntropy: 32, // 256 bits
  jwtAlgorithm: "HS256",
  jwtIssuer: "neurotracker-auth",
  jwtAudience: "neurotracker-api",
};

export interface PasswordHashResult {
  readonly hash: string;
  readonly salt: string;
  readonly algorithm: string;
  readonly params: {
    readonly N: number;
    readonly r: number;
    readonly p: number;
    readonly keyLength: number;
  };
}

export interface TokenGenerationResult {
  readonly token: string;
  readonly entropy: number;
  readonly algorithm: string;
  readonly created: Date;
}

export interface JWTPayload {
  readonly sub: string; // Subject (user ID)
  readonly iat: number; // Issued at
  readonly exp: number; // Expiration
  readonly iss: string; // Issuer
  readonly aud: string; // Audience
  readonly jti?: string; // JWT ID
  readonly [key: string]: any; // Additional claims
}

/**
 * Oslo-based cryptographic service for authentication
 */
export class OsloCryptographicService {
  private readonly config: OsloCryptoConfig;
  private readonly logger: Logger;

  constructor(config: Partial<OsloCryptoConfig> = {}) {
    this.config = { ...DEFAULT_OSLO_CONFIG, ...config };
    this.logger = new Logger({ service: "OsloCryptographic" });

    this.logger.info("Oslo cryptographic service initialized", {
      scryptParams: {
        N: this.config.scryptN,
        r: this.config.scryptR,
        p: this.config.scryptP,
        keyLength: this.config.scryptKeyLength,
      },
      tokenEntropy: this.config.tokenEntropy,
      jwtAlgorithm: this.config.jwtAlgorithm,
    });
  }

  /**
   * Hash password using Node.js scrypt with Oslo salt generation
   */
  async hashPassword(password: string): Promise<PasswordHashResult> {
    const startTime = performance.now();

    try {
      // Generate cryptographically secure salt using Oslo
      const saltBytes = new Uint8Array(this.config.saltLength);
      nodeRandomReader.read(saltBytes);
      const saltString = encodeBase64(saltBytes);

      // Hash password with Node.js scrypt
      const passwordBuffer = Buffer.from(password, "utf8");
      const saltBuffer = Buffer.from(saltBytes);

      const hashBuffer = (await scryptAsync(
        passwordBuffer,
        saltBuffer,
        this.config.scryptKeyLength
      )) as Buffer;

      const hashString = encodeBase64(new Uint8Array(hashBuffer));

      const result: PasswordHashResult = {
        hash: hashString,
        salt: saltString,
        algorithm: "scrypt",
        params: {
          N: this.config.scryptN,
          r: this.config.scryptR,
          p: this.config.scryptP,
          keyLength: this.config.scryptKeyLength,
        },
      };

      const duration = performance.now() - startTime;
      this.logger.info("Password hashed successfully", {
        duration: `${duration.toFixed(2)}ms`,
        algorithm: "scrypt",
        saltLength: saltString.length,
        hashLength: hashString.length,
      });

      return result;
    } catch (error) {
      this.logger.error(
        "Password hashing failed",
        error instanceof Error ? error : undefined
      );
      throw new Error("Password hashing failed");
    }
  }

  /**
   * Verify password against Node.js scrypt hash using Oslo for comparison
   */
  async verifyPassword(
    password: string,
    hashResult: PasswordHashResult
  ): Promise<boolean> {
    const startTime = performance.now();

    try {
      const passwordBuffer = Buffer.from(password, "utf8");
      const saltBytes = decodeBase64(hashResult.salt);
      const saltBuffer = Buffer.from(saltBytes);
      const expectedHashBytes = decodeBase64(hashResult.hash);

      // Hash provided password with same parameters using Node.js scrypt
      const computedHashBuffer = (await scryptAsync(
        passwordBuffer,
        saltBuffer,
        hashResult.params.keyLength
      )) as Buffer;

      const computedHashBytes = new Uint8Array(computedHashBuffer);

      // Constant-time comparison using Oslo
      const isValid = constantTimeEqual(computedHashBytes, expectedHashBytes);

      const duration = performance.now() - startTime;
      this.logger.info("Password verification completed", {
        duration: `${duration.toFixed(2)}ms`,
        algorithm: hashResult.algorithm,
        isValid,
      });

      return isValid;
    } catch (error) {
      this.logger.error(
        "Password verification failed",
        error instanceof Error ? error : undefined
      );
      return false;
    }
  }

  /**
   * Generate cryptographically secure random token
   */
  generateSecureToken(
    purpose: "session" | "refresh" | "csrf" | "api" = "session"
  ): TokenGenerationResult {
    const startTime = performance.now();

    try {
      // Generate high-entropy random token
      const tokenBytes = new Uint8Array(this.config.tokenEntropy);
      crypto.getRandomValues(tokenBytes);

      // Encode as base64url for safe URL usage
      const token = encodeBase64(tokenBytes)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");

      const result: TokenGenerationResult = {
        token,
        entropy: this.config.tokenEntropy * 8, // bits
        algorithm: "crypto.getRandomValues",
        created: new Date(),
      };

      const duration = performance.now() - startTime;
      this.logger.info("Secure token generated", {
        purpose,
        entropy: `${result.entropy} bits`,
        tokenLength: token.length,
        duration: `${duration.toFixed(2)}ms`,
      });

      return result;
    } catch (error) {
      this.logger.error(
        "Token generation failed",
        error instanceof Error ? error : undefined
      );
      throw new Error("Token generation failed");
    }
  }

  /**
   * Create JWT using Oslo JWT implementation
   */
  async createJWTToken(
    payload: Omit<JWTPayload, "iat" | "iss" | "aud">,
    secretKey: string,
    expiresInSeconds: number = 3600
  ): Promise<string> {
    const startTime = performance.now();

    try {
      const now = Math.floor(Date.now() / 1000);

      const fullPayload: JWTPayload = {
        ...payload,
        sub: payload["sub"] || "unknown",
        iat: now,
        exp: now + expiresInSeconds,
        iss: this.config.jwtIssuer,
        aud: this.config.jwtAudience,
        jti:
          payload["jti"] ||
          this.generateSecureToken("api").token.substring(0, 16),
      };

      // Create JWT header
      const header = {
        alg: joseAlgorithmHS256,
        typ: "JWT",
      };

      const headerJson = JSON.stringify(header);
      const payloadJson = JSON.stringify(fullPayload);

      // Create signature message
      const signatureMessage = createJWTSignatureMessage(
        headerJson,
        payloadJson
      );

      // Create HMAC signature using Oslo
      const secretBytes = new TextEncoder().encode(secretKey);
      const signature = hmac(SHA256, secretBytes, signatureMessage);

      // Encode JWT
      const jwt = encodeJWT(headerJson, payloadJson, signature);

      const duration = performance.now() - startTime;
      this.logger.info("JWT created successfully", {
        algorithm: this.config.jwtAlgorithm,
        subject: payload["sub"],
        expiresIn: `${expiresInSeconds}s`,
        duration: `${duration.toFixed(2)}ms`,
      });

      return jwt;
    } catch (error) {
      this.logger.error(
        "JWT creation failed",
        error instanceof Error ? error : undefined
      );
      throw new Error("JWT creation failed");
    }
  }

  /**
   * Validate JWT using Oslo JWT implementation
   */
  async validateJWTToken(
    token: string,
    secretKey: string
  ): Promise<JWTPayload | null> {
    const startTime = performance.now();

    try {
      // Parse JWT using Oslo
      const [, payload, signature, signatureMessage] = parseJWT(token);

      // Verify signature
      const secretBytes = new TextEncoder().encode(secretKey);
      const expectedSignature = hmac(SHA256, secretBytes, signatureMessage);

      // Constant time comparison
      const isValidSignature = constantTimeEqual(signature, expectedSignature);

      if (!isValidSignature) {
        this.logger.warn("JWT validation failed: invalid signature");
        return null;
      }

      // Create registered claims for validation
      const claims = new JWTRegisteredClaims(payload);

      // Verify expiration
      if (claims.hasExpiration() && !claims.verifyExpiration()) {
        this.logger.warn("JWT validation failed: token expired");
        return null;
      }

      // Verify not before
      if (claims.hasNotBefore() && !claims.verifyNotBefore()) {
        this.logger.warn("JWT validation failed: token not yet valid");
        return null;
      }

      // Verify issuer and audience
      if (claims.hasIssuer() && claims.issuer() !== this.config.jwtIssuer) {
        this.logger.warn("JWT validation failed: invalid issuer", {
          expected: this.config.jwtIssuer,
          actual: claims.issuer(),
        });
        return null;
      }

      if (claims.hasAudiences()) {
        const audiences = claims.audiences();
        if (!audiences.includes(this.config.jwtAudience)) {
          this.logger.warn("JWT validation failed: invalid audience", {
            expected: this.config.jwtAudience,
            actual: audiences,
          });
          return null;
        }
      }

      const duration = performance.now() - startTime;
      this.logger.info("JWT validated successfully", {
        algorithm: this.config.jwtAlgorithm,
        subject: claims.hasSubject() ? claims.subject() : undefined,
        duration: `${duration.toFixed(2)}ms`,
      });

      return payload as JWTPayload;
    } catch (error) {
      this.logger.warn(
        "JWT validation failed",
        error instanceof Error ? error : undefined
      );
      return null;
    }
  }

  /**
   * Generate cryptographic hash using SHA-256
   */
  generateHash(data: string, encoding: "hex" | "base64" = "hex"): string {
    const startTime = performance.now();

    try {
      const dataBytes = new TextEncoder().encode(data);
      const hashBytes = sha256(dataBytes);

      const hash =
        encoding === "hex"
          ? Array.from(hashBytes)
              .map((b) => b.toString(16).padStart(2, "0"))
              .join("")
          : encodeBase64(hashBytes);

      const duration = performance.now() - startTime;
      this.logger.info("Hash generated", {
        algorithm: "SHA-256",
        encoding,
        inputLength: data.length,
        outputLength: hash.length,
        duration: `${duration.toFixed(2)}ms`,
      });

      return hash;
    } catch (error) {
      this.logger.error(
        "Hash generation failed",
        error instanceof Error ? error : undefined
      );
      throw new Error("Hash generation failed");
    }
  }

  /**
   * Generate HMAC using SHA-256
   */
  generateHMAC(
    data: string,
    key: string,
    encoding: "hex" | "base64" = "hex"
  ): string {
    const startTime = performance.now();

    try {
      // Simple HMAC implementation using SHA-256
      const keyBytes = new TextEncoder().encode(key);
      const dataBytes = new TextEncoder().encode(data);

      // Pad key to block size (64 bytes for SHA-256)
      const blockSize = 64;
      let paddedKey = new Uint8Array(blockSize);

      if (keyBytes.length > blockSize) {
        const hashedKey = sha256(keyBytes);
        paddedKey.set(hashedKey);
      } else {
        paddedKey.set(keyBytes);
      }

      // Create inner and outer padded keys
      const innerPadded = new Uint8Array(blockSize + dataBytes.length);
      const outerPadded = new Uint8Array(blockSize + 32); // 32 is SHA-256 output size

      for (let i = 0; i < blockSize; i++) {
        innerPadded[i] = (paddedKey[i] || 0) ^ 0x36;
        outerPadded[i] = (paddedKey[i] || 0) ^ 0x5c;
      }

      innerPadded.set(dataBytes, blockSize);
      const innerHash = sha256(innerPadded);

      outerPadded.set(innerHash, blockSize);
      const hmac = sha256(outerPadded);

      const result =
        encoding === "hex"
          ? Array.from(hmac)
              .map((b) => b.toString(16).padStart(2, "0"))
              .join("")
          : encodeBase64(hmac);

      const duration = performance.now() - startTime;
      this.logger.info("HMAC generated", {
        algorithm: "HMAC-SHA256",
        encoding,
        duration: `${duration.toFixed(2)}ms`,
      });

      return result;
    } catch (error) {
      this.logger.error(
        "HMAC generation failed",
        error instanceof Error ? error : undefined
      );
      throw new Error("HMAC generation failed");
    }
  }

  /**
   * Get cryptographic service configuration
   */
  getConfiguration(): OsloCryptoConfig {
    return { ...this.config };
  }

  /**
   * Performance benchmark for cryptographic operations
   */
  async benchmark(): Promise<{
    passwordHashing: { duration: number; iterations: number };
    passwordVerification: { duration: number; iterations: number };
    tokenGeneration: { duration: number; iterations: number };
    jwtCreation: { duration: number; iterations: number };
    jwtValidation: { duration: number; iterations: number };
    hashGeneration: { duration: number; iterations: number };
  }> {
    this.logger.info("Starting cryptographic performance benchmark");

    const iterations = 100;
    const testPassword = "test_password_for_benchmarking_12345";
    const testData = "test_data_for_hashing_operations";
    const testSecret = "test_secret_key_for_jwt_operations_12345";

    // Benchmark password hashing
    const hashStart = performance.now();
    const hashResults: PasswordHashResult[] = [];
    for (let i = 0; i < 10; i++) {
      // Fewer iterations for expensive operations
      const result = await this.hashPassword(testPassword + i);
      hashResults.push(result);
    }
    const hashDuration = performance.now() - hashStart;

    // Benchmark password verification
    const verifyStart = performance.now();
    for (let i = 0; i < 10; i++) {
      const hashResult = hashResults[i];
      if (hashResult) {
        await this.verifyPassword(testPassword + i, hashResult);
      }
    }
    const verifyDuration = performance.now() - verifyStart;

    // Benchmark token generation
    const tokenStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      this.generateSecureToken("session");
    }
    const tokenDuration = performance.now() - tokenStart;

    // Benchmark JWT creation
    const jwtCreateStart = performance.now();
    const jwts: string[] = [];
    for (let i = 0; i < iterations; i++) {
      const jwt = await this.createJWTToken(
        { sub: `user_${i}`, role: "user" },
        testSecret,
        3600
      );
      jwts.push(jwt);
    }
    const jwtCreateDuration = performance.now() - jwtCreateStart;

    // Benchmark JWT validation
    const jwtValidateStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      const jwt = jwts[i];
      if (jwt) {
        await this.validateJWTToken(jwt, testSecret);
      }
    }
    const jwtValidateDuration = performance.now() - jwtValidateStart;

    // Benchmark hash generation
    const hashGenStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      this.generateHash(testData + i);
    }
    const hashGenDuration = performance.now() - hashGenStart;

    const results = {
      passwordHashing: { duration: hashDuration, iterations: 10 },
      passwordVerification: { duration: verifyDuration, iterations: 10 },
      tokenGeneration: { duration: tokenDuration, iterations },
      jwtCreation: { duration: jwtCreateDuration, iterations },
      jwtValidation: { duration: jwtValidateDuration, iterations },
      hashGeneration: { duration: hashGenDuration, iterations },
    };

    this.logger.info("Cryptographic benchmark completed", {
      passwordHashing: `${(
        results.passwordHashing.duration / results.passwordHashing.iterations
      ).toFixed(2)}ms/op`,
      passwordVerification: `${(
        results.passwordVerification.duration /
        results.passwordVerification.iterations
      ).toFixed(2)}ms/op`,
      tokenGeneration: `${(
        results.tokenGeneration.duration / results.tokenGeneration.iterations
      ).toFixed(2)}ms/op`,
      jwtCreation: `${(
        results.jwtCreation.duration / results.jwtCreation.iterations
      ).toFixed(2)}ms/op`,
      jwtValidation: `${(
        results.jwtValidation.duration / results.jwtValidation.iterations
      ).toFixed(2)}ms/op`,
      hashGeneration: `${(
        results.hashGeneration.duration / results.hashGeneration.iterations
      ).toFixed(2)}ms/op`,
    });

    return results;
  }

  /**
   * Health check for cryptographic operations
   */
  async healthCheck(): Promise<{
    status: "healthy" | "degraded" | "critical";
    checks: {
      passwordHashing: boolean;
      tokenGeneration: boolean;
      jwtOperations: boolean;
      hashGeneration: boolean;
    };
    latency: number;
  }> {
    const startTime = performance.now();

    const checks = {
      passwordHashing: false,
      tokenGeneration: false,
      jwtOperations: false,
      hashGeneration: false,
    };

    try {
      // Test password hashing
      const hashResult = await this.hashPassword("health_check_password");
      const isValid = await this.verifyPassword(
        "health_check_password",
        hashResult
      );
      checks.passwordHashing = isValid;

      // Test token generation
      const token = this.generateSecureToken("session");
      checks.tokenGeneration = token.token.length > 0;

      // Test JWT operations
      const jwt = await this.createJWTToken(
        { sub: "health_check" },
        "test_secret",
        60
      );
      const payload = await this.validateJWTToken(jwt, "test_secret");
      checks.jwtOperations = payload?.sub === "health_check";

      // Test hash generation
      const hash = this.generateHash("health_check_data");
      checks.hashGeneration = hash.length === 64; // SHA-256 hex length
    } catch (error) {
      this.logger.error(
        "Health check failed",
        error instanceof Error ? error : undefined
      );
    }

    const allHealthy = Object.values(checks).every((check) => check);
    const someHealthy = Object.values(checks).some((check) => check);

    const status = allHealthy
      ? "healthy"
      : someHealthy
      ? "degraded"
      : "critical";
    const latency = performance.now() - startTime;

    return { status, checks, latency };
  }
}
