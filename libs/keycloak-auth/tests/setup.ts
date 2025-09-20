/**
 * Jest Setup for Keycloak Auth Library Tests
 */

// Mock @libs/utils
const mockExecuteWithRetry = jest.fn();
jest.mock("@libs/utils", () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
  executeWithRetry: mockExecuteWithRetry,
  RetryOptions: {},
}));

// Mock @libs/database
jest.mock("@libs/database", () => ({
  CacheService: jest.fn().mockImplementation(() => ({
    get: jest.fn().mockResolvedValue({
      data: null,
      source: "miss",
      latency: 0,
      compressed: false,
    }),
    set: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn().mockResolvedValue(undefined),
    invalidatePattern: jest.fn().mockResolvedValue(0),
    getStats: jest.fn().mockReturnValue({
      Hits: 0,
      Misses: 0,
      totalRequests: 0,
      hitRate: 0,
      memoryUsage: 0,
      entryCount: 0,
      invalidations: 0,
      compressions: 0,
    }),
  })),
}));

// Mock jose library
jest.mock("jose", () => ({
  jwtVerify: jest.fn(),
  createRemoteJWKSet: jest.fn(),
}));

// Mock fetch globally
global.fetch = jest.fn();

// Test utilities
// Add testUtils to global object
(global as any).testUtils = {
  // ... existing code ...

  mockExecuteWithRetrySuccess: (_result: any) => {
    mockExecuteWithRetry.mockImplementation(async (operation, _onError) => {
      // Execute the actual operation to simulate real behavior
      return await operation();
    });
  },

  mockExecuteWithRetryFailure: (error: Error) => {
    mockExecuteWithRetry.mockRejectedValue(error);
  },

  mockExecuteWithRetryWithRetry: (_result: any, attempts: number = 2) => {
    let callCount = 0;
    mockExecuteWithRetry.mockImplementation(async (operation, onError) => {
      callCount++;
      if (callCount < attempts) {
        const error = new Error(`Attempt ${callCount} failed`);
        onError?.(error, callCount);
        throw error;
      }
      // On success, execute the actual operation
      return await operation();
    });
  },

  mockExecuteWithRetryCircuitBreaker: () => {
    mockExecuteWithRetry.mockRejectedValue(
      new Error("Circuit breaker is open")
    );
  },

  resetExecuteWithRetryMock: () => {
    mockExecuteWithRetry.mockReset();
    mockExecuteWithRetry.mockResolvedValue(undefined);
  },

  // ... existing code ...
  createMockTokenClaims: (overrides = {}) => ({
    iss: "https://keycloak.example.com/realms/test",
    sub: "user-123",
    aud: "test-client",
    exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    iat: Math.floor(Date.now() / 1000),
    azp: "test-client",
    scope: "openid profile email",
    realm_access: {
      roles: ["user"],
    },
    ...overrides,
  }),

  createMockKeycloakResponse: (active = true, claims = {}) => ({
    active,
    ...claims,
    client_id: "test-client",
    username: "testuser",
    exp: Math.floor(Date.now() / 1000) + 3600,
  }),

  createMockDiscoveryDocument: () => ({
    issuer: "https://keycloak.example.com/realms/test",
    authorization_endpoint:
      "https://keycloak.example.com/realms/test/protocol/openid-connect/auth",
    token_endpoint:
      "https://keycloak.example.com/realms/test/protocol/openid-connect/token",
    introspection_endpoint:
      "https://keycloak.example.com/realms/test/protocol/openid-connect/token/introspect",
    userinfo_endpoint:
      "https://keycloak.example.com/realms/test/protocol/openid-connect/userinfo",
    end_session_endpoint:
      "https://keycloak.example.com/realms/test/protocol/openid-connect/logout",
    jwks_uri:
      "https://keycloak.example.com/realms/test/protocol/openid-connect/certs",
  }),

  createMockCacheService: () => ({
    get: jest.fn().mockResolvedValue({
      data: null,
      source: "miss",
      latency: 0,
      compressed: false,
    }),
    set: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn().mockResolvedValue(undefined),
    invalidatePattern: jest.fn().mockResolvedValue(0),
    getStats: jest.fn().mockReturnValue({
      Hits: 0,
      Misses: 0,
      totalRequests: 0,
      hitRate: 0,
      memoryUsage: 0,
      entryCount: 0,
      invalidations: 0,
      compressions: 0,
    }),
  }),

  createMockTokenIntrospectionService: () => ({
    introspectToken: jest.fn().mockResolvedValue({
      valid: true,
      active: true,
      claims: {
        sub: "user-123",
        aud: "test-client",
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        scope: "openid profile",
        client_id: "test-client",
      },
    }),
    validateJWT: jest.fn().mockResolvedValue({
      valid: true,
      claims: {
        sub: "user-123",
        aud: "test-client",
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        scope: "openid profile",
      },
    }),
    getStats: jest.fn().mockReturnValue({
      totalValidations: 0,
      cacheHits: 0,
      cacheMisses: 0,
      errors: 0,
    }),
    cleanup: jest.fn().mockResolvedValue(0),
  }),

  createMockKeycloakClientFactory: () => ({
    getClient: jest.fn().mockReturnValue({
      issuer: "https://keycloak.example.com/realms/test",
      clientId: "test-client",
      clientSecret: "test-secret",
      scopes: ["openid", "profile"],
    }),
    getFrontendClient: jest.fn().mockReturnValue({
      issuer: "https://keycloak.example.com/realms/test",
      clientId: "frontend-client",
      scopes: ["openid", "profile"],
    }),
    getServiceClient: jest.fn().mockReturnValue({
      issuer: "https://keycloak.example.com/realms/test",
      clientId: "service-client",
      clientSecret: "service-secret",
      scopes: ["openid", "profile"],
    }),
    createAuthorizationUrl: jest.fn().mockResolvedValue("https://auth.url"),
    exchangeCodeForToken: jest.fn().mockResolvedValue({
      access_token: "access-token",
      token_type: "Bearer",
      expires_in: 3600,
    }),
    getClientCredentialsToken: jest.fn().mockResolvedValue({
      access_token: "service-token",
      token_type: "Bearer",
      expires_in: 3600,
    }),
    getDirectGrantToken: jest.fn().mockResolvedValue({
      access_token: "direct-token",
      token_type: "Bearer",
      expires_in: 3600,
    }),
    getDiscoveryDocument: jest.fn().mockResolvedValue({
      issuer: "https://keycloak.example.com/realms/test",
      token_endpoint:
        "https://keycloak.example.com/realms/test/protocol/openid-connect/token",
      introspection_endpoint:
        "https://keycloak.example.com/realms/test/protocol/openid-connect/token/introspect",
      jwks_uri:
        "https://keycloak.example.com/realms/test/protocol/openid-connect/certs",
    }),
  }),

  createMockKeycloakClientConfig: () => ({
    issuer: "https://keycloak.example.com/realms/test",
    clientId: "test-client",
    clientSecret: "test-secret",
    scopes: ["openid", "profile"],
    realm: "test",
  }),

  createMockIntrospectionResponse: (active = true) => ({
    active,
    sub: "user-123",
    client_id: "test-client",
    username: "testuser",
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    scope: "openid profile",
    token_type: "Bearer",
  }),

  createMockEnvironmentConfig: () => ({
    KEYCLOAK_SERVER_URL: "https://keycloak.example.com",
    KEYCLOAK_REALM: "test",
    KEYCLOAK_FRONTEND_CLIENT_ID: "frontend-client",
    KEYCLOAK_SERVICE_CLIENT_ID: "service-client",
    KEYCLOAK_SERVICE_CLIENT_SECRET: "service-secret",
    KEYCLOAK_TRACKER_CLIENT_ID: "tracker-client",
    KEYCLOAK_TRACKER_CLIENT_SECRET: "tracker-secret",
    KEYCLOAK_WEBSOCKET_CLIENT_ID: "websocket-client",
    REDIS_URL: "redis://localhost:6379",
    AUTH_CACHE_TTL: "3600",
    AUTH_INTROSPECTION_TTL: "300",
  }),

  // Authorization Services test utilities
  createMockJWT: (payload: any) => {
    const header = { alg: "HS256", typ: "JWT" };
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString(
      "base64"
    );
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
      "base64"
    );
    const signature = "mock-signature";

    return `${encodedHeader}.${encodedPayload}.${signature}`;
  },

  createMockResource: (overrides = {}) => ({
    name: "test-resource",
    displayName: "Test Resource",
    type: "document",
    uris: ["/api/documents/123"],
    scopes: ["read", "write", "delete"],
    attributes: { category: ["public"] },
    ...overrides,
  }),

  createMockPolicy: (overrides = {}) => ({
    name: "test-policy",
    description: "Test policy for documents",
    type: "role" as const,
    logic: "POSITIVE" as const,
    decisionStrategy: "UNANIMOUS" as const,
    config: {
      roles: '["user", "admin"]',
    },
    ...overrides,
  }),

  createMockRoleHierarchy: () => ({
    "super-admin": {
      inherits: ["admin"],
      permissions: ["*"],
      description: "Super administrator with all permissions",
    },
    admin: {
      inherits: ["manager"],
      permissions: ["user_management", "system_config", "audit_read"],
      description: "System administrator",
    },
    manager: {
      inherits: ["user"],
      permissions: ["team_management", "reports_read", "analytics_read"],
      description: "Team manager",
    },
    user: {
      inherits: [],
      permissions: ["profile_read", "profile_write", "documents_read"],
      description: "Regular user",
    },
  }),

  createMockPermissionScopes: () => [
    {
      name: "user_management",
      description: "Manage users and roles",
      category: "administration",
      resources: ["users", "roles"],
    },
    {
      name: "documents_read",
      description: "Read documents",
      category: "documents",
      resources: ["documents"],
    },
    {
      name: "profile_write",
      description: "Edit own profile",
      category: "profile",
      resources: ["profile"],
    },
  ],

  createMockAuthorizationServicesClient: () => ({
    checkAuthorization: jest.fn().mockResolvedValue({
      granted: true,
      scopes: ["read"],
    }),
    registerResource: jest.fn().mockResolvedValue({
      id: "resource-123",
      name: "test-resource",
    }),
    getResource: jest.fn().mockResolvedValue({
      id: "resource-123",
      name: "test-resource",
    }),
    listResources: jest.fn().mockResolvedValue([]),
    updateResource: jest.fn().mockResolvedValue({
      id: "resource-123",
      name: "updated-resource",
    }),
    deleteResource: jest.fn().mockResolvedValue(undefined),
    createPolicy: jest.fn().mockResolvedValue({
      id: "policy-123",
      name: "test-policy",
    }),
    getPolicy: jest.fn().mockResolvedValue({
      id: "policy-123",
      name: "test-policy",
    }),
    listPolicies: jest.fn().mockResolvedValue([]),
    updatePolicy: jest.fn().mockResolvedValue({
      id: "policy-123",
      name: "updated-policy",
    }),
    deletePolicy: jest.fn().mockResolvedValue(undefined),
    requestPermissionTicket: jest.fn().mockResolvedValue("ticket-123"),
  }),
};

// Reset mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
  (global.fetch as jest.Mock).mockReset();
});

// Console warnings for unhandled promises
process.on("unhandledRejection", (reason, promise) => {
  console.warn("Unhandled Rejection at:", promise, "reason:", reason);
});
