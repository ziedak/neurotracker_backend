/**
 * Basic Integration Tests for AuthenticationService
 * Tests the main orchestrator instantiation and basic functionality
 */

import { AuthenticationService } from "../src/services/auth-service";
import { ServiceDependencies, AuthConfig } from "../src/types";

describe("AuthenticationService - Basic Integration", () => {
  let authService: AuthenticationService;
  let mockDeps: ServiceDependencies;
  let mockConfig: AuthConfig;

  beforeEach(() => {
    // Create mock dependencies using the global test utilities
    mockDeps = (global as any).testUtils.createMockDeps();
    mockConfig = (global as any).testUtils.createMockAuthConfig();

    authService = new AuthenticationService(mockConfig, mockDeps);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should create service instance", () => {
    expect(authService).toBeDefined();
    expect(authService).toBeInstanceOf(AuthenticationService);
  });

  it("should have all required service accessors", () => {
    expect(authService.getJWTService()).toBeDefined();
    expect(authService.getKeycloakService()).toBeDefined();
    expect(authService.getPermissionService()).toBeDefined();
    expect(authService.getSessionService()).toBeDefined();
    expect(authService.getApiKeyService()).toBeDefined();
  });

  it("should initialize successfully", async () => {
    await expect(authService.initialize()).resolves.not.toThrow();
  });

  it("should perform health check", async () => {
    const health = await authService.healthCheck();

    expect(health).toHaveProperty("overall");
    expect(health).toHaveProperty("jwt");
    expect(health).toHaveProperty("keycloak");
    expect(health).toHaveProperty("permissions");
    expect(typeof health.overall).toBe("boolean");
  });

  it("should handle login method (basic structure test)", async () => {
    const credentials = {
      email: "test@example.com",
      password: "password123",
    };

    // This will test the delegation structure, even if it fails due to mocking
    const result = await authService.login(credentials);

    expect(result).toHaveProperty("success");
    expect(typeof result.success).toBe("boolean");
  });

  it("should handle logout method", async () => {
    const result = await authService.logout("test-user-id");

    expect(typeof result).toBe("boolean");
  });

  it("should handle getUserById method", async () => {
    const result = await authService.getUserById("test-user-id");

    // Result can be null or a user object
    expect(result === null || typeof result === "object").toBe(true);
  });

  it("should handle updateUser method", async () => {
    const updates = { name: "Updated Name" };
    const result = await authService.updateUser("test-user-id", updates);

    expect(typeof result).toBe("boolean");
  });

  it("should handle verifyToken method", async () => {
    const result = await authService.verifyToken("test-token");

    expect(result === null || typeof result === "object").toBe(true);
  });

  it("should handle refreshToken method", async () => {
    const result = await authService.refreshToken("refresh-token");

    expect(result).toHaveProperty("success");
    expect(typeof result.success).toBe("boolean");
  });

  it("should handle permission checking", () => {
    const mockUser = {
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

    const result = authService.can(mockUser, "read", "data");

    expect(typeof result).toBe("boolean");
  });

  it("should handle permission retrieval", () => {
    const mockUser = {
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

    const permissions = authService.getUserPermissions(mockUser);

    expect(Array.isArray(permissions)).toBe(true);
  });
});
