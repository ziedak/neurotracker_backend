/**
 * Jest Test Setup
 * Global test configuration and utilities for @libs/auth
 */

// Global type declarations
declare global {
  namespace NodeJS {
    interface Global {
      testUtils: {
        createMockUser: (overrides?: Partial<any>) => any;
        createMockAuthResult: (overrides?: Partial<any>) => any;
        createMockDeps: (overrides?: Partial<any>) => any;
        createMockAuthConfig: (overrides?: Partial<any>) => any;
      };
    }
  }
}

// Mock external dependencies
jest.mock("../../database/src", () => ({
  DatabaseService: jest.fn(),
}));
jest.mock("../../monitoring/src", () => ({
  MonitoringService: jest.fn(),
}));
jest.mock("../../utils/src", () => ({
  UtilsService: jest.fn(),
}));
jest.mock("../../config/src", () => ({
  ConfigService: jest.fn(),
}));

// Global test utilities
(global as any).testUtils = {
  // Create mock user for testing
  createMockUser: (overrides = {}) => ({
    id: "test-user-id",
    email: "test@example.com",
    name: "Test User",
    roles: ["user"],
    permissions: ["read:own-data"],
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }),

  // Create mock auth result
  createMockAuthResult: (overrides = {}) => ({
    success: true,
    user: (global as any).testUtils.createMockUser(),
    tokens: {
      accessToken: "mock-access-token",
      refreshToken: "mock-refresh-token",
      expiresIn: 3600,
      tokenType: "Bearer",
    },
    ...overrides,
  }),

  // Create mock service dependencies
  createMockDeps: (overrides = {}) => ({
    database: {
      getConnection: jest.fn(),
      query: jest.fn(),
      transaction: jest.fn(),
    },
    redis: {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      expire: jest.fn(),
      ping: jest.fn(),
    },
    monitoring: {
      logger: {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
      },
      metrics: {
        increment: jest.fn(),
        gauge: jest.fn(),
        histogram: jest.fn(),
      },
    },
    config: {},
    ...overrides,
  }),

  // Create mock auth config
  createMockAuthConfig: (overrides = {}) => ({
    jwt: {
      secret: "test-jwt-secret",
      expiresIn: "1h",
      refreshExpiresIn: "7d",
      issuer: "test",
      audience: "test",
    },
    keycloak: {
      serverUrl: "http://localhost:8080",
      realm: "test",
      clientId: "test",
      clientSecret: "test",
    },
    redis: {
      host: "localhost",
      port: 6379,
      db: 0,
    },
    session: {
      ttl: 3600,
      refreshThreshold: 300,
    },
    apiKey: {
      prefix: "ak_",
      length: 32,
    },
    ...overrides,
  }),
};

// Custom matchers
expect.extend({
  toBeValidAuthResult(received) {
    const pass =
      received &&
      typeof received === "object" &&
      "success" in received &&
      "user" in received &&
      "tokens" in received;

    return {
      message: () => `expected ${received} to be a valid auth result`,
      pass,
    };
  },

  toBeValidUser(received) {
    const pass =
      received &&
      typeof received === "object" &&
      "id" in received &&
      "email" in received &&
      "name" in received &&
      "roles" in received;

    return {
      message: () => `expected ${received} to be a valid user`,
      pass,
    };
  },
});

// Global test timeout
jest.setTimeout(10000);

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
});

export {};
