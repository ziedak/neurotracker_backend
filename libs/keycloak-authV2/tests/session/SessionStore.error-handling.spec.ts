/**
 * SessionStore Error Handling Tests
 *
 * Tests to ensure database errors are properly propagated and not silently masked.
 * These tests verify the fixes for 3 critical silent failure patterns.
 */

import { SessionStore } from "../../src/services/session/SessionStore";
import type { UserSession } from "../../src/services/session/sessionTypes";

// Mock the encryption module before any imports
jest.mock("../../src/services/encryption/TokenEncryption", () => ({
  getTokenEncryption: jest.fn(() => ({
    encryptTokens: jest.fn((tokens) => tokens),
    decryptTokens: jest.fn((tokens) => tokens),
  })),
}));

// Mock AccountService to avoid encryption dependencies
jest.mock("../../src/services/account/AccountService", () => ({
  AccountService: jest.fn().mockImplementation(() => ({
    storeTokens: jest.fn(),
    getTokens: jest.fn(),
    updateTokens: jest.fn(),
    clearTokens: jest.fn(),
  })),
}));

describe("SessionStore - Error Handling (Critical Fixes)", () => {
  let sessionStore: SessionStore;
  let mockUserSessionRepo: any;
  let mockPrisma: any;

  beforeEach(() => {
    // Create mock repository with all required methods
    mockUserSessionRepo = {
      findBySessionToken: jest.fn(),
      findActiveByUserId: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      updateById: jest.fn(),
      cleanupExpiredSessions: jest.fn(),
    } as any;

    mockPrisma = {} as any;

    sessionStore = new SessionStore(
      mockUserSessionRepo,
      mockPrisma,
      undefined, // no cache service for these tests
      undefined, // logger will use default
      undefined, // no metrics
      { cacheEnabled: false }
    );
  });

  describe("Fix #1: retrieveSession() - Database Error Handling", () => {
    it("should return null for non-existent session (valid case)", async () => {
      // Mock: Session not found in database
      mockUserSessionRepo.findBySessionToken.mockResolvedValue(null);

      const result = await sessionStore.retrieveSession("non-existent-id");

      expect(result).toBeNull();
      expect(mockUserSessionRepo.findBySessionToken).toHaveBeenCalledWith(
        "non-existent-id"
      );
    });

    it("should return null for inactive session (valid case)", async () => {
      // Mock: Session found but inactive
      mockUserSessionRepo.findBySessionToken.mockResolvedValue({
        id: "session-123",
        userId: "user-123",
        isActive: false,
        lastAccessedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const result = await sessionStore.retrieveSession("session-123");

      expect(result).toBeNull();
    });

    it("should THROW on database error (not return null)", async () => {
      // Mock: Database connection failure
      const dbError = new Error("Connection to database lost");
      mockUserSessionRepo.findBySessionToken.mockRejectedValue(dbError);

      // Should throw, not return null
      await expect(sessionStore.retrieveSession("session-123")).rejects.toThrow(
        "Failed to retrieve session: Connection to database lost"
      );

      // Should NOT return null on database errors
      // This was the bug - returning null made it indistinguishable from "not found"
    });

    it("should THROW on Prisma query error", async () => {
      // Mock: Prisma-specific error (e.g., schema mismatch)
      const prismaError = new Error(
        "Invalid `prisma.userSession.findUnique()` invocation"
      );
      mockUserSessionRepo.findBySessionToken.mockRejectedValue(prismaError);

      await expect(sessionStore.retrieveSession("session-123")).rejects.toThrow(
        /Failed to retrieve session/
      );
    });

    it("should return active session successfully (happy path)", async () => {
      // Mock: Valid active session
      const mockSession = {
        id: "session-123",
        userId: "user-123",
        isActive: true,
        lastAccessedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
      };

      mockUserSessionRepo.findBySessionToken.mockResolvedValue(
        mockSession as any
      );

      const result = await sessionStore.retrieveSession("session-123");

      expect(result).not.toBeNull();
      expect(result?.id).toBe("session-123");
      expect(result?.isActive).toBe(true);
    });
  });

  describe("Fix #2: getUserSessions() - Database Error Handling", () => {
    it("should return empty array for user with no sessions (valid case)", async () => {
      // Mock: User has no sessions
      mockUserSessionRepo.findActiveByUserId.mockResolvedValue([]);

      const result = await sessionStore.getUserSessions("user-123");

      expect(result).toEqual([]);
      expect(mockUserSessionRepo.findActiveByUserId).toHaveBeenCalledWith(
        "user-123",
        { orderBy: { lastAccessedAt: "desc" } }
      );
    });

    it("should THROW on database error (not return empty array)", async () => {
      // Mock: Database connection failure
      const dbError = new Error("Connection to database lost");
      mockUserSessionRepo.findActiveByUserId.mockRejectedValue(dbError);

      // Should throw, not return empty array
      await expect(sessionStore.getUserSessions("user-123")).rejects.toThrow(
        "Failed to retrieve user sessions: Connection to database lost"
      );

      // Should NOT return [] on database errors
      // This was the bug - returning [] made it indistinguishable from "no sessions"
    });

    it("should THROW on Prisma query error", async () => {
      // Mock: Prisma-specific error
      const prismaError = new Error(
        "Invalid `prisma.userSession.findMany()` invocation"
      );
      mockUserSessionRepo.findActiveByUserId.mockRejectedValue(prismaError);

      await expect(sessionStore.getUserSessions("user-123")).rejects.toThrow(
        /Failed to retrieve user sessions/
      );
    });

    it("should return user sessions successfully (happy path)", async () => {
      // Mock: User has active sessions
      const mockSessions = [
        {
          id: "session-1",
          userId: "user-123",
          isActive: true,
          lastAccessedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "session-2",
          userId: "user-123",
          isActive: true,
          lastAccessedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockUserSessionRepo.findActiveByUserId.mockResolvedValue(
        mockSessions as any
      );

      const result = await sessionStore.getUserSessions("user-123");

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("session-1");
      expect(result[1].id).toBe("session-2");
    });
  });

  describe("Fix #3: getActiveSessionCount() - Database Error Handling (SECURITY CRITICAL)", () => {
    it("should return 0 for user with no sessions (valid case)", async () => {
      // Mock: User has no active sessions
      mockUserSessionRepo.count.mockResolvedValue(0);

      const result = await sessionStore.getActiveSessionCount("user-123");

      expect(result).toBe(0);
      expect(mockUserSessionRepo.count).toHaveBeenCalledWith({
        where: {
          userId: "user-123",
          isActive: true,
          expiresAt: { gt: expect.any(Date) },
        },
      });
    });

    it("should THROW on database error (SECURITY: not return 0)", async () => {
      // Mock: Database connection failure
      const dbError = new Error("Connection to database lost");
      mockUserSessionRepo.count.mockRejectedValue(dbError);

      // CRITICAL: Should throw, not return 0
      await expect(
        sessionStore.getActiveSessionCount("user-123")
      ).rejects.toThrow(
        "Failed to get active session count: Connection to database lost"
      );

      // This is SECURITY CRITICAL:
      // Returning 0 would bypass concurrent session limits:
      // if (count >= maxSessions) → if (0 >= 5) → false → limit never enforced
    });

    it("should THROW on Prisma query error (SECURITY)", async () => {
      // Mock: Prisma-specific error
      const prismaError = new Error(
        "Invalid `prisma.userSession.count()` invocation"
      );
      mockUserSessionRepo.count.mockRejectedValue(prismaError);

      await expect(
        sessionStore.getActiveSessionCount("user-123")
      ).rejects.toThrow(/Failed to get active session count/);
    });

    it("should return correct count for user with sessions (happy path)", async () => {
      // Mock: User has 3 active sessions
      mockUserSessionRepo.count.mockResolvedValue(3);

      const result = await sessionStore.getActiveSessionCount("user-123");

      expect(result).toBe(3);
    });

    it("should handle device fingerprint filtering", async () => {
      // Mock: Count with device fingerprint
      mockUserSessionRepo.count.mockResolvedValue(2);

      const result = await sessionStore.getActiveSessionCount(
        "user-123",
        "device-abc"
      );

      expect(result).toBe(2);
      expect(mockUserSessionRepo.count).toHaveBeenCalledWith({
        where: {
          userId: "user-123",
          isActive: true,
          expiresAt: { gt: expect.any(Date) },
          fingerprint: "device-abc",
        },
      });
    });
  });

  describe("Fix #4: getOldestSession() - Database Error Handling", () => {
    it("should return null when user has no sessions (valid case)", async () => {
      // Mock: No sessions found
      mockUserSessionRepo.findMany.mockResolvedValue([]);

      const result = await sessionStore.getOldestSession("user-123");

      expect(result).toBeNull();
    });

    it("should THROW on database error (not return null)", async () => {
      // Mock: Database connection failure
      const dbError = new Error("Connection to database lost");
      mockUserSessionRepo.findMany.mockRejectedValue(dbError);

      // Should throw (used for security control - terminating oldest session)
      await expect(sessionStore.getOldestSession("user-123")).rejects.toThrow(
        "Failed to get oldest session: Connection to database lost"
      );
    });

    it("should return oldest session successfully (happy path)", async () => {
      // Mock: Oldest session found
      const mockSession = {
        id: "session-oldest",
        userId: "user-123",
        isActive: true,
        createdAt: new Date("2025-01-01"),
        updatedAt: new Date(),
        lastAccessedAt: new Date(),
      };

      mockUserSessionRepo.findMany.mockResolvedValue([mockSession as any]);

      const result = await sessionStore.getOldestSession("user-123");

      expect(result).not.toBeNull();
      expect(result?.id).toBe("session-oldest");
    });
  });

  describe("Error Handling Philosophy", () => {
    it("demonstrates the difference between not-found and database-error", async () => {
      // VALID: Session not found (return null)
      mockUserSessionRepo.findBySessionToken.mockResolvedValue(null);
      const notFound = await sessionStore.retrieveSession("fake-id");
      expect(notFound).toBeNull(); // ✅ Expected behavior

      // INVALID: Database error (throw error)
      mockUserSessionRepo.findBySessionToken.mockRejectedValue(
        new Error("DB error")
      );
      await expect(
        sessionStore.retrieveSession("session-id")
      ).rejects.toThrow(); // ✅ Fail loudly

      // The fix ensures these two scenarios are distinguishable
    });

    it("demonstrates why returning default values on errors is dangerous", async () => {
      // BEFORE FIX: This test would pass even if database was broken
      // mockUserSessionRepo.count.mockRejectedValue(new Error("DB error"));
      // const count = await sessionStore.getActiveSessionCount("user-123");
      // expect(count).toBe(0); // ✅ Test passes, but DB is broken!

      // AFTER FIX: Test correctly fails when database is broken
      mockUserSessionRepo.count.mockRejectedValue(new Error("DB error"));
      await expect(
        sessionStore.getActiveSessionCount("user-123")
      ).rejects.toThrow(); // ✅ Test fails as it should
    });
  });
});
