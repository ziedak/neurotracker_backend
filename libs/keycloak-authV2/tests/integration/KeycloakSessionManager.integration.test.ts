/**
 * KeycloakSessionManager Integration Tests
 *
 * Comprehensive integration tests for the Keycloak Session Manager
 * covering session lifecycle, token operations, security features,
 * and database/cache integration.
 */

import { KeycloakSessionManager } from "../../src/services/session/KeycloakSessionManager";
import { KeycloakClient } from "../../src/client/KeycloakClient";
import { PostgreSQLClient, CacheService } from "@libs/database";
import type { IMetricsCollector } from "@libs/monitoring";
import type { AuthV2Config } from "../../src/services/token/config";
import type {
  KeycloakSessionCreationOptions,
  KeycloakSessionData,
} from "../../src/services/KeycloakSessionManager";
import type {
  KeycloakTokenResponse,
  KeycloakUserInfo,
} from "../../src/client/KeycloakClient";

// Mock dependencies
const mockKeycloakClient = {
  validateToken: jest.fn(),
  refreshToken: jest.fn(),
  introspectToken: jest.fn(),
  getUserInfo: jest.fn(),
} as unknown as KeycloakClient;

const mockDbClient = {
  executeRaw: jest.fn(),
  cachedQuery: jest.fn(),
  query: jest.fn(),
} as unknown as PostgreSQLClient;

const mockMetrics: IMetricsCollector = {
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

const mockCacheService = {
  get: jest.fn(),
  set: jest.fn(),
  invalidate: jest.fn(),
  deletePattern: jest.fn(),
  invalidatePattern: jest.fn(),
} as unknown as CacheService;

// Mock CacheService.create
jest.mock("@libs/database", () => ({
  PostgreSQLClient: jest.fn(),
  CacheService: {
    create: jest.fn(() => mockCacheService),
  },
}));

const testConfig: AuthV2Config = {
  cache: {
    enabled: true,
    ttl: {
      jwt: 3600,
      apiKey: 3600,
      session: 3600,
      userInfo: 300,
    },
  },
  session: {
    maxConcurrentSessions: 3,
    enforceIpConsistency: true,
    enforceUserAgentConsistency: false,
    tokenEncryption: true,
  },
  security: {
    constantTimeComparison: true,
    apiKeyHashRounds: 12,
    sessionRotationInterval: 1800, // 30 minutes
  },
  jwt: {
    issuer: "http://localhost:8080/realms/test",
    audience: "test-client",
    jwksUrl: "http://localhost:8080/realms/test/protocol/openid_connect/certs",
  },
  encryption: {
    key: "test-encryption-key-32-characters!",
    keyDerivationIterations: 1000, // Lower for tests
  },
};

describe("KeycloakSessionManager Integration Tests", () => {
  let sessionManager: KeycloakSessionManager;
  let sampleUserInfo: KeycloakUserInfo;
  let sampleTokens: KeycloakTokenResponse;

  beforeAll(() => {
    // Setup test data
    sampleUserInfo = {
      sub: "user-123",
      id: "user-123", // Same as sub
      preferred_username: "testuser",
      username: "testuser", // Add username field
      email: "test@example.com",
      email_verified: true,
      name: "Test User",
      given_name: "Test",
      family_name: "User",
      realm_access: {
        roles: ["user"],
      },
      resource_access: {},
      roles: ["user"], // Add roles array
      permissions: ["read_profile"], // Add permissions array
    };

    sampleTokens = {
      access_token: "mock-access-token",
      refresh_token: "mock-refresh-token",
      id_token: "mock-id-token",
      expires_in: 3600,
      refresh_expires_in: 7200,
      token_type: "Bearer",
      scope: "openid profile email",
    };
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Initialize session manager
    sessionManager = new KeycloakSessionManager(
      mockKeycloakClient,
      testConfig,
      mockDbClient,
      mockMetrics
    );

    // Setup default mock responses
    (mockDbClient.executeRaw as jest.Mock).mockResolvedValue([]);
    (mockDbClient.cachedQuery as jest.Mock).mockResolvedValue([]);
    (mockCacheService.get as jest.Mock).mockResolvedValue({ data: null });
    (mockCacheService.set as jest.Mock).mockResolvedValue(undefined);
    (mockKeycloakClient.validateToken as jest.Mock).mockResolvedValue({
      success: true,
      user: sampleUserInfo,
    });
  });

  describe("Session Creation Integration", () => {
    it("should create session with full database and cache integration", async () => {
      const options: KeycloakSessionCreationOptions = {
        userId: "user-123",
        userInfo: sampleUserInfo,
        keycloakSessionId: "keycloak-session-123",
        tokens: sampleTokens,
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla/5.0 Test Browser",
        maxAge: 3600,
        metadata: { department: "engineering" },
      };

      const result = await sessionManager.createSession(options);

      // Verify session creation
      expect(result.sessionId).toBeDefined();
      expect(result.sessionData).toMatchObject({
        userId: "user-123",
        userInfo: sampleUserInfo,
        keycloakSessionId: "keycloak-session-123",
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla/5.0 Test Browser",
        isActive: true,
        metadata: { department: "engineering" },
      });

      // Verify database insertion
      expect(mockDbClient.executeRaw).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO user_sessions"),
        expect.arrayContaining([
          expect.any(String), // UUID
          "user-123",
          result.sessionId,
          "keycloak-session-123",
          expect.any(String), // Encrypted access token
          expect.any(String), // Encrypted refresh token
          expect.any(String), // Encrypted id token
          expect.any(Date), // Token expires at
          expect.any(Date), // Refresh expires at
          expect.any(String), // Fingerprint
          expect.any(Date), // Last accessed at
          expect.any(Date), // Created at
          expect.any(Date), // Updated at (same as created)
          expect.any(Date), // Expires at
          "192.168.1.1",
          "Mozilla/5.0 Test Browser",
          expect.stringContaining("department"), // Metadata JSON
          true, // is_active
        ])
      );

      // Verify cache storage
      expect(mockCacheService.set).toHaveBeenCalledWith(
        `keycloak_session:${result.sessionId}`,
        result.sessionData,
        expect.any(Number) // TTL
      );

      // Verify metrics
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "keycloak.session.created",
        1
      );
      expect(mockMetrics.recordTimer).toHaveBeenCalledWith(
        "keycloak.session.create_duration",
        expect.any(Number)
      );
    });

    it("should enforce concurrent session limits", async () => {
      const options: KeycloakSessionCreationOptions = {
        userId: "user-123",
        userInfo: sampleUserInfo,
        keycloakSessionId: "keycloak-session-123",
        tokens: sampleTokens,
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla/5.0 Test Browser",
        maxAge: 3600,
        metadata: {},
      };

      // Mock existing sessions (exceeding limit)
      const existingSessions = Array.from({ length: 4 }, (_, i) => ({
        id: `existing-session-${i}`,
        userId: "user-123",
        sessionId: `session-${i}`,
        createdAt: new Date(Date.now() - i * 60000), // Different creation times
        lastAccessedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla/5.0 Test Browser",
        metadata: "{}",
        isActive: true,
      }));

      (mockDbClient.cachedQuery as jest.Mock).mockResolvedValueOnce(
        existingSessions
      );

      await sessionManager.createSession(options);

      // Verify oldest session was destroyed
      expect(mockDbClient.executeRaw).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE user_sessions"),
        expect.arrayContaining([expect.stringContaining("user-123"), 3])
      );
    });

    it("should handle session creation errors gracefully", async () => {
      const options: KeycloakSessionCreationOptions = {
        userId: "user-123",
        userInfo: sampleUserInfo,
        keycloakSessionId: "keycloak-session-123",
        tokens: sampleTokens,
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla/5.0 Test Browser",
        maxAge: 3600,
        metadata: {},
      };

      // Mock database error during insertion
      (mockDbClient.executeRaw as jest.Mock)
        .mockResolvedValueOnce([]) // Concurrent session check succeeds
        .mockRejectedValueOnce(new Error("Database connection failed")); // Insertion fails

      await expect(sessionManager.createSession(options)).rejects.toThrow(
        "Failed to create session"
      );

      // Verify error metrics
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "keycloak.session.create_error",
        1
      );
    });
  });

  describe("Session Validation Integration", () => {
    it("should validate session from cache with token validation", async () => {
      const sessionData: KeycloakSessionData = {
        id: "test-session-123",
        userId: "user-123",
        userInfo: sampleUserInfo,
        keycloakSessionId: "keycloak-session-123",
        accessToken: "valid-access-token",
        refreshToken: "valid-refresh-token",
        idToken: "valid-id-token",
        tokenExpiresAt: new Date(Date.now() + 3600000),
        refreshExpiresAt: new Date(Date.now() + 7200000),
        createdAt: new Date(Date.now() - 1800000), // 30 minutes ago
        lastAccessedAt: new Date(Date.now() - 300000), // 5 minutes ago
        expiresAt: new Date(Date.now() + 3600000),
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla/5.0 Test Browser",
        isActive: true,
        metadata: { department: "engineering" },
        fingerprint: "test-fingerprint",
      };

      // Mock validation cache miss, session cache hit
      (mockCacheService.get as jest.Mock)
        .mockResolvedValueOnce({ data: null }) // validation cache miss
        .mockResolvedValueOnce({ data: sessionData }); // session cache hit

      // Mock successful token validation
      (mockKeycloakClient.validateToken as jest.Mock).mockResolvedValueOnce({
        success: true,
        user: sampleUserInfo,
      });

      const result = await sessionManager.validateSession("test-session-123", {
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla/5.0 Test Browser",
      });

      expect(result).toMatchObject({
        valid: true,
        session: sessionData,
        authResult: {
          success: true,
          user: sampleUserInfo,
        },
        requiresRotation: true, // Session is 30 minutes old, rotation interval is 30 min
        requiresTokenRefresh: false,
      });

      // Verify cache hit metrics
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "keycloak.session.validated",
        1
      );
    });

    it("should handle token refresh when access token is expired", async () => {
      const expiredSessionData: KeycloakSessionData = {
        id: "test-session-123",
        userId: "user-123",
        userInfo: sampleUserInfo,
        keycloakSessionId: "keycloak-session-123",
        accessToken: "expired-access-token",
        refreshToken: "valid-refresh-token",
        idToken: "valid-id-token",
        tokenExpiresAt: new Date(Date.now() - 600000), // Expired 10 minutes ago
        refreshExpiresAt: new Date(Date.now() + 3600000),
        createdAt: new Date(Date.now() - 1800000),
        lastAccessedAt: new Date(Date.now() - 300000),
        expiresAt: new Date(Date.now() + 3600000),
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla/5.0 Test Browser",
        isActive: true,
        metadata: {},
        fingerprint: "test-fingerprint",
      };

      // Mock cache miss, database hit
      (mockCacheService.get as jest.Mock)
        .mockResolvedValueOnce({ data: null }) // validation cache miss
        .mockResolvedValueOnce({ data: null }); // session cache miss

      (mockDbClient.cachedQuery as jest.Mock).mockResolvedValueOnce([
        {
          id: "db-id-123",
          user_id: expiredSessionData.userId,
          keycloak_session_id: expiredSessionData.keycloakSessionId,
          access_token: expiredSessionData.accessToken,
          refresh_token: expiredSessionData.refreshToken,
          id_token: expiredSessionData.idToken,
          token_expires_at: expiredSessionData.tokenExpiresAt,
          refresh_expires_at: expiredSessionData.refreshExpiresAt,
          created_at: expiredSessionData.createdAt,
          last_accessed_at: expiredSessionData.lastAccessedAt,
          expires_at: expiredSessionData.expiresAt,
          ip_address: expiredSessionData.ipAddress,
          user_agent: expiredSessionData.userAgent,
          is_active: expiredSessionData.isActive,
          metadata: JSON.stringify(expiredSessionData.metadata),
          fingerprint: expiredSessionData.fingerprint,
        },
      ]);

      // Mock failed token validation (expired)
      (mockKeycloakClient.validateToken as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: "Token expired",
      });

      // Mock successful token refresh
      const newTokens: KeycloakTokenResponse = {
        access_token: "new-access-token",
        refresh_token: "new-refresh-token",
        id_token: "new-id-token",
        expires_in: 3600,
        refresh_expires_in: 7200,
        token_type: "Bearer",
        scope: "openid profile email",
      };

      (mockKeycloakClient.refreshToken as jest.Mock).mockResolvedValueOnce(
        newTokens
      );

      // Mock successful validation of new token
      (mockKeycloakClient.validateToken as jest.Mock).mockResolvedValueOnce({
        success: true,
        user: sampleUserInfo,
        token: "new-access-token",
      });

      const result = await sessionManager.validateSession("test-session-123", {
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla/5.0 Test Browser",
      });

      expect(result.valid).toBe(true);
      expect(result.authResult?.success).toBe(true);

      // Verify token refresh was called
      expect(mockKeycloakClient.refreshToken).toHaveBeenCalledWith(
        expect.any(String) // decrypted refresh token
      );

      // Verify session was updated with new tokens
      expect(mockDbClient.executeRaw).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO user_sessions"),
        expect.arrayContaining([
          expect.any(String),
          "user-123",
          "test-session-123",
          "keycloak-session-123",
          expect.any(String), // Encrypted new access token
          expect.any(String), // Encrypted new refresh token
          expect.any(String), // Encrypted new id token
        ])
      );

      // Verify token refresh metrics
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "keycloak.session.token_refreshed",
        1
      );
    });

    it("should detect security violations and destroy session", async () => {
      const validSessionData: KeycloakSessionData = {
        id: "test-session-123",
        userId: "user-123",
        userInfo: sampleUserInfo,
        keycloakSessionId: "keycloak-session-123",
        accessToken: "valid-access-token",
        refreshToken: "valid-refresh-token",
        idToken: "valid-id-token",
        tokenExpiresAt: new Date(Date.now() + 3600000),
        refreshExpiresAt: new Date(Date.now() + 7200000),
        createdAt: new Date(Date.now() - 300000),
        lastAccessedAt: new Date(Date.now() - 60000),
        expiresAt: new Date(Date.now() + 3600000),
        ipAddress: "192.168.1.1", // Original IP
        userAgent: "Mozilla/5.0 Test Browser",
        isActive: true,
        metadata: {},
        fingerprint: "test-fingerprint",
      };

      (mockCacheService.get as jest.Mock).mockResolvedValueOnce({
        data: null,
      });

      (mockDbClient.cachedQuery as jest.Mock).mockResolvedValueOnce([
        {
          id: "db-id-123",
          user_id: validSessionData.userId,
          session_id: validSessionData.id,
          keycloak_session_id: validSessionData.keycloakSessionId,
          access_token: "encrypted-token",
          refreshToken: "encrypted-refresh-token",
          idToken: "encrypted-id-token",
          tokenExpiresAt: new Date(Date.now() + 3600000),
          refreshExpiresAt: new Date(Date.now() + 7200000),
          fingerprint: "test-fingerprint",
          lastAccessedAt: new Date(Date.now() - 60000),
          createdAt: new Date(Date.now() - 300000),
          expiresAt: new Date(Date.now() + 3600000),
          ipAddress: "192.168.1.1",
          userAgent: "Mozilla/5.0 Test Browser",
          metadata: JSON.stringify({}),
          isActive: true,
        },
      ]);

      // Validate with different IP (security violation)
      const result = await sessionManager.validateSession("test-session-123", {
        ipAddress: "10.0.0.1", // Different IP
        userAgent: "Mozilla/5.0 Test Browser",
      });

      expect(result).toMatchObject({
        valid: false,
        error: "IP address mismatch",
      });

      // Verify session destruction was called
      expect(mockDbClient.executeRaw).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE user_sessions"),
        expect.arrayContaining(["test-session-123"])
      );
    });

    it("should handle expired sessions and clean them up", async () => {
      const expiredSessionData = {
        id: "db-id-123",
        userId: "user-123",
        sessionId: "expired-session-123",
        keycloakSessionId: "keycloak-session-123",
        accessToken: "encrypted-token",
        refreshToken: "encrypted-refresh-token",
        idToken: "encrypted-id-token",
        tokenExpiresAt: new Date(Date.now() + 3600000),
        refreshExpiresAt: new Date(Date.now() + 7200000),
        fingerprint: "test-fingerprint",
        lastAccessedAt: new Date(Date.now() - 300000),
        createdAt: new Date(Date.now() - 7200000),
        expiresAt: new Date(Date.now() - 600000), // Expired 10 minutes ago
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla/5.0 Test Browser",
        metadata: JSON.stringify({}),
        isActive: true,
      };

      (mockCacheService.get as jest.Mock).mockResolvedValueOnce({
        data: null,
      });

      (mockDbClient.cachedQuery as jest.Mock).mockResolvedValueOnce([
        expiredSessionData,
      ]);

      const result = await sessionManager.validateSession(
        "expired-session-123",
        {
          ipAddress: "192.168.1.1",
          userAgent: "Mozilla/5.0 Test Browser",
        }
      );

      expect(result).toMatchObject({
        valid: false,
        error: "Session expired",
      });

      // Verify expired session was destroyed
      expect(mockDbClient.executeRaw).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE user_sessions"),
        expect.arrayContaining(["expired-session-123"])
      );
    });
  });

  describe("Session Rotation Integration", () => {
    it("should rotate session with database and cache updates", async () => {
      const originalSessionData: KeycloakSessionData = {
        id: "original-session-123",
        userId: "user-123",
        userInfo: sampleUserInfo,
        keycloakSessionId: "keycloak-session-123",
        accessToken: "valid-access-token",
        refreshToken: "valid-refresh-token",
        idToken: "valid-id-token",
        tokenExpiresAt: new Date(Date.now() + 3600000),
        refreshExpiresAt: new Date(Date.now() + 7200000),
        createdAt: new Date(Date.now() - 1800000),
        lastAccessedAt: new Date(Date.now() - 300000),
        expiresAt: new Date(Date.now() + 3600000),
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla/5.0 Test Browser",
        isActive: true,
        metadata: { department: "engineering" },
        fingerprint: "original-fingerprint",
      };

      // Mock database query for session retrieval
      (mockDbClient.cachedQuery as jest.Mock).mockResolvedValueOnce([
        {
          id: "db-id-123",
          userId: "user-123",
          sessionId: "original-session-123",
          keycloakSessionId: "keycloak-session-123",
          accessToken: "encrypted-access-token",
          refreshToken: "encrypted-refresh-token",
          idToken: "encrypted-id-token",
          tokenExpiresAt: originalSessionData.tokenExpiresAt,
          refreshExpiresAt: originalSessionData.refreshExpiresAt,
          fingerprint: "original-fingerprint",
          lastAccessedAt: originalSessionData.lastAccessedAt,
          createdAt: originalSessionData.createdAt,
          expiresAt: originalSessionData.expiresAt,
          ipAddress: "192.168.1.1",
          userAgent: "Mozilla/5.0 Test Browser",
          metadata: JSON.stringify({
            department: "engineering",
            userInfo: sampleUserInfo,
          }),
          isActive: true,
        },
      ]);

      const result = await sessionManager.rotateSession(
        "original-session-123",
        {
          ipAddress: "192.168.1.2", // Slightly different IP
          userAgent: "Mozilla/5.0 Test Browser Updated",
        }
      );

      expect(result.sessionId).toBeDefined();
      expect(result.sessionId).not.toBe("original-session-123");
      expect(result.sessionData).toMatchObject({
        userId: "user-123",
        userInfo: sampleUserInfo,
        keycloakSessionId: "keycloak-session-123",
        metadata: { department: "engineering" },
      });

      // Verify new session was created
      expect(mockDbClient.executeRaw).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO user_sessions"),
        expect.arrayContaining([
          expect.any(String), // New UUID
          "user-123",
          result.sessionId, // New session ID
          "keycloak-session-123",
        ])
      );

      // Verify old session was destroyed
      expect(mockDbClient.executeRaw).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE user_sessions"),
        expect.arrayContaining(["original-session-123"])
      );

      // Verify rotation metrics
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "keycloak.session.rotated",
        1
      );
    });

    it("should handle rotation errors gracefully", async () => {
      // Mock failed session retrieval
      (mockDbClient.cachedQuery as jest.Mock).mockResolvedValueOnce([]);

      await expect(
        sessionManager.rotateSession("nonexistent-session", {
          ipAddress: "192.168.1.1",
          userAgent: "Mozilla/5.0 Test Browser",
        })
      ).rejects.toThrow("Session not found");

      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "keycloak.session.rotation_error",
        1
      );
    });
  });

  describe("Session Cleanup and Management Integration", () => {
    it("should retrieve all user sessions from database", async () => {
      const userSessions = [
        {
          id: "db-id-1",
          userId: "user-123",
          sessionId: "session-1",
          keycloakSessionId: "keycloak-session-1",
          accessToken: "encrypted-token-1",
          refreshToken: "encrypted-refresh-1",
          idToken: "encrypted-id-1",
          tokenExpiresAt: new Date(Date.now() + 3600000),
          refreshExpiresAt: new Date(Date.now() + 7200000),
          fingerprint: "fingerprint-1",
          lastAccessedAt: new Date(Date.now() - 300000),
          createdAt: new Date(Date.now() - 1800000),
          expiresAt: new Date(Date.now() + 3600000),
          ipAddress: "192.168.1.1",
          userAgent: "Mozilla/5.0 Browser 1",
          metadata: JSON.stringify({ device: "laptop" }),
        },
        {
          id: "db-id-2",
          userId: "user-123",
          sessionId: "session-2",
          keycloakSessionId: "keycloak-session-2",
          accessToken: "encrypted-token-2",
          refreshToken: "encrypted-refresh-2",
          idToken: "encrypted-id-2",
          tokenExpiresAt: new Date(Date.now() + 3600000),
          refreshExpiresAt: new Date(Date.now() + 7200000),
          fingerprint: "fingerprint-2",
          lastAccessedAt: new Date(Date.now() - 600000),
          createdAt: new Date(Date.now() - 3600000),
          expiresAt: new Date(Date.now() + 3600000),
          ipAddress: "192.168.1.2",
          userAgent: "Mozilla/5.0 Browser 2",
          metadata: JSON.stringify({ device: "mobile" }),
        },
      ];

      (mockDbClient.cachedQuery as jest.Mock).mockResolvedValueOnce(
        userSessions
      );

      const result = await sessionManager.getUserSessions("user-123");

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: "session-1",
        userId: "user-123",
        keycloakSessionId: "keycloak-session-1",
        isActive: true,
        metadata: { device: "laptop" },
      });

      expect(result[1]).toMatchObject({
        id: "session-2",
        userId: "user-123",
        keycloakSessionId: "keycloak-session-2",
        isActive: true,
        metadata: { device: "mobile" },
      });

      // Verify database query
      expect(mockDbClient.cachedQuery).toHaveBeenCalledWith(
        expect.stringContaining("FROM user_sessions"),
        ["user-123"],
        300
      );

      // Verify metrics
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "keycloak.session_manager.get_user_sessions",
        1
      );
    });

    it("should destroy all user sessions", async () => {
      const userSessions = [
        {
          id: "session-1",
          userId: "user-123",
          sessionId: "session-1",
          // ... other session data
        },
        {
          id: "session-2",
          userId: "user-123",
          sessionId: "session-2",
          // ... other session data
        },
      ];

      // Mock getUserSessions first
      (mockDbClient.cachedQuery as jest.Mock).mockResolvedValueOnce(
        userSessions.map((s) => ({
          ...s,
          keycloakSessionId: `keycloak-${s.id}`,
          accessToken: "encrypted-token",
          refreshToken: "encrypted-refresh",
          idToken: "encrypted-id",
          tokenExpiresAt: new Date(Date.now() + 3600000),
          refreshExpiresAt: new Date(Date.now() + 7200000),
          fingerprint: "fingerprint",
          lastAccessedAt: new Date(),
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 3600000),
          ipAddress: "192.168.1.1",
          userAgent: "Mozilla/5.0",
          metadata: JSON.stringify({}),
        }))
      );

      await sessionManager.destroyAllUserSessions("user-123");

      // Verify both sessions were destroyed
      expect(mockDbClient.executeRaw).toHaveBeenCalledTimes(2);
      expect(mockDbClient.executeRaw).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE user_sessions"),
        ["session-1"]
      );
      expect(mockDbClient.executeRaw).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE user_sessions"),
        ["session-2"]
      );

      // Verify metrics
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "keycloak.session.user_sessions_destroyed",
        1
      );
    });

    it("should cleanup expired sessions from database", async () => {
      const mockExpiredSessions = [
        { id: "expired-1" },
        { id: "expired-2" },
        { id: "expired-3" },
      ];

      (mockDbClient.executeRaw as jest.Mock).mockResolvedValueOnce(
        mockExpiredSessions
      );

      const cleanedCount = await sessionManager.cleanupExpiredSessions();

      expect(cleanedCount).toBe(3);

      // Verify cleanup query
      expect(mockDbClient.executeRaw).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE user_sessions SET is_active = false")
      );

      // Verify metrics
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "keycloak.session.cleanup",
        1
      );
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "keycloak.session.expired_cleaned",
        3
      );
    });
  });

  describe("Caching Integration", () => {
    it("should use cache for session validation when available", async () => {
      const cachedValidationResult = {
        valid: true,
        session: {
          id: "cached-session-123",
          userId: "user-123",
          isActive: true,
        } as KeycloakSessionData,
        requiresRotation: false,
        requiresTokenRefresh: false,
      };

      (mockCacheService.get as jest.Mock).mockResolvedValueOnce({
        data: cachedValidationResult,
      });

      const result = await sessionManager.validateSession(
        "cached-session-123",
        {
          ipAddress: "192.168.1.1",
          userAgent: "Mozilla/5.0 Test Browser",
        }
      );

      expect(result).toEqual(cachedValidationResult);

      // Verify cache hit metrics
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "keycloak.session.cache_hit",
        1
      );

      // Verify database was not queried
      expect(mockDbClient.cachedQuery).not.toHaveBeenCalled();
    });

    it("should cache validation results for future requests", async () => {
      const sessionData: KeycloakSessionData = {
        id: "test-session-123",
        userId: "user-123",
        userInfo: sampleUserInfo,
        keycloakSessionId: "keycloak-session-123",
        accessToken: "valid-access-token",
        refreshToken: "valid-refresh-token",
        idToken: "valid-id-token",
        tokenExpiresAt: new Date(Date.now() + 3600000),
        refreshExpiresAt: new Date(Date.now() + 7200000),
        createdAt: new Date(Date.now() - 300000),
        lastAccessedAt: new Date(Date.now() - 60000),
        expiresAt: new Date(Date.now() + 3600000),
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla/5.0 Test Browser",
        isActive: true,
        metadata: {},
        fingerprint: "test-fingerprint",
      };

      // Mock cache miss and database hit
      (mockCacheService.get as jest.Mock)
        .mockResolvedValueOnce({ data: null }) // validation cache miss
        .mockResolvedValueOnce({ data: null }); // session cache miss

      (mockDbClient.cachedQuery as jest.Mock).mockResolvedValueOnce([
        {
          id: "db-id-123",
          userId: "user-123",
          sessionId: "test-session-123",
          keycloakSessionId: "keycloak-session-123",
          accessToken: "encrypted-access-token",
          refreshToken: "encrypted-refresh-token",
          idToken: "encrypted-id-token",
          tokenExpiresAt: sessionData.tokenExpiresAt,
          refreshExpiresAt: sessionData.refreshExpiresAt,
          fingerprint: "test-fingerprint",
          lastAccessedAt: sessionData.lastAccessedAt,
          createdAt: sessionData.createdAt,
          expiresAt: sessionData.expiresAt,
          ipAddress: "192.168.1.1",
          userAgent: "Mozilla/5.0 Test Browser",
          metadata: JSON.stringify({}),
          isActive: true,
        },
      ]);

      await sessionManager.validateSession("test-session-123", {
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla/5.0 Test Browser",
      });

      // Verify validation result was cached
      expect(mockCacheService.set).toHaveBeenCalledWith(
        "keycloak_session_validation:test-session-123",
        expect.objectContaining({
          valid: true,
          session: expect.any(Object),
        }),
        300 // Default TTL
      );

      // Verify session data was cached
      expect(mockCacheService.set).toHaveBeenCalledWith(
        "keycloak_session:test-session-123",
        expect.any(Object),
        expect.any(Number)
      );
    });
  });

  describe("Error Handling and Edge Cases", () => {
    it("should handle database connection failures gracefully", async () => {
      const options: KeycloakSessionCreationOptions = {
        userId: "user-123",
        userInfo: sampleUserInfo,
        keycloakSessionId: "keycloak-session-123",
        tokens: sampleTokens,
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla/5.0 Test Browser",
        maxAge: 3600,
        metadata: {},
      };

      (mockDbClient.executeRaw as jest.Mock)
        .mockResolvedValueOnce([]) // Concurrent session check succeeds
        .mockRejectedValueOnce(new Error("Connection timeout")); // Insertion fails

      await expect(sessionManager.createSession(options)).rejects.toThrow(
        "Failed to create session"
      );

      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "keycloak.session.create_error",
        1
      );
    });

    it("should handle cache service failures gracefully", async () => {
      const sessionData: KeycloakSessionData = {
        id: "test-session-123",
        userId: "user-123",
        userInfo: sampleUserInfo,
        keycloakSessionId: "keycloak-session-123",
        accessToken: "valid-access-token",
        refreshToken: "valid-refresh-token",
        idToken: "valid-id-token",
        tokenExpiresAt: new Date(Date.now() + 3600000),
        refreshExpiresAt: new Date(Date.now() + 7200000),
        createdAt: new Date(Date.now() - 300000),
        lastAccessedAt: new Date(Date.now() - 60000),
        expiresAt: new Date(Date.now() + 3600000),
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla/5.0 Test Browser",
        isActive: true,
        metadata: {},
        fingerprint: "test-fingerprint",
      };

      // Mock cache failure
      (mockCacheService.get as jest.Mock).mockRejectedValueOnce(
        new Error("Redis connection failed")
      );

      // Mock successful token validation
      (mockKeycloakClient.validateToken as jest.Mock).mockResolvedValueOnce({
        success: true,
        user: sampleUserInfo,
      });

      // Mock successful database retrieval
      (mockDbClient.cachedQuery as jest.Mock).mockResolvedValueOnce([
        {
          id: "db-id-123",
          userId: "user-123",
          sessionId: "test-session-123",
          keycloakSessionId: "keycloak-session-123",
          accessToken: "encrypted-access-token",
          refreshToken: "encrypted-refresh-token",
          idToken: "encrypted-id-token",
          tokenExpiresAt: sessionData.tokenExpiresAt,
          refreshExpiresAt: sessionData.refreshExpiresAt,
          fingerprint: "test-fingerprint",
          lastAccessedAt: sessionData.lastAccessedAt,
          createdAt: sessionData.createdAt,
          expiresAt: sessionData.expiresAt,
          ipAddress: "192.168.1.1",
          userAgent: "Mozilla/5.0 Test Browser",
          metadata: JSON.stringify({}),
          isActive: true,
        },
      ]);

      // Should still work despite cache failure
      const result = await sessionManager.validateSession("test-session-123", {
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla/5.0 Test Browser",
      });

      expect(result.valid).toBe(true);
    });

    it("should handle token decryption failures", async () => {
      // Mock database with corrupted encrypted token
      (mockDbClient.cachedQuery as jest.Mock).mockResolvedValueOnce([
        {
          id: "db-id-123",
          userId: "user-123",
          sessionId: "test-session-123",
          keycloakSessionId: "keycloak-session-123",
          accessToken: "corrupted-encrypted-data",
          refreshToken: "corrupted-refresh-data",
          idToken: "corrupted-id-data",
          tokenExpiresAt: new Date(Date.now() + 3600000),
          refreshExpiresAt: new Date(Date.now() + 7200000),
          fingerprint: "test-fingerprint",
          lastAccessedAt: new Date(),
          createdAt: new Date(Date.now() - 300000),
          expiresAt: new Date(Date.now() + 3600000),
          ipAddress: "192.168.1.1",
          userAgent: "Mozilla/5.0 Test Browser",
          metadata: JSON.stringify({}),
          isActive: true,
        },
      ]);

      // Mock token validation to fail for corrupted tokens
      (mockKeycloakClient.validateToken as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: "Invalid token",
      });

      // Validation should handle decryption errors gracefully
      const result = await sessionManager.validateSession("test-session-123", {
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla/5.0 Test Browser",
      });

      expect(result).toMatchObject({
        valid: false,
        error: "Internal server error",
      });

      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "keycloak.session.validation_error",
        1
      );
    });
  });

  describe("Statistics and Monitoring", () => {
    it("should track session statistics correctly", async () => {
      const initialStats = sessionManager.getStats();

      expect(initialStats).toMatchObject({
        activeSessions: 0,
        totalSessions: 0,
        cacheEnabled: true,
        sessionsCreated: 0,
        sessionsDestroyed: 0,
        sessionRotations: 0,
      });

      // Create a session
      const options: KeycloakSessionCreationOptions = {
        userId: "user-123",
        userInfo: sampleUserInfo,
        keycloakSessionId: "keycloak-session-123",
        tokens: sampleTokens,
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla/5.0 Test Browser",
        maxAge: 3600,
        metadata: {},
      };

      await sessionManager.createSession(options);

      const statsAfterCreation = sessionManager.getStats();

      expect(statsAfterCreation.sessionsCreated).toBe(1);
      expect(statsAfterCreation.totalSessions).toBe(1);
      expect(statsAfterCreation.activeSessions).toBe(1);
    });

    it("should record comprehensive metrics throughout session lifecycle", async () => {
      const options: KeycloakSessionCreationOptions = {
        userId: "user-123",
        userInfo: sampleUserInfo,
        keycloakSessionId: "keycloak-session-123",
        tokens: sampleTokens,
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla/5.0 Test Browser",
        maxAge: 3600,
        metadata: {},
      };

      // Create session
      const { sessionId } = await sessionManager.createSession(options);

      // Validate session
      (mockDbClient.cachedQuery as jest.Mock).mockResolvedValueOnce([
        {
          id: "db-id-123",
          userId: "user-123",
          sessionId: sessionId,
          keycloakSessionId: "keycloak-session-123",
          accessToken: "encrypted-access-token",
          refreshToken: "encrypted-refresh-token",
          idToken: "encrypted-id-token",
          tokenExpiresAt: new Date(Date.now() + 3600000),
          refreshExpiresAt: new Date(Date.now() + 7200000),
          fingerprint: "test-fingerprint",
          lastAccessedAt: new Date(),
          createdAt: new Date(Date.now() - 300000),
          expiresAt: new Date(Date.now() + 3600000),
          ipAddress: "192.168.1.1",
          userAgent: "Mozilla/5.0 Test Browser",
          metadata: JSON.stringify({}),
          isActive: true,
        },
      ]);

      await sessionManager.validateSession(sessionId, {
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla/5.0 Test Browser",
      });

      // Destroy session
      await sessionManager.destroySession(sessionId, "logout");

      // Verify all metrics were recorded
      const expectedCounterMetrics = [
        "keycloak.session.created",
        "keycloak.session.validated",
        "keycloak.session.destroyed",
      ];

      const expectedTimerMetrics = [
        "keycloak.session.create_duration",
        "keycloak.session.validation_duration",
        "keycloak.session.destroy_duration",
      ];

      expectedCounterMetrics.forEach((metric) => {
        expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
          metric,
          expect.any(Number)
        );
      });

      expectedTimerMetrics.forEach((metric) => {
        expect(mockMetrics.recordTimer).toHaveBeenCalledWith(
          metric,
          expect.any(Number)
        );
      });
    });
  });
});
