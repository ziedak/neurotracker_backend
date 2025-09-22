/**
 * KeycloakIntegrationService unit tests
 * Covers all public methods with proper dependency mocks
 */
import { KeycloakIntegrationService } from "../../src/services/KeycloakIntegrationService";

jest.mock("../src/client/KeycloakClient");
jest.mock("../src/services/KeycloakUserManager");
jest.mock("../src/services/KeycloakSessionManager");
jest.mock("@libs/database");

const mockKeycloakClient = {
  initialize: jest.fn(async () => {}),
  authenticateWithPassword: jest.fn(async () => ({
    access_token: "access-token",
    refresh_token: "refresh-token",
    id_token: "id-token",
    expires_in: 3600,
    refresh_expires_in: 7200,
  })),
  authenticateWithCode: jest.fn(async () => ({
    access_token: "access-token",
    refresh_token: "refresh-token",
    id_token: "id-token",
    expires_in: 3600,
    refresh_expires_in: 7200,
  })),
  getUserInfo: jest.fn(async () => ({
    sub: "user1",
    email: "user@example.com",
    name: "Test User",
    preferred_username: "testuser",
  })),
  logout: jest.fn(async () => ({})),
  healthCheck: jest.fn(async () => true),
  getStats: jest.fn(() => ({})),
};

const mockUserManager = {
  createUser: jest.fn(async () => "user-id"),
  getUserById: jest.fn(async () => ({
    id: "user1",
    username: "testuser",
    email: "user@example.com",
    firstName: "Test",
    lastName: "User",
    enabled: true,
  })),
};

const mockSessionManager = {
  createSession: jest.fn(() => ({
    sessionId: "session-id",
    token: "encrypted-token",
    userId: "user1",
    expiresAt: new Date(Date.now() + 3600000),
  })),
  validateSession: jest.fn(() => ({
    valid: true,
    userId: "user1",
  })),
  getStats: jest.fn(() => ({
    totalSessions: 1,
    activeSessions: 1,
  })),
};

const mockDbClient = {
  executeRaw: jest.fn(async () => true),
};

const mockMetrics = {
  recordCounter: jest.fn(),
  recordTimer: jest.fn(),
};

describe("KeycloakIntegrationService", () => {
  let service: KeycloakIntegrationService;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Set up mock implementations
    const KeycloakClient =
      require("../src/client/KeycloakClient").KeycloakClient;
    KeycloakClient.mockImplementation(() => mockKeycloakClient);

    const KeycloakUserManager =
      require("../src/services/KeycloakUserManager").KeycloakUserManager;
    KeycloakUserManager.mockImplementation(() => mockUserManager);

    const KeycloakSessionManager =
      require("../src/services/KeycloakSessionManager").KeycloakSessionManager;
    KeycloakSessionManager.mockImplementation(() => mockSessionManager);

    const PostgreSQLClient = require("@libs/database").PostgreSQLClient;
    PostgreSQLClient.mockImplementation(() => mockDbClient);

    service = new KeycloakIntegrationService(
      {
        serverUrl: "http://localhost:8080",
        realm: "test-realm",
        clientId: "test-client",
        clientSecret: "test-secret",
      },
      mockDbClient as any,
      mockMetrics
    );
  });

  it("should initialize successfully", async () => {
    await service.initialize();
    expect(mockKeycloakClient.initialize).toHaveBeenCalled();
  });

  it("should authenticate with password", async () => {
    const result = await service.authenticateWithPassword("user", "pass", {
      ipAddress: "127.0.0.1",
      userAgent: "test-agent",
    });
    expect(result.success).toBe(true);
    expect(result.tokens).toBeDefined();
    expect(result.session).toBeDefined();
  });

  it("should authenticate with code", async () => {
    const result = await service.authenticateWithCode(
      "auth-code",
      "redirect-uri",
      {
        ipAddress: "127.0.0.1",
        userAgent: "test-agent",
      }
    );
    expect(result.success).toBe(true);
    expect(result.tokens).toBeDefined();
    expect(result.session).toBeDefined();
  });

  it("should validate session", async () => {
    const result = await service.validateSession("session-id", {
      ipAddress: "127.0.0.1",
      userAgent: "test-agent",
    });
    expect(result.valid).toBe(true);
    expect(result.session).toBeDefined();
  });

  it("should logout user", async () => {
    const result = await service.logout("session-id");
    expect(result.success).toBe(true);
    expect(result.loggedOut).toBe(true);
  });

  it("should create user", async () => {
    const result = await service.createUser({
      username: "testuser",
      email: "user@example.com",
      firstName: "Test",
      lastName: "User",
      enabled: true,
    });
    expect(result.success).toBe(true);
    expect(result.userId).toBe("user-id");
  });

  it("should get user", async () => {
    const result = await service.getUser("user-id");
    expect(result.success).toBe(true);
    expect(result.user).toBeDefined();
  });

  it("should return stats", () => {
    const stats = service.getStats();
    expect(stats).toHaveProperty("session");
    expect(stats).toHaveProperty("client");
  });

  it("should perform health check", async () => {
    const result = await service.healthCheck();
    expect(result).toHaveProperty("status");
    expect(result).toHaveProperty("details");
  });
});
