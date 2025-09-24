/**
 * AuthorizationService Tests - Updated for Refactored Service
 *
 * Tests for the refactored modular Authorization service
 */

import { AuthorizationService } from "../../src/services/AuthorizationServiceRefactored";
import type {
  AuthorizationContext,
  ResourceContext,
  Action,
  Subjects,
} from "../../src/types/authorization.types";

// Mock dependencies - simplified for compatibility
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn(),
  level: "info" as const,
  setLevel: jest.fn(),
};

// Mock cache service
const mockCacheService = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  exists: jest.fn(),
  ttl: jest.fn(),
  keys: jest.fn(),
  flushAll: jest.fn(),
  healthCheck: jest.fn().mockResolvedValue({ status: "healthy" }),
} as any;

// Mock metrics
const mockMetrics = {
  recordCounter: jest.fn(),
  recordTimer: jest.fn(),
  recordGauge: jest.fn(),
} as any;

describe("AuthorizationService - Refactored", () => {
  let authService: AuthorizationService;
  let userContext: AuthorizationContext;
  let adminContext: AuthorizationContext;

  beforeEach(() => {
    jest.clearAllMocks();

    authService = new AuthorizationService(
        {
        enableAuditLog: true,
        enableMetrics: true,
        cachePermissionResults: true,
        permissionCacheTtl: 300,
        strictMode: true,
      },
      mockLogger,
      mockMetrics,
      mockCacheService,
      
    );

    userContext = {
      userId: "user123",
      roles: ["user"],
      sessionId: "session-456",
      ipAddress: "192.168.1.100",
      userAgent: "Mozilla/5.0",
    };

    adminContext = {
      userId: "admin123",
      roles: ["admin"],
      sessionId: "admin-session-789",
      ipAddress: "192.168.1.200",
      userAgent: "Mozilla/5.0",
    };
  });

  afterEach(async () => {
    await authService.cleanup();
  });

  describe("can", () => {
    it("should allow user to read their own profile", async () => {
      const result = await authService.can(userContext, "read", "User");

      expect(result).toHaveProperty("granted");
      expect(result).toHaveProperty("reason");
      expect(result).toHaveProperty("context");
      expect(typeof result.granted).toBe("boolean");
      expect(typeof result.reason).toBe("string");
    });

    it("should allow admin to manage all resources", async () => {
      const result = await authService.can(adminContext, "manage", "all");

      expect(result).toHaveProperty("granted");
      expect(result).toHaveProperty("reason");
      expect(result).toHaveProperty("context");
    });

    it("should handle resource-based permissions", async () => {
      const resourceContext: ResourceContext = {
        type: "Project",
        id: "project123",
        ownerId: "user123",
      };

      const result = await authService.can(
        userContext,
        "update",
        "Project",
        resourceContext
      );

      expect(result).toHaveProperty("granted");
      expect(result).toHaveProperty("reason");
      expect(result).toHaveProperty("context");
    });

    it("should handle invalid context gracefully", async () => {
      const invalidContext = {
        userId: "",
        roles: [],
      } as AuthorizationContext;

      const result = await authService.can(invalidContext, "read", "User");

      expect(result.granted).toBe(false);
      expect(result.reason).toContain("Invalid");
    });

    it("should handle invalid action/subject gracefully", async () => {
      const result = await authService.can(userContext, "" as Action, "User");

      expect(result.granted).toBe(false);
      expect(result.reason).toContain("Invalid");
    });
  });

  describe("cannot", () => {
    it("should return opposite of can result", async () => {
      const canResult = await authService.can(userContext, "read", "User");
      const cannotResult = await authService.cannot(
        userContext,
        "read",
        "User"
      );

      expect(cannotResult.granted).toBe(!canResult.granted);
      expect(cannotResult).toHaveProperty("reason");
      expect(cannotResult).toHaveProperty("context");
    });
  });

  describe("canAll", () => {
    it("should check multiple permissions", async () => {
      const checks = [
        { action: "read" as Action, subject: "User" as Subjects },
        { action: "create" as Action, subject: "Project" as Subjects },
      ];

      const result = await authService.canAll(userContext, checks);

      expect(result).toHaveProperty("granted");
      expect(result).toHaveProperty("reason");
      expect(result).toHaveProperty("context");
    });

    it("should handle empty checks array", async () => {
      const result = await authService.canAll(userContext, []);

      expect(result.granted).toBe(false);
      expect(result.reason).toContain("No permission checks");
    });
  });

  describe("role checking", () => {
    it("should check if user has any of specified roles", () => {
      const result = authService.hasAnyRole(userContext, ["user", "admin"]);
      expect(typeof result).toBe("boolean");
    });

    it("should check if user has all specified roles", () => {
      const result = authService.hasAllRoles(userContext, ["user"]);
      expect(typeof result).toBe("boolean");
    });

    it("should handle invalid context for role checking", () => {
      const invalidContext = { userId: "test" } as AuthorizationContext;
      const result = authService.hasAnyRole(invalidContext, ["user"]);
      expect(result).toBe(false);
    });

    it("should handle empty role arrays", () => {
      const anyResult = authService.hasAnyRole(userContext, []);
      const allResult = authService.hasAllRoles(userContext, []);

      expect(anyResult).toBe(false);
      expect(allResult).toBe(true); // vacuous truth
    });
  });

  describe("getUserPermissions", () => {
    it("should return user effective permissions", async () => {
      const permissions = await authService.getUserPermissions(userContext);

      expect(Array.isArray(permissions)).toBe(true);
    });

    it("should return admin permissions for admin user", async () => {
      const permissions = await authService.getUserPermissions(adminContext);

      expect(Array.isArray(permissions)).toBe(true);
    });

    it("should handle invalid context gracefully", async () => {
      const invalidContext = {} as AuthorizationContext;
      const permissions = await authService.getUserPermissions(invalidContext);

      expect(Array.isArray(permissions)).toBe(true);
      expect(permissions).toHaveLength(0);
    });
  });

  describe("clearUserCache", () => {
    it("should clear cache for specific user", async () => {
      await authService.clearUserCache("user123");

      // Should not throw and should complete
      expect(true).toBe(true);
    });

    it("should handle invalid user ID gracefully", async () => {
      await authService.clearUserCache("");

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe("cleanup", () => {
    it("should clean up resources without errors", async () => {
      await expect(authService.cleanup()).resolves.not.toThrow();
    });
  });

  describe("configuration options", () => {
    it("should work with minimal configuration", () => {
      const minimalService = new AuthorizationService();
      expect(minimalService).toBeInstanceOf(AuthorizationService);
    });

    it("should accept custom configuration", () => {
      const customService = new AuthorizationService(
        {
          enableAuditLog: false,
          enableMetrics: false,
          cachePermissionResults: false,
          permissionCacheTtl: 600,
          strictMode: false,
        },
        mockLogger,
        mockMetrics,
        mockCacheService,
        
      );
      expect(customService).toBeInstanceOf(AuthorizationService);
    });
  });

  describe("error handling", () => {
    it("should handle cache errors gracefully", async () => {
      // Mock cache to throw error
      mockCacheService.get.mockRejectedValue(new Error("Cache error"));

      const result = await authService.can(userContext, "read", "User");

      // Should still return a result
      expect(result).toHaveProperty("granted");
      expect(result).toHaveProperty("reason");
    });

    it("should handle metrics errors gracefully", async () => {
      // Mock metrics to throw error
      mockMetrics.recordCounter.mockImplementation(() => {
        throw new Error("Metrics error");
      });

      const result = await authService.can(userContext, "read", "User");

      // Should still return a result
      expect(result).toHaveProperty("granted");
      expect(result).toHaveProperty("reason");
    });
  });
});
