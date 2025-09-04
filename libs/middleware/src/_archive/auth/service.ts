/**
 * Modern Authentication Service using Oslo Packages
 *
 * Implements secure session management, password hashing, and JWT tokens
 * using the latest Oslo cryptographic primitives and Node.js crypto.
 */

import { sha256 } from "@oslojs/crypto/sha2";
import { constantTimeEqual } from "@oslojs/crypto/subtle";
import { encodeBase64url, decodeBase64url } from "@oslojs/encoding";
import {
  parseJWT,
  encodeJWT,
  createJWTSignatureMessage,
  JWTRegisteredClaims,
} from "@oslojs/jwt";
import { scrypt, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import {
  PostgreSQLClient,
  RedisClient,
  User,
  UserSession,
  Role,
} from "@libs/database";
import {
  SessionCreateOptions,
  SessionValidationResult,
  AuthUser,
  SessionTokenPayload,
  AuthConfig,
  AuthEvent,
  AuthAuditEntry,
  SessionInvalidReason,
} from "./types";

const scryptAsync = promisify(scrypt);

/**
 * Default authentication configuration
 */
const DEFAULT_AUTH_CONFIG: AuthConfig = {
  sessionExpiresInHours: 24 * 7, // 7 days
  cleanupIntervalMinutes: 60,
  maxSessionsPerUser: 5,
  strictIpCheck: false,
  jwtSecret:
    process.env["JWT_SECRET"] || "fallback-secret-change-in-production",
  cookieOptions: {
    name: "session",
    httpOnly: true,
    secure: process.env["NODE_ENV"] === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 days in seconds
    path: "/",
  },
  rateLimiting: {
    maxAttempts: 5,
    windowMinutes: 15,
    blockDurationMinutes: 30,
  },
};

/**
 * Enhanced Authentication Service with Oslo Cryptography
 */
export class AuthService {
  private readonly config: AuthConfig;
  private readonly prisma = PostgreSQLClient.getInstance();
  private readonly redis = RedisClient.getInstance();
  private cleanupInterval?: NodeJS.Timeout;

  constructor(config: Partial<AuthConfig> = {}) {
    this.config = { ...DEFAULT_AUTH_CONFIG, ...config };
    this.startCleanupProcess();
  }

  /**
   * Hash password using scrypt with salt
   */
  public async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    const hash = (await scryptAsync(password, salt, 32)) as Buffer;

    // Combine salt and hash, encode as base64url
    const combined = Buffer.concat([salt, hash]);

    return encodeBase64url(combined);
  }

  /**
   * Verify password against hash
   */
  public async verifyPassword(
    password: string,
    hashedPassword: string
  ): Promise<boolean> {
    try {
      const combined = decodeBase64url(hashedPassword);
      const salt = combined.slice(0, 16);
      const storedHash = combined.slice(16);

      const computedHash = (await scryptAsync(password, salt, 32)) as Buffer;

      return constantTimeEqual(
        new Uint8Array(storedHash),
        new Uint8Array(computedHash)
      );
    } catch {
      return false;
    }
  }

  /**
   * Generate secure session token
   */
  private generateSessionToken(): string {
    const tokenBytes = randomBytes(32);
    return encodeBase64url(tokenBytes);
  }

  /**
   * Hash session token for database storage
   */
  private hashSessionToken(token: string): string {
    const tokenBytes = decodeBase64url(token);
    const hash = sha256(tokenBytes);
    return encodeBase64url(hash);
  }

  /**
   * Create JWT for API authentication
   */
  private async createJWTToken(
    sessionId: string,
    userId: string
  ): Promise<string> {
    const header = {
      alg: "HS256",
      typ: "JWT",
    };

    const payload: SessionTokenPayload = {
      sessionId,
      userId,
      iat: Math.floor(Date.now() / 1000),
      exp:
        Math.floor(Date.now() / 1000) +
        this.config.sessionExpiresInHours * 3600,
    };

    const headerJSON = JSON.stringify(header);
    const payloadJSON = JSON.stringify(payload);

    const message = createJWTSignatureMessage(headerJSON, payloadJSON);
    const secret = new TextEncoder().encode(this.config.jwtSecret);
    const signature = sha256(new Uint8Array([...message, ...secret]));

    return encodeJWT(headerJSON, payloadJSON, signature);
  }

  /**
   * Verify JWT token
   */
  private async verifyJWTToken(
    token: string
  ): Promise<SessionTokenPayload | null> {
    try {
      const [, payload, signature, signatureMessage] = parseJWT(token);

      // Verify signature
      const secret = new TextEncoder().encode(this.config.jwtSecret);
      const expectedSignature = sha256(
        new Uint8Array([...signatureMessage, ...secret])
      );

      if (!constantTimeEqual(signature, expectedSignature)) {
        return null;
      }

      // Check expiration
      const claims = new JWTRegisteredClaims(payload);
      if (claims.hasExpiration() && !claims.verifyExpiration()) {
        return null;
      }

      return payload as SessionTokenPayload;
    } catch {
      return null;
    }
  }

  /**
   * Create a new user session
   */
  public async createSession(options: SessionCreateOptions): Promise<{
    session: UserSession;
    sessionToken: string;
    jwtToken: string;
  }> {
    // Check if user exists and is active
    const user = await this.prisma.user.findUnique({
      where: { id: options.userId },
      include: { role: true },
    });

    if (!user || user.status !== "ACTIVE") {
      throw new Error("Invalid user or user not active");
    }

    // Cleanup old sessions for user if exceeding limit
    await this.cleanupUserSessions(options.userId);

    // Generate tokens
    const sessionToken = this.generateSessionToken();
    const sessionId = this.generateSessionId();
    const hashedToken = this.hashSessionToken(sessionToken);

    const expiresAt = new Date();
    expiresAt.setHours(
      expiresAt.getHours() +
        (options.expiresInHours || this.config.sessionExpiresInHours)
    );

    // Create session in database
    const session = await this.prisma.userSession.create({
      data: {
        id: sessionId,
        userId: options.userId,
        sessionId: hashedToken,
        expiresAt,
        ipAddress: options.ipAddress || null,
        userAgent: options.userAgent || null,
        metadata: options.metadata as any,
        isActive: true,
      },
    });

    // Create JWT token
    const jwtToken = await this.createJWTToken(sessionId, options.userId);

    // Cache session for faster validation
    await this.cacheSession(sessionId, session, user);

    // Log session creation
    await this.logAuthEvent({
      event: AuthEvent.SESSION_CREATED,
      userId: options.userId,
      sessionId,
      ipAddress: options.ipAddress,
      userAgent: options.userAgent,
      timestamp: new Date(),
      success: true,
    });

    return { session, sessionToken, jwtToken };
  }

  /**
   * Validate session token
   */
  public async validateSession(
    sessionToken: string,
    ipAddress?: string
  ): Promise<SessionValidationResult> {
    try {
      const hashedToken = this.hashSessionToken(sessionToken);

      // First try cache
      const cachedResult = await this.getCachedSession(hashedToken);
      if (cachedResult) {
        return cachedResult;
      }

      // Query database
      const session = await this.prisma.userSession.findFirst({
        where: {
          sessionId: hashedToken,
          isActive: true,
          expiresAt: { gt: new Date() },
        },
        include: {
          user: {
            include: { role: true },
          },
        },
      });

      if (!session || !session.user) {
        return {
          session: null,
          user: null,
          isValid: false,
          reason: SessionInvalidReason.NOT_FOUND,
        };
      }

      // Check user status
      if (session.user.status !== "ACTIVE") {
        await this.invalidateSession(session.id);
        return {
          session: null,
          user: null,
          isValid: false,
          reason:
            session.user.status === "BANNED"
              ? SessionInvalidReason.USER_BANNED
              : SessionInvalidReason.USER_DELETED,
        };
      }

      // Check IP address if strict mode enabled
      if (
        this.config.strictIpCheck &&
        ipAddress &&
        session.ipAddress !== ipAddress
      ) {
        return {
          session,
          user: session.user,
          isValid: false,
          reason: SessionInvalidReason.IP_MISMATCH,
        };
      }

      // Cache valid session
      await this.cacheSession(session.id, session, session.user);

      return {
        session,
        user: session.user,
        isValid: true,
      };
    } catch (error) {
      console.error("Session validation error:", error);
      return {
        session: null,
        user: null,
        isValid: false,
        reason: SessionInvalidReason.INVALID_TOKEN,
      };
    }
  }

  /**
   * Validate JWT token
   */
  public async validateJWT(token: string): Promise<SessionValidationResult> {
    const payload = await this.verifyJWTToken(token);
    if (!payload) {
      return {
        session: null,
        user: null,
        isValid: false,
        reason: SessionInvalidReason.INVALID_TOKEN,
      };
    }

    // Validate the session still exists
    const session = await this.prisma.userSession.findUnique({
      where: {
        id: payload.sessionId,
        isActive: true,
        expiresAt: { gt: new Date() },
      },
      include: {
        user: {
          include: { role: true },
        },
      },
    });

    if (!session || !session.user || session.user.status !== "ACTIVE") {
      return {
        session: null,
        user: null,
        isValid: false,
        reason: SessionInvalidReason.NOT_FOUND,
      };
    }

    return {
      session,
      user: session.user,
      isValid: true,
    };
  }

  /**
   * Invalidate a session
   */
  public async invalidateSession(sessionId: string): Promise<void> {
    // Mark session as inactive
    await this.prisma.userSession.update({
      where: { id: sessionId },
      data: {
        isActive: false,
        endedAt: new Date(),
      },
    });

    // Remove from cache
    await this.redis.del(`session:${sessionId}`);

    // Log session revocation
    await this.logAuthEvent({
      event: AuthEvent.SESSION_REVOKED,
      sessionId,
      timestamp: new Date(),
      success: true,
    });
  }

  /**
   * Invalidate all user sessions
   */
  public async invalidateAllUserSessions(userId: string): Promise<void> {
    const sessions = await this.prisma.userSession.findMany({
      where: { userId, isActive: true },
    });

    // Mark all sessions as inactive
    await this.prisma.userSession.updateMany({
      where: { userId, isActive: true },
      data: {
        isActive: false,
        endedAt: new Date(),
      },
    });

    // Remove from cache
    await Promise.all(
      sessions.map((session) => this.redis.del(`session:${session.id}`))
    );
  }

  /**
   * Convert User to AuthUser
   */
  public toAuthUser(user: User & { role?: Role | null }): AuthUser {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      firstName: user.firstName || undefined,
      lastName: user.lastName || undefined,
      status: user.status,
      role: user.role || undefined,
      storeId: user.storeId || undefined,
      emailVerified: user.emailVerified,
      lastLoginAt: user.lastLoginAt || undefined,
    };
  }

  // === Private Helper Methods ===

  private generateSessionId(): string {
    return "sess_" + encodeBase64url(randomBytes(16));
  }

  private async cleanupUserSessions(userId: string): Promise<void> {
    const sessions = await this.prisma.userSession.findMany({
      where: { userId, isActive: true },
      orderBy: { createdAt: "desc" },
    });

    if (sessions.length >= this.config.maxSessionsPerUser) {
      const sessionsToRemove = sessions.slice(
        this.config.maxSessionsPerUser - 1
      );

      await Promise.all([
        // Mark old sessions as inactive
        this.prisma.userSession.updateMany({
          where: {
            id: { in: sessionsToRemove.map((s) => s.id) },
          },
          data: { isActive: false, endedAt: new Date() },
        }),
        // Remove from cache
        ...sessionsToRemove.map((s) => this.redis.del(`session:${s.id}`)),
      ]);
    }
  }

  private async cacheSession(
    sessionId: string,
    session: UserSession,
    user: User
  ): Promise<void> {
    const cacheData = JSON.stringify({ session, user });
    await this.redis.setex(`session:${sessionId}`, 3600, cacheData); // 1 hour cache
  }

  private async getCachedSession(
    hashedToken: string
  ): Promise<SessionValidationResult | null> {
    try {
      const cached = await this.redis.get(`session_token:${hashedToken}`);
      if (cached) {
        const { session, user } = JSON.parse(cached);

        // Check if still valid
        if (new Date(session.expiresAt) > new Date() && session.isActive) {
          return { session, user, isValid: true };
        }
      }
    } catch (error) {
      console.warn("Cache retrieval failed:", error);
    }
    return null;
  }

  private async logAuthEvent(entry: AuthAuditEntry): Promise<void> {
    try {
      // Log to database (could be extended to external audit service)
      await this.prisma.userEvent.create({
        data: {
          userId: entry.userId!,
          sessionId: entry.sessionId || null,
          eventType: entry.event,
          timestamp: entry.timestamp,
          metadata: entry.metadata as any,
          ipAddress: entry.ipAddress || null,
          userAgent: entry.userAgent || null,
          isError: !entry.success,
          errorMsg: entry.errorReason || null,
        },
      });
    } catch (error) {
      console.error("Failed to log auth event:", error);
    }
  }

  private startCleanupProcess(): void {
    this.cleanupInterval = setInterval(async () => {
      try {
        await this.prisma.userSession.updateMany({
          where: {
            expiresAt: { lt: new Date() },
            isActive: true,
          },
          data: { isActive: false, endedAt: new Date() },
        });
      } catch (error) {
        console.error("Session cleanup failed:", error);
      }
    }, this.config.cleanupIntervalMinutes * 60 * 1000);
  }

  /**
   * Cleanup and stop the service
   */
  public destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}
