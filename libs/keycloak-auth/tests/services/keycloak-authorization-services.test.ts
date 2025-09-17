/**
 * Keycloak Authorization Services Client Test Suite
 */

import {
  KeycloakAuthorizationServicesClient,
  AuthorizationHelpers,
} from "../../src/services/keycloak-authorization-services";
import type {
  IKeycloakClientFactory,
  TokenResponse,
  AuthorizationDecision,
  ResourceRepresentation,
  PolicyRepresentation,
  PermissionTicket,
} from "../../src/types";
import { CacheService } from "@libs/database";

// Mock dependencies
jest.mock("@libs/utils", () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

jest.mock("@libs/database", () => ({
  CacheService: jest.fn().mockImplementation(() => ({
    get: jest.fn(),
    set: jest.fn(),
    invalidatePattern: jest.fn(),
  })),
}));

// Mock fetch
global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;

describe("KeycloakAuthorizationServicesClient", () => {
  let client: KeycloakAuthorizationServicesClient;
  let mockClientFactory: jest.Mocked<IKeycloakClientFactory>;
  let mockCacheService: jest.Mocked<CacheService>;

  const MOCK_REALM_URL = "https://keycloak.test.com/realms/test";
  const MOCK_ACCESS_TOKEN = "test-access-token";
  const MOCK_ADMIN_TOKEN = "test-admin-token";

  const mockTokenResponse: TokenResponse = {
    access_token: MOCK_ADMIN_TOKEN,
    refresh_token: "test-refresh-token",
    id_token: "test-id-token",
    token_type: "Bearer",
    expires_in: 3600,
    refresh_expires_in: 7200,
    scope: "openid profile email",
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock client factory
    mockClientFactory = {
      getClientCredentialsToken: jest.fn().mockResolvedValue(mockTokenResponse),
      getClient: jest.fn().mockReturnValue({ clientId: "test-client" }),
    } as any;

    // Setup mock cache service
    mockCacheService = new CacheService(
      "redis://test"
    ) as jest.Mocked<CacheService>;
    mockCacheService.get.mockResolvedValue({ data: null });
    mockCacheService.set.mockResolvedValue();
    mockCacheService.invalidatePattern.mockResolvedValue(5);

    // Create client instance
    client = new KeycloakAuthorizationServicesClient(
      mockClientFactory,
      MOCK_REALM_URL,
      mockCacheService,
      {
        enableCaching: true,
        cacheTtl: 300,
        enableLogging: true,
      }
    );
  });

  describe("Constructor and Initialization", () => {
    it("should initialize with default configuration", () => {
      const defaultClient = new KeycloakAuthorizationServicesClient(
        mockClientFactory,
        MOCK_REALM_URL
      );
      expect(defaultClient).toBeInstanceOf(KeycloakAuthorizationServicesClient);
    });

    it("should merge custom configuration with defaults", () => {
      const customClient = new KeycloakAuthorizationServicesClient(
        mockClientFactory,
        MOCK_REALM_URL,
        mockCacheService,
        {
          enableCaching: false,
          cacheTtl: 600,
        }
      );
      expect(customClient).toBeInstanceOf(KeycloakAuthorizationServicesClient);
    });

    it("should initialize without cache service", () => {
      const noCacheClient = new KeycloakAuthorizationServicesClient(
        mockClientFactory,
        MOCK_REALM_URL,
        undefined,
        { enableCaching: false }
      );
      expect(noCacheClient).toBeInstanceOf(KeycloakAuthorizationServicesClient);
    });
  });

  describe("Authorization Checking", () => {
    const mockResource = "test-resource";
    const mockScopes = ["read", "write"];

    it("should grant access for valid authorization", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "upgraded-token",
          token_type: "Bearer",
          upgraded: true,
        }),
      });

      const decision = await client.checkAuthorization(
        MOCK_ACCESS_TOKEN,
        mockResource,
        mockScopes
      );

      expect(decision.granted).toBe(true);
      expect(decision.scopes).toEqual(mockScopes);
      expect(decision.context?.upgradeToken).toBe(true);
    });

    it("should deny access for unauthorized request", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({
          error: "access_denied",
          error_description: "Insufficient permissions",
        }),
      });

      const decision = await client.checkAuthorization(
        MOCK_ACCESS_TOKEN,
        mockResource,
        mockScopes
      );

      expect(decision.granted).toBe(false);
      expect(decision.reason).toBe("access_denied");
      expect(decision.context?.status).toBe(403);
    });

    it("should use cached authorization decisions", async () => {
      const cachedDecision: AuthorizationDecision = {
        granted: true,
        scopes: mockScopes,
      };

      mockCacheService.get.mockResolvedValueOnce({ data: cachedDecision });

      const decision = await client.checkAuthorization(
        MOCK_ACCESS_TOKEN,
        mockResource,
        mockScopes
      );

      expect(decision).toEqual(cachedDecision);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("should cache authorization decisions", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "upgraded-token",
          token_type: "Bearer",
        }),
      });

      await client.checkAuthorization(
        MOCK_ACCESS_TOKEN,
        mockResource,
        mockScopes
      );

      expect(mockCacheService.set).toHaveBeenCalledWith(
        expect.stringContaining("authz:"),
        expect.objectContaining({ granted: true }),
        300
      );
    });

    it("should handle authorization check errors gracefully", async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(
        new Error("Network error")
      );

      const decision = await client.checkAuthorization(
        MOCK_ACCESS_TOKEN,
        mockResource,
        mockScopes
      );

      expect(decision.granted).toBe(false);
      expect(decision.reason).toBe("authorization_check_error");
      expect(decision.context?.error).toContain("Network error");
    });

    it("should work without scopes", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "upgraded-token",
          token_type: "Bearer",
        }),
      });

      const decision = await client.checkAuthorization(
        MOCK_ACCESS_TOKEN,
        mockResource
      );

      expect(decision.granted).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining(`permission=${mockResource}`),
        })
      );
    });

    it("should include authorization context in requests", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "token" }),
      });

      const context = {
        userId: "test-user",
        clientId: "test-client",
        ipAddress: "127.0.0.1",
        timestamp: Date.now(),
      };

      await client.checkAuthorization(
        MOCK_ACCESS_TOKEN,
        mockResource,
        mockScopes,
        context
      );

      // Should complete without errors and include context in logging
      expect(global.fetch).toHaveBeenCalled();
    });
  });

  describe("Permission Ticket Management", () => {
    const mockPermissions: PermissionTicket[] = [
      { resource: "resource1", scope: "read" },
      { resource: "resource2", scope: "write" },
    ];

    it("should request permission ticket successfully", async () => {
      const mockTicket = "test-permission-ticket-12345";

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ticket: mockTicket }),
      });

      const ticket = await client.requestPermissionTicket(mockPermissions);

      expect(ticket).toBe(mockTicket);
      expect(global.fetch).toHaveBeenCalledWith(
        `${MOCK_REALM_URL}/authz/protection/permission`,
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: `Bearer ${MOCK_ADMIN_TOKEN}`,
            "Content-Type": "application/json",
          }),
          body: JSON.stringify(mockPermissions),
        })
      );
    });

    it("should handle permission ticket request failures", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: "invalid_request",
          error_description: "Invalid permission format",
        }),
      });

      await expect(
        client.requestPermissionTicket(mockPermissions)
      ).rejects.toThrow("Permission ticket request failed");
    });

    it("should handle permission ticket response without wrapper", async () => {
      const mockTicket = "direct-ticket-response";

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockTicket,
      });

      const ticket = await client.requestPermissionTicket(mockPermissions);

      expect(ticket).toBe(mockTicket);
    });
  });

  describe("Resource Management", () => {
    const mockResource: ResourceRepresentation = {
      name: "test-resource",
      displayName: "Test Resource",
      type: "document",
      uris: ["/api/documents/*"],
      scopes: ["read", "write", "delete"],
      attributes: {
        category: ["business"],
        sensitivity: ["high"],
      },
    };

    it("should register resource successfully", async () => {
      const registeredResource = { ...mockResource, id: "resource-123" };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => registeredResource,
      });

      const result = await client.registerResource(mockResource);

      expect(result).toEqual(registeredResource);
      expect(global.fetch).toHaveBeenCalledWith(
        `${MOCK_REALM_URL}/authz/admin/resources`,
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: `Bearer ${MOCK_ADMIN_TOKEN}`,
            "Content-Type": "application/json",
          }),
          body: JSON.stringify(mockResource),
        })
      );
    });

    it("should handle resource registration failures", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          error: "resource_exists",
          error_description: "Resource already exists",
        }),
      });

      await expect(client.registerResource(mockResource)).rejects.toThrow(
        "Resource registration failed"
      );
    });

    it("should fetch all resources", async () => {
      const mockResources = [
        { id: "1", name: "resource1" },
        { id: "2", name: "resource2" },
      ];

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResources,
      });

      const resources = await client.getResources();

      expect(resources).toEqual(mockResources);
      expect(global.fetch).toHaveBeenCalledWith(
        `${MOCK_REALM_URL}/authz/admin/resources`,
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: `Bearer ${MOCK_ADMIN_TOKEN}`,
          }),
        })
      );
    });

    it("should handle resource fetch failures", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 403,
      });

      await expect(client.getResources()).rejects.toThrow(
        "Failed to fetch resources"
      );
    });
  });

  describe("Policy Management", () => {
    const mockPolicy: PolicyRepresentation = {
      name: "test-role-policy",
      type: "role",
      logic: "POSITIVE",
      config: {
        roles: JSON.stringify([
          { id: "admin", required: false },
          { id: "user", required: false },
        ]),
      },
    };

    it("should create policy successfully", async () => {
      const createdPolicy = { ...mockPolicy, id: "policy-123" };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => createdPolicy,
      });

      const result = await client.createPolicy(mockPolicy);

      expect(result).toEqual(createdPolicy);
      expect(global.fetch).toHaveBeenCalledWith(
        `${MOCK_REALM_URL}/authz/admin/policies/${mockPolicy.type}`,
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: `Bearer ${MOCK_ADMIN_TOKEN}`,
            "Content-Type": "application/json",
          }),
          body: JSON.stringify(mockPolicy),
        })
      );
    });

    it("should handle policy creation failures", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: "invalid_policy",
          error_description: "Policy configuration is invalid",
        }),
      });

      await expect(client.createPolicy(mockPolicy)).rejects.toThrow(
        "Policy creation failed"
      );
    });
  });

  describe("Cache Management", () => {
    it("should clear authorization cache with pattern", async () => {
      const cleared = await client.clearAuthorizationCache("authz:user:*");

      expect(mockCacheService.invalidatePattern).toHaveBeenCalledWith(
        "authz:user:*"
      );
      expect(cleared).toBe(5);
    });

    it("should clear all authorization cache without pattern", async () => {
      const cleared = await client.clearAuthorizationCache();

      expect(mockCacheService.invalidatePattern).toHaveBeenCalledWith(
        "authz:*"
      );
      expect(cleared).toBe(5);
    });

    it("should return 0 when no cache service available", async () => {
      const noCacheClient = new KeycloakAuthorizationServicesClient(
        mockClientFactory,
        MOCK_REALM_URL
      );

      const cleared = await noCacheClient.clearAuthorizationCache();

      expect(cleared).toBe(0);
    });
  });

  describe("Token Management", () => {
    it("should cache admin tokens to avoid repeated requests", async () => {
      // Make multiple calls that require admin token
      await client.getResources();
      await client.getResources();

      // Should only call getClientCredentialsToken once (tokens are cached)
      expect(mockClientFactory.getClientCredentialsToken).toHaveBeenCalledTimes(
        1
      );
    });

    it("should refresh expired admin tokens", async () => {
      // First call
      await client.getResources();

      // Mock time passing (simulate token expiration)
      const originalNow = Date.now;
      Date.now = jest.fn(() => originalNow() + 4000000); // 1+ hours later

      // Second call should get new token
      await client.getResources();

      expect(mockClientFactory.getClientCredentialsToken).toHaveBeenCalledTimes(
        2
      );

      // Restore Date.now
      Date.now = originalNow;
    });
  });
});

describe("AuthorizationHelpers", () => {
  describe("Role Policy Creation", () => {
    it("should create positive role policy", () => {
      const policy = AuthorizationHelpers.createRolePolicy("admin-policy", [
        "admin",
        "super-admin",
      ]);

      expect(policy).toEqual({
        name: "admin-policy",
        type: "role",
        logic: "POSITIVE",
        config: {
          roles: JSON.stringify([
            { id: "admin", required: false },
            { id: "super-admin", required: false },
          ]),
        },
      });
    });

    it("should create negative role policy", () => {
      const policy = AuthorizationHelpers.createRolePolicy(
        "not-guest-policy",
        ["guest"],
        "NEGATIVE"
      );

      expect(policy.logic).toBe("NEGATIVE");
      expect(policy.name).toBe("not-guest-policy");
    });
  });

  describe("User Policy Creation", () => {
    it("should create user policy", () => {
      const policy = AuthorizationHelpers.createUserPolicy("specific-users", [
        "user1",
        "user2",
      ]);

      expect(policy).toEqual({
        name: "specific-users",
        type: "user",
        logic: "POSITIVE",
        config: {
          users: JSON.stringify(["user1", "user2"]),
        },
      });
    });
  });

  describe("Time Policy Creation", () => {
    it("should create time policy with date range", () => {
      const startDate = new Date("2024-01-01");
      const endDate = new Date("2024-12-31");

      const policy = AuthorizationHelpers.createTimePolicy(
        "year-2024",
        startDate,
        endDate
      );

      expect(policy).toEqual({
        name: "year-2024",
        type: "time",
        config: {
          nbf: startDate.toISOString(),
          naf: endDate.toISOString(),
        },
      });
    });

    it("should create time policy with time range", () => {
      const policy = AuthorizationHelpers.createTimePolicy(
        "business-hours",
        undefined,
        undefined,
        "09:00",
        "17:00"
      );

      expect(policy).toEqual({
        name: "business-hours",
        type: "time",
        config: {
          dayMonth: "09:00",
          dayMonthEnd: "17:00",
        },
      });
    });

    it("should create time policy with all parameters", () => {
      const startDate = new Date("2024-01-01");
      const endDate = new Date("2024-12-31");

      const policy = AuthorizationHelpers.createTimePolicy(
        "business-year",
        startDate,
        endDate,
        "09:00",
        "17:00"
      );

      expect(policy.config).toEqual({
        nbf: startDate.toISOString(),
        naf: endDate.toISOString(),
        dayMonth: "09:00",
        dayMonthEnd: "17:00",
      });
    });
  });

  describe("JavaScript Policy Creation", () => {
    it("should create JavaScript policy", () => {
      const jsCode = `
        var context = $evaluation.getContext();
        var user = context.getIdentity();
        if (user.getAttributes().containsValue('premium')) {
          $evaluation.grant();
        } else {
          $evaluation.deny();
        }
      `;

      const policy = AuthorizationHelpers.createJavaScriptPolicy(
        "premium-user-policy",
        jsCode
      );

      expect(policy).toEqual({
        name: "premium-user-policy",
        type: "js",
        config: {
          code: jsCode,
        },
      });
    });
  });
});
