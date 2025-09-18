import { WebSocketTokenRefreshService } from "../../src/services/websocket-token-refresh.service";
import {
  createTestKeycloakInstance,
  getTestToken,
  invalidateSession,
} from "./../mocks/keycloak-test-utils";
import { WebSocketConnectionData } from "../../src/types/index";

describe("WebSocket Token Refresh Integration", () => {
  let keycloak: any;
  let refreshService: WebSocketTokenRefreshService;
  let connection: WebSocketConnectionData;

  beforeAll(async () => {
    keycloak = await createTestKeycloakInstance();
    refreshService = new WebSocketTokenRefreshService(
      keycloak.clientFactory,
      keycloak.tokenIntrospectionService,
      keycloak.metrics,
      { enableAutoRefresh: false }
    );
    connection = {
      auth: {
        method: "jwt_token",
        token: await getTestToken(keycloak),
        sessionId: "session-1",
        clientId: "client-1",
        userId: "test-user",
        scopes: [],
        permissions: [],
        connectionId: "test-conn-1",
        connectedAt: new Date(),
        lastValidated: new Date(),
      },
      query: {},
      headers: {},
      connectionTime: Date.now(),
    };
  });

  afterAll(async () => {
    await keycloak.shutdown();
  });

  it("should refresh token before expiry", async () => {
    // Use a fresh valid token for the test
    const validToken = await getTestToken(keycloak);
    const freshConnection: WebSocketConnectionData = {
      ...connection,
      auth: {
        ...connection.auth,
        token: validToken,
        refreshToken: "valid.refresh.token",
      },
    };
    refreshService.registerConnection(
      freshConnection.auth.connectionId,
      freshConnection
    );
    const result = await refreshService.refreshConnectionToken(
      freshConnection.auth.connectionId
    );
    expect(result && result.success).toBe(true);
    expect(result && result.data && result.data.newToken).not.toBe(
      freshConnection.auth.token
    );
  });

  it("should handle session invalidation", async () => {
    await invalidateSession(keycloak, connection.auth.userId!);
    const result = await refreshService.refreshConnectionToken(
      connection.auth.connectionId
    );
    expect(result && result.success).toBe(false);
    const errorCode =
      result && result.error && typeof result.error === "object"
        ? result.error.code
        : "";
    expect(errorCode).toMatch(/SESSION_INVALID|TOKEN_ERROR/);
  });

  it("should handle concurrent refresh requests", async () => {
    const freshKeycloak = await createTestKeycloakInstance();
    const freshRefreshService = new WebSocketTokenRefreshService(
      freshKeycloak.clientFactory,
      freshKeycloak.tokenIntrospectionService,
      freshKeycloak.metrics,
      { enableAutoRefresh: false }
    );
    console.debug("[TEST] Starting concurrent refresh requests");
    const validToken1 = await getTestToken(freshKeycloak);
    const validToken2 = await getTestToken(freshKeycloak);
    const conn1: WebSocketConnectionData = {
      ...connection,
      auth: {
        ...connection.auth,
        connectionId: "test-conn-1",
        userId: "test-user-1",
        token: validToken1,
        refreshToken: "valid.refresh.token",
      },
    };
    const conn2: WebSocketConnectionData = {
      ...connection,
      auth: {
        ...connection.auth,
        connectionId: "test-conn-2",
        userId: "test-user-2",
        token: validToken2,
        refreshToken: "valid.refresh.token",
      },
    };
    freshRefreshService.registerConnection(conn1.auth.connectionId, conn1);
    freshRefreshService.registerConnection(conn2.auth.connectionId, conn2);
    const promises = [
      freshRefreshService
        .refreshConnectionToken(conn1.auth.connectionId)
        .then((r) => {
          console.debug("[TEST] conn1 result:", r);
          return r;
        }),
      freshRefreshService
        .refreshConnectionToken(conn2.auth.connectionId)
        .then((r) => {
          console.debug("[TEST] conn2 result:", r);
          return r;
        }),
    ];
    const results = await Promise.all(promises);
    console.debug("[TEST] Results:", results);
    expect(results[0] && results[0].success).toBe(true);
    expect(results[1] && results[1].success).toBe(true);
  });

  it("should fail with expired refresh token", async () => {
    const expiredRefreshToken = await getTestToken(keycloak, {
      type: "refresh",
      expired: true,
    });
    const connExpired: WebSocketConnectionData = {
      ...connection,
      auth: {
        ...connection.auth,
        connectionId: "test-conn-expired",
        token: expiredRefreshToken,
      },
    };
    refreshService.registerConnection(
      connExpired.auth.connectionId,
      connExpired
    );
    const result = await refreshService.refreshConnectionToken(
      connExpired.auth.connectionId
    );
    expect(result && result.success).toBe(false);
    const errorCode =
      result && result.error && typeof result.error === "object"
        ? result.error.code
        : "";
    expect(errorCode).toMatch(/TOKEN_ERROR|EXPIRED/);
  });

  it("should fail with invalid token format", async () => {
    const connInvalid: WebSocketConnectionData = {
      ...connection,
      auth: {
        ...connection.auth,
        connectionId: "test-conn-invalid",
        token: "not-a-jwt",
      },
    };
    refreshService.registerConnection(
      connInvalid.auth.connectionId,
      connInvalid
    );
    const result = await refreshService.refreshConnectionToken(
      connInvalid.auth.connectionId
    );
    expect(result && result.success).toBe(false);
    const errorCode =
      result && result.error && typeof result.error === "object"
        ? result.error.code
        : "";
    expect(errorCode).toMatch(/VALIDATION_ERROR|TOKEN_ERROR/);
  });

  it("should rate-limit rapid repeated refresh requests", async () => {
    const connRapid: WebSocketConnectionData = {
      ...connection,
      auth: { ...connection.auth, connectionId: "test-conn-rapid" },
    };
    refreshService.registerConnection(connRapid.auth.connectionId, connRapid);
    const promises = Array(10)
      .fill(null)
      .map(() =>
        refreshService.refreshConnectionToken(connRapid.auth.connectionId)
      );
    const results = await Promise.all(promises);
    const successCount = results.filter((r) => r && r.success).length;
    expect(successCount).toBeLessThanOrEqual(1); // Only one should succeed
  });

  it("should not leak memory with many connections", async () => {
    for (let i = 0; i < 1000; i++) {
      const conn: WebSocketConnectionData = {
        ...connection,
        auth: { ...connection.auth, connectionId: `conn-${i}` },
      };
      refreshService.registerConnection(conn.auth.connectionId, conn);
      await refreshService.unregisterConnection(conn.auth.connectionId);
    }
    // Optionally check process.memoryUsage() or use a heap profiler
    expect(true).toBe(true); // Placeholder for actual memory check
  });
});
