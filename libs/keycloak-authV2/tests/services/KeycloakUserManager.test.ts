/**
 * KeycloakUserManager Unit Tests
 */

// Mock dependencies
jest.mock("@libs/utils", () => ({
  createLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

jest.mock("@libs/database", () => ({
  CacheService: {
    create: jest.fn(() => ({
      get: jest.fn(() => ({ data: null })),
      set: jest.fn(),
      invalidate: jest.fn(),
    })),
  },
}));

jest.mock("@libs/messaging", () => ({
  createHttpClient: jest.fn(() => ({
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  })),
  HttpStatus: {
    isSuccess: jest.fn((status: number) => status >= 200 && status < 300),
  },
}));

// Import after mocks
import { KeycloakUserManager } from "../../src/services/KeycloakUserManager";
import type { AuthV2Config } from "../../src/services/config";
import { KeycloakClient } from "../../src/client/KeycloakClient";

// Helper functions for consistent mock responses
const createMockTokenResponse = (): any => ({
  access_token: "admin-token",
  expires_in: 300,
  token_type: "Bearer",
  scope: "openid profile email",
});

const createMockDiscoveryDocument = (): any => ({
  issuer: "https://keycloak.example.com/realms/test-realm",
  authorization_endpoint:
    "https://keycloak.example.com/realms/test-realm/protocol/openid-connect/auth",
  token_endpoint:
    "https://keycloak.example.com/realms/test-realm/protocol/openid-connect/token",
  userinfo_endpoint:
    "https://keycloak.example.com/realms/test-realm/protocol/openid-connect/userinfo",
  jwks_uri:
    "https://keycloak.example.com/realms/test-realm/protocol/openid-connect/certs",
  introspection_endpoint:
    "https://keycloak.example.com/realms/test-realm/protocol/openid-connect/token/introspect",
  end_session_endpoint:
    "https://keycloak.example.com/realms/test-realm/protocol/openid-connect/logout",
  id_token_signing_alg_values_supported: ["RS256"],
  response_types_supported: ["code", "token", "id_token"],
  scopes_supported: ["openid", "profile", "email"],
  grant_types_supported: [
    "authorization_code",
    "client_credentials",
    "refresh_token",
  ],
});

const mockMetrics = {
  recordCounter: jest.fn(),
  recordTimer: jest.fn(),
  recordGauge: jest.fn(),
  recordHistogram: jest.fn(),
  recordSummary: jest.fn(),
  getMetrics: jest.fn(),
  recordApiRequest: jest.fn(),
  recordDatabaseOperation: jest.fn(),
  recordAuthOperation: jest.fn(),
  recordWebSocketActivity: jest.fn(),
  recordNodeMetrics: jest.fn(),
  measureEventLoopLag: jest.fn(),
};

const mockHttpClient = {
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  delete: jest.fn(),
} as any;

describe("KeycloakUserManager", () => {
  let mockAdminClient: jest.Mocked<KeycloakClient>;
  let mockConfig: AuthV2Config;

  let userManager: KeycloakUserManager;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create mocks
    mockAdminClient = {
      authenticateClientCredentials: jest.fn(),
      getDiscoveryDocument: jest.fn(),
    } as any;

    mockConfig = {
      jwt: {},
      cache: {
        enabled: true,
        ttl: { jwt: 300, apiKey: 600, session: 3600, userInfo: 1800 },
      },
      security: {
        constantTimeComparison: true,
        apiKeyHashRounds: 12,
        sessionRotationInterval: 86400,
      },
      session: {
        maxConcurrentSessions: 10,
        enforceIpConsistency: false,
        enforceUserAgentConsistency: false,
        tokenEncryption: true,
      },
      encryption: { key: "test-key" },
    } as AuthV2Config;

    // Mock createHttpClient to return our mock
    const { createHttpClient } = require("@libs/messaging");
    (createHttpClient as jest.Mock).mockReturnValue(mockHttpClient);

    // Create instance
    userManager = new KeycloakUserManager(
      mockAdminClient,
      mockConfig,
      mockMetrics
    );
  });

  describe("constructor", () => {
    it("should initialize with cache when enabled", () => {
      const { CacheService } = require("@libs/database");
      expect(CacheService.create).toHaveBeenCalledWith(mockMetrics);
    });

    it("should initialize without cache when disabled", () => {
      const configWithoutCache = {
        ...mockConfig,
        cache: {
          enabled: false,
          ttl: { jwt: 300, apiKey: 600, session: 3600, userInfo: 1800 },
        },
      };

      // Reset mocks to avoid interference from previous test
      jest.clearAllMocks();

      new KeycloakUserManager(mockAdminClient, configWithoutCache, mockMetrics);

      const { CacheService } = require("@libs/database");
      expect(CacheService.create).not.toHaveBeenCalled();
    });
  });

  describe("searchUsers", () => {
    const mockUsers = [
      {
        id: "user1",
        username: "testuser",
        email: "test@example.com",
        firstName: "Test",
        lastName: "User",
        enabled: true,
        emailVerified: true,
      },
    ];

    beforeEach(() => {
      mockAdminClient.authenticateClientCredentials.mockResolvedValue(
        createMockTokenResponse()
      ); // {

      mockAdminClient.getDiscoveryDocument.mockReturnValue(
        createMockDiscoveryDocument()
      );

      mockHttpClient.get.mockResolvedValue({
        config: {},
        status: 200,
        statusText: "OK",
        data: mockUsers,
        headers: {},
      });
    });

    it("should search users successfully", async () => {
      const options = { username: "testuser", max: 10 };
      const result = await userManager.searchUsers(options);

      expect(
        mockAdminClient.authenticateClientCredentials
      ).toHaveBeenCalledWith([
        "manage-users",
        "manage-realm",
        "view-users",
        "view-realm",
      ]);
      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "https://keycloak.example.com/admin/realms/test-realm/users?username=testuser&max=10",
        expect.objectContaining({
          headers: {
            Authorization: "Bearer admin-token",
            Accept: "application/json",
          },
        })
      );
      expect(result).toEqual(mockUsers);
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "keycloak.user_manager.search_users",
        1
      );
      expect(mockMetrics.recordTimer).toHaveBeenCalled();
    });

    it("should handle search errors", async () => {
      mockHttpClient.get.mockResolvedValue({
        config: {},
        status: 500,
        statusText: "Internal Server Error",
        data: "Server error",
        headers: {},
      });

      await expect(userManager.searchUsers({})).rejects.toThrow(
        "User search failed: 500 Internal Server Error"
      );
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "keycloak.user_manager.search_users_error",
        1
      );
    });
  });

  describe("getUserById", () => {
    const mockUser = {
      id: "user1",
      username: "testuser",
      email: "test@example.com",
      enabled: true,
    };

    beforeEach(() => {
      mockAdminClient.authenticateClientCredentials.mockResolvedValue(
        createMockTokenResponse()
      ); // {

      mockAdminClient.getDiscoveryDocument.mockReturnValue(
        createMockDiscoveryDocument()
      );
    });

    it("should return user from cache if available", async () => {
      const { CacheService } = require("@libs/database");
      const mockCache = CacheService.create.mock.results[0].value;
      mockCache.get.mockResolvedValue({ data: mockUser });

      const result = await userManager.getUserById("user1");

      expect(mockCache.get).toHaveBeenCalledWith("keycloak_user:user1");
      expect(result).toEqual(mockUser);
      expect(mockHttpClient.get).not.toHaveBeenCalled();
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "keycloak.user_manager.get_user_cache_hit",
        1
      );
    });

    it("should fetch user from API when not in cache", async () => {
      const { CacheService } = require("@libs/database");
      const mockCache = CacheService.create.mock.results[0].value;
      mockCache.get.mockResolvedValue({ data: null });

      mockHttpClient.get.mockResolvedValue({
        config: {},
        status: 200,
        statusText: "OK",
        data: mockUser,
        headers: {},
      });

      const result = await userManager.getUserById("user1");

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "https://keycloak.example.com/admin/realms/test-realm/users/user1",
        expect.objectContaining({
          headers: {
            Authorization: "Bearer admin-token",
            Accept: "application/json",
          },
        })
      );
      expect(mockCache.set).toHaveBeenCalledWith(
        "keycloak_user:user1",
        mockUser,
        300
      );
      expect(result).toEqual(mockUser);
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "keycloak.user_manager.get_user",
        1
      );
    });

    it("should return null for 404 response", async () => {
      mockHttpClient.get.mockResolvedValue({
        config: {},
        status: 404,
        statusText: "Not Found",
        data: null,
        headers: {},
      });

      const result = await userManager.getUserById("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("getUserByUsername", () => {
    it("should delegate to searchUsers with exact match", async () => {
      const mockUsers = [{ id: "user1", username: "testuser" }];
      const searchUsersSpy = jest.spyOn(userManager, "searchUsers");
      searchUsersSpy.mockResolvedValue(mockUsers);

      const result = await userManager.getUserByUsername("testuser");

      expect(searchUsersSpy).toHaveBeenCalledWith({
        username: "testuser",
        exact: true,
        max: 1,
      });
      expect(result).toEqual(mockUsers[0]);
    });

    it("should return null when no users found", async () => {
      const searchUsersSpy = jest.spyOn(userManager, "searchUsers");
      searchUsersSpy.mockResolvedValue([]);

      const result = await userManager.getUserByUsername("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("createUser", () => {
    const createOptions = {
      username: "newuser",
      email: "new@example.com",
      firstName: "New",
      lastName: "User",
      password: "password123",
      realmRoles: ["user"],
    };

    beforeEach(() => {
      mockAdminClient.authenticateClientCredentials.mockResolvedValue(
        createMockTokenResponse()
      );
      mockAdminClient.getDiscoveryDocument.mockReturnValue(
        createMockDiscoveryDocument()
      );
    });

    it("should create user successfully", async () => {
      mockHttpClient.post.mockResolvedValue({
        status: 201,
        statusText: "Created",
        data: null,
        headers: {
          location:
            "https://keycloak.example.com/admin/realms/test-realm/users/user123",
        },
      });

      // Mock assignRealmRoles
      const assignRolesSpy = jest.spyOn(userManager, "assignRealmRoles");
      assignRolesSpy.mockResolvedValue();

      const result = await userManager.createUser(createOptions);

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "https://keycloak.example.com/admin/realms/test-realm/users",
        expect.any(String),
        expect.objectContaining({
          headers: {
            Authorization: "Bearer admin-token",
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        })
      );
      expect(assignRolesSpy).toHaveBeenCalledWith("user123", ["user"]);
      expect(result).toBe("user123");
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "keycloak.user_manager.create_user",
        1
      );
    });

    it("should create user without password", async () => {
      const optionsWithoutPassword = {
        username: "newuser",
        email: "new@example.com",
        firstName: "New",
        lastName: "User",
      };

      mockHttpClient.post.mockResolvedValue({
        status: 201,
        statusText: "Created",
        data: null,
        headers: {
          location:
            "https://keycloak.example.com/admin/realms/test-realm/users/user123",
        },
      });

      const result = await userManager.createUser(optionsWithoutPassword);

      expect(result).toBe("user123");
    });
  });

  describe("updateUser", () => {
    const updateOptions = {
      email: "updated@example.com",
      firstName: "Updated",
      enabled: true,
    };

    beforeEach(() => {
      mockAdminClient.authenticateClientCredentials.mockResolvedValue(
        createMockTokenResponse()
      );
      mockAdminClient.getDiscoveryDocument.mockReturnValue(
        createMockDiscoveryDocument()
      );

      mockHttpClient.put.mockResolvedValue({
        status: 204,
        statusText: "No Content",
        data: null,
        headers: {},
      });
    });

    it("should update user successfully", async () => {
      await userManager.updateUser("user1", updateOptions);

      expect(mockHttpClient.put).toHaveBeenCalledWith(
        "https://keycloak.example.com/admin/realms/test-realm/users/user1",
        JSON.stringify(updateOptions),
        expect.objectContaining({
          headers: {
            Authorization: "Bearer admin-token",
            "Content-Type": "application/json",
          },
        })
      );
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "keycloak.user_manager.update_user",
        1
      );
    });

    it("should invalidate cache after update", async () => {
      const { CacheService } = require("@libs/database");
      const mockCache = CacheService.create.mock.results[0].value;

      await userManager.updateUser("user1", updateOptions);

      expect(mockCache.invalidate).toHaveBeenCalledWith("keycloak_user:user1");
    });
  });

  describe("deleteUser", () => {
    beforeEach(() => {
      mockAdminClient.authenticateClientCredentials.mockResolvedValue(
        createMockTokenResponse()
      );

      mockAdminClient.getDiscoveryDocument.mockReturnValue(
        createMockDiscoveryDocument()
      );
    });

    it("should delete user successfully", async () => {
      mockHttpClient.delete.mockResolvedValue({
        status: 204,
        statusText: "No Content",
        data: null,
        headers: {},
      });

      await userManager.deleteUser("user1");

      expect(mockHttpClient.delete).toHaveBeenCalledWith(
        "https://keycloak.example.com/admin/realms/test-realm/users/user1",
        expect.objectContaining({
          headers: {
            Authorization: "Bearer admin-token",
          },
        })
      );
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "keycloak.user_manager.delete_user",
        1
      );
    });

    it("should handle 404 as successful deletion", async () => {
      mockHttpClient.delete.mockResolvedValue({
        status: 404,
        statusText: "Not Found",
        data: null,
        headers: {},
      });

      await expect(
        userManager.deleteUser("nonexistent")
      ).resolves.toBeUndefined();
    });
  });

  describe("resetPassword", () => {
    const resetOptions = {
      password: "newpassword123",
      temporary: true,
    };

    beforeEach(() => {
      mockAdminClient.authenticateClientCredentials.mockResolvedValue(
        createMockTokenResponse()
      );

      // Mock discovery document for getAdminApiUrl
      mockAdminClient.getDiscoveryDocument.mockReturnValue({
        issuer: "https://keycloak.example.com/realms/test-realm",
        authorization_endpoint:
          "https://keycloak.example.com/realms/test-realm/protocol/openid-connect/auth",
        token_endpoint:
          "https://keycloak.example.com/realms/test-realm/protocol/openid-connect/token",
        userinfo_endpoint:
          "https://keycloak.example.com/realms/test-realm/protocol/openid-connect/userinfo",
        jwks_uri:
          "https://keycloak.example.com/realms/test-realm/protocol/openid-connect/certs",
        introspection_endpoint:
          "https://keycloak.example.com/realms/test-realm/protocol/openid-connect/token/introspect",
        end_session_endpoint:
          "https://keycloak.example.com/realms/test-realm/protocol/openid-connect/logout",
        id_token_signing_alg_values_supported: ["RS256"],
        response_types_supported: ["code", "id_token", "token"],
        scopes_supported: ["openid", "profile", "email"],
        grant_types_supported: [
          "authorization_code",
          "client_credentials",
          "refresh_token",
        ],
      });

      mockHttpClient.put.mockResolvedValue({
        status: 204,
        statusText: "No Content",
        data: null,
        headers: {},
        config: { headers: {} },
      });
    });

    it("should reset password successfully", async () => {
      await userManager.resetPassword("user1", resetOptions);

      expect(mockHttpClient.put).toHaveBeenCalledWith(
        "https://keycloak.example.com/admin/realms/test-realm/users/user1/reset-password",
        JSON.stringify({
          type: "password",
          value: "newpassword123",
          temporary: true,
        }),
        expect.objectContaining({
          headers: {
            Authorization: "Bearer admin-token",
            "Content-Type": "application/json",
          },
        })
      );
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "keycloak.user_manager.reset_password",
        1
      );
    });
  });

  describe("getUserRealmRoles", () => {
    const mockRoles = [
      { id: "role1", name: "user", description: "User role" },
      { id: "role2", name: "admin", description: "Admin role" },
    ];

    beforeEach(() => {
      mockAdminClient.authenticateClientCredentials.mockResolvedValue(
        createMockTokenResponse()
      );

      mockAdminClient.getDiscoveryDocument.mockReturnValue(
        createMockDiscoveryDocument()
      );

      mockHttpClient.get.mockResolvedValue({
        config: {},
        status: 200,
        statusText: "OK",
        data: mockRoles,
        headers: {},
      });
    });

    it("should get user realm roles successfully", async () => {
      const result = await userManager.getUserRealmRoles("user1");

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        "https://keycloak.example.com/admin/realms/test-realm/users/user1/role-mappings/realm",
        expect.objectContaining({
          headers: {
            Authorization: "Bearer admin-token",
            Accept: "application/json",
          },
        })
      );
      expect(result).toEqual(mockRoles);
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "keycloak.user_manager.get_realm_roles",
        1
      );
    });
  });

  describe("assignRealmRoles", () => {
    const availableRoles = [
      { id: "role1", name: "user" },
      { id: "role2", name: "admin" },
      { id: "role3", name: "manager" },
    ];

    beforeEach(() => {
      mockAdminClient.authenticateClientCredentials.mockResolvedValue(
        createMockTokenResponse()
      );

      mockAdminClient.getDiscoveryDocument.mockReturnValue(
        createMockDiscoveryDocument()
      );
    });

    it("should assign realm roles successfully", async () => {
      // Mock getting available roles
      mockHttpClient.get
        .mockResolvedValueOnce({
          status: 200,
          statusText: "OK",
          data: availableRoles,
          headers: {},
        })
        // Mock assigning roles
        .mockResolvedValueOnce({
          status: 204,
          statusText: "No Content",
          data: null,
          headers: {},
        });

      await userManager.assignRealmRoles("user1", ["user", "admin"]);

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "https://keycloak.example.com/admin/realms/test-realm/users/user1/role-mappings/realm",
        JSON.stringify([
          { id: "role1", name: "user" },
          { id: "role2", name: "admin" },
        ]),
        expect.objectContaining({
          headers: {
            Authorization: "Bearer admin-token",
            "Content-Type": "application/json",
          },
        })
      );
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "keycloak.user_manager.assign_realm_roles",
        1
      );
    });

    it("should handle no matching roles gracefully", async () => {
      // Mock the get request to return empty roles array
      mockHttpClient.get.mockResolvedValue({
        config: { headers: {} },
        status: 200,
        statusText: "OK",
        data: [], // Empty array instead of availableRoles
        headers: {},
      });

      await userManager.assignRealmRoles("user1", ["nonexistent"]);

      expect(mockHttpClient.post).not.toHaveBeenCalled();
    });
  });

  describe("removeRealmRoles", () => {
    const userRoles = [
      { id: "role1", name: "user" },
      { id: "role2", name: "admin" },
    ];

    beforeEach(() => {
      mockAdminClient.authenticateClientCredentials.mockResolvedValue(
        createMockTokenResponse()
      );
      mockAdminClient.getDiscoveryDocument.mockReturnValue(
        createMockDiscoveryDocument()
      );
    });

    it("should remove realm roles successfully", async () => {
      // Mock getting user roles
      const getRolesSpy = jest.spyOn(userManager, "getUserRealmRoles");
      getRolesSpy.mockResolvedValue(userRoles);

      // Mock removing roles
      mockHttpClient.delete.mockResolvedValue({
        status: 204,
        statusText: "No Content",
        data: null,
        headers: {},
      });

      await userManager.removeRealmRoles("user1", ["admin"]);

      expect(mockHttpClient.delete).toHaveBeenCalledWith(
        "https://keycloak.example.com/admin/realms/test-realm/users/user1/role-mappings/realm",
        expect.objectContaining({
          headers: {
            Authorization: "Bearer admin-token",
            "Content-Type": "application/json",
          },
          data: [{ id: "role2", name: "admin" }],
        })
      );
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "keycloak.user_manager.remove_realm_roles",
        1
      );
    });
  });

  describe("assignClientRoles", () => {
    const clients = [{ id: "client-internal-id", clientId: "my-client" }];
    const clientRoles = [
      { id: "role1", name: "read" },
      { id: "role2", name: "write" },
    ];

    beforeEach(() => {
      mockAdminClient.authenticateClientCredentials.mockResolvedValue(
        createMockTokenResponse()
      );
      mockAdminClient.getDiscoveryDocument.mockReturnValue(
        createMockDiscoveryDocument()
      );
    });

    it("should assign client roles successfully", async () => {
      // Mock getting client
      mockHttpClient.get
        .mockResolvedValueOnce({
          status: 200,
          statusText: "OK",
          data: clients,
          headers: {},
        })
        // Mock getting client roles
        .mockResolvedValueOnce({
          status: 200,
          statusText: "OK",
          data: clientRoles,
          headers: {},
        })
        // Mock assigning roles
        .mockResolvedValueOnce({
          status: 204,
          statusText: "No Content",
          data: null,
          headers: {},
        });

      await userManager.assignClientRoles("user1", "my-client", ["read"]);

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "https://keycloak.example.com/admin/realms/test-realm/users/user1/role-mappings/clients/client-internal-id",
        JSON.stringify([{ id: "role1", name: "read" }]),
        expect.objectContaining({
          headers: {
            Authorization: "Bearer admin-token",
            "Content-Type": "application/json",
          },
        })
      );
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "keycloak.user_manager.assign_client_roles",
        1
      );
    });
  });

  describe("convertToUserInfo", () => {
    it("should convert Keycloak user to UserInfo", () => {
      const keycloakUser = {
        id: "user1",
        username: "testuser",
        email: "test@example.com",
        firstName: "Test",
        lastName: "User",
        enabled: true,
        emailVerified: true,
        createdTimestamp: 1234567890,
        attributes: { department: ["IT"] },
      };

      const result = userManager.convertToUserInfo(
        keycloakUser,
        ["realm:user"],
        ["read"]
      );

      expect(result).toEqual({
        id: "user1",
        username: "testuser",
        email: "test@example.com",
        name: "Test User",
        roles: ["realm:user"],
        permissions: ["read"],
        metadata: {
          enabled: true,
          emailVerified: true,
          createdTimestamp: 1234567890,
          attributes: { department: ["IT"] },
        },
      });
    });

    it("should handle missing name parts", () => {
      const keycloakUser = {
        id: "user1",
        username: "testuser",
        email: "test@example.com",
      };

      const result = userManager.convertToUserInfo(keycloakUser);

      expect(result.name).toBeUndefined();
    });
  });

  describe("getCompleteUserInfo", () => {
    const mockUser = {
      id: "user1",
      username: "testuser",
      email: "test@example.com",
      firstName: "Test",
      lastName: "User",
      enabled: true,
      emailVerified: true,
    };

    const mockRoles = [
      { id: "role1", name: "user" },
      { id: "role2", name: "admin" },
    ];

    it("should get complete user info successfully", async () => {
      const getUserSpy = jest.spyOn(userManager, "getUserById");
      getUserSpy.mockResolvedValue(mockUser);

      const getRolesSpy = jest.spyOn(userManager, "getUserRealmRoles");
      getRolesSpy.mockResolvedValue(mockRoles);

      const result = await userManager.getCompleteUserInfo("user1");

      expect(getUserSpy).toHaveBeenCalledWith("user1");
      expect(getRolesSpy).toHaveBeenCalledWith("user1");
      expect(result).toEqual({
        id: "user1",
        username: "testuser",
        email: "test@example.com",
        name: "Test User",
        roles: ["realm:user", "realm:admin"],
        permissions: [],
        metadata: {
          enabled: true,
          emailVerified: true,
          createdTimestamp: undefined,
          attributes: undefined,
        },
      });
    });

    it("should return null for non-existent user", async () => {
      const getUserSpy = jest.spyOn(userManager, "getUserById");
      getUserSpy.mockResolvedValue(null);

      const result = await userManager.getCompleteUserInfo("nonexistent");

      expect(result).toBeNull();
    });
  });
});
