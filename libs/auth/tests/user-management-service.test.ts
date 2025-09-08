/**
 * Unit Tests for UserManagementService
 * Tests user CRUD operations and management functionality
 */

import { UserManagementService } from "../src/services/user-management-service";
import { ServiceDependencies, User } from "../src/types";
import { KeycloakService } from "../src/services/keycloak-service";
import { SessionService } from "../src/services/session-service";

// Mock services
jest.mock("../src/services/keycloak-service");
jest.mock("../src/services/session-service");

describe("UserManagementService", () => {
  let userService: UserManagementService;
  let mockDeps: ServiceDependencies;
  let mockKeycloakService: jest.Mocked<KeycloakService>;
  let mockSessionService: jest.Mocked<SessionService>;

  const mockUser: User = {
    id: "test-user-id",
    email: "test@example.com",
    name: "Test User",
    roles: ["user"],
    permissions: ["read:own-data"],
    metadata: {},
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    // Create mock dependencies
    mockDeps = (global as any).testUtils.createMockDeps();

    // Create mock services
    mockKeycloakService = {
      getUserById: jest.fn(),
      updateUser: jest.fn(),
      deleteUser: jest.fn(),
    } as unknown as jest.Mocked<KeycloakService>;

    mockSessionService = {
      deleteUserSessions: jest.fn(),
      getUserSessions: jest.fn(),
    } as unknown as jest.Mocked<SessionService>;

    userService = new UserManagementService(mockDeps, {
      keycloakService: mockKeycloakService,
      sessionService: mockSessionService,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should create service instance", () => {
    expect(userService).toBeDefined();
  });

  describe("getUserById", () => {
    it("should successfully retrieve user by ID", async () => {
      mockKeycloakService.getUserById.mockResolvedValue(mockUser);

      const result = await userService.getUserById("test-user-id");

      expect(result).toEqual({
        ...mockUser,
        metadata: {
          ...mockUser.metadata,
          lastUpdated: expect.any(String),
        },
      });
      expect(mockKeycloakService.getUserById).toHaveBeenCalledWith(
        "test-user-id"
      );
    });

    it("should return null for non-existent user", async () => {
      mockKeycloakService.getUserById.mockResolvedValue(null);

      const result = await userService.getUserById("non-existent-id");

      expect(result).toBeNull();
    });
  });

  describe("updateUser", () => {
    it("should successfully update user", async () => {
      const userUpdates: Partial<User> = {
        name: "Updated User",
        roles: ["user", "admin"],
      };

      mockKeycloakService.updateUser.mockResolvedValue(true);

      const result = await userService.updateUser("test-user-id", userUpdates);

      expect(result).toBe(true);
      expect(mockKeycloakService.updateUser).toHaveBeenCalledWith(
        "test-user-id",
        userUpdates
      );
    });

    it("should return false when update fails", async () => {
      const userUpdates: Partial<User> = { name: "Updated User" };

      mockKeycloakService.updateUser.mockResolvedValue(false);

      const result = await userService.updateUser("test-user-id", userUpdates);

      expect(result).toBe(false);
    });
  });

  describe("deleteUser", () => {
    it("should successfully delete user", async () => {
      mockSessionService.deleteUserSessions.mockResolvedValue(true);
      mockKeycloakService.deleteUser.mockResolvedValue(true);

      const result = await userService.deleteUser("test-user-id");

      expect(result).toBe(true);
      expect(mockSessionService.deleteUserSessions).toHaveBeenCalledWith(
        "test-user-id"
      );
      expect(mockKeycloakService.deleteUser).toHaveBeenCalledWith(
        "test-user-id"
      );
    });

    it("should return false when deletion fails", async () => {
      mockSessionService.deleteUserSessions.mockResolvedValue(true);
      mockKeycloakService.deleteUser.mockResolvedValue(false);

      const result = await userService.deleteUser("test-user-id");

      expect(result).toBe(false);
    });
  });

  describe("searchUsers", () => {
    it("should return empty array for search (placeholder implementation)", async () => {
      const result = await userService.searchUsers("test query", 10);

      expect(result).toEqual([]);
    });
  });

  describe("getUserSessions", () => {
    it("should successfully get user sessions", async () => {
      const mockSessions = [
        {
          id: "session-1",
          userId: "test-user-id",
          isActive: true,
          expiresAt: new Date(Date.now() + 3600000),
          createdAt: new Date(),
          lastActivity: new Date(),
          deviceInfo: { type: "desktop", os: "Linux" },
          ipAddress: "127.0.0.1",
          userAgent: "test-agent",
        },
      ];
      mockSessionService.getUserSessions.mockResolvedValue(mockSessions);

      const result = await userService.getUserSessions("test-user-id");

      expect(result).toEqual(mockSessions);
      expect(mockSessionService.getUserSessions).toHaveBeenCalledWith(
        "test-user-id"
      );
    });
  });

  describe("validateUserUpdate", () => {
    it("should validate valid user updates", async () => {
      const userUpdates: Partial<User> = {
        name: "Updated User",
        roles: ["user", "admin"],
      };

      const result = await userService.validateUserUpdate(userUpdates);

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it("should reject invalid email format", async () => {
      const invalidUpdates = { email: "invalid-email" };

      const result = await userService.validateUserUpdate(invalidUpdates);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Invalid email format");
    });
  });

  describe("getUserStats", () => {
    it("should return user statistics", async () => {
      const mockSessions = [
        {
          id: "session-1",
          userId: "test-user-id",
          isActive: true,
          expiresAt: new Date(Date.now() + 3600000),
          createdAt: new Date(),
          lastActivity: new Date(),
          deviceInfo: { type: "desktop", os: "Linux" },
          ipAddress: "127.0.0.1",
          userAgent: "test-agent",
        },
        {
          id: "session-2",
          userId: "test-user-id",
          isActive: true,
          expiresAt: new Date(Date.now() + 3600000),
          createdAt: new Date(),
          lastActivity: new Date(),
          deviceInfo: { type: "mobile", os: "Android" },
          ipAddress: "127.0.0.1",
          userAgent: "test-agent-2",
        },
      ];

      mockKeycloakService.getUserById.mockResolvedValue(mockUser);
      mockSessionService.getUserSessions.mockResolvedValue(mockSessions);

      const result = await userService.getUserStats("test-user-id");

      expect(result).toEqual({
        sessionCount: 2,
        accountAge: expect.any(Number),
      });
      expect(mockKeycloakService.getUserById).toHaveBeenCalledWith(
        "test-user-id"
      );
      expect(mockSessionService.getUserSessions).toHaveBeenCalledWith(
        "test-user-id"
      );
    });

    it("should return null for non-existent user", async () => {
      mockKeycloakService.getUserById.mockResolvedValue(null);

      const result = await userService.getUserStats("non-existent-id");

      expect(result).toBeNull();
    });
  });
});
