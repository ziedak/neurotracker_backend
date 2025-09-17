/**
 * Token Refresh Manager Tests
 * Comprehensive tests for automatic token refresh capabilities
 */

import {
  TokenRefreshManager,
  createTokenRefreshManager,
  getTokenRefreshManager,
  type TokenRefreshEvent,
} from "../../src/services/token-refresh-manager";
import { KeycloakClientFactory } from "../../src/client/keycloak-client-factory";
import { TokenResponse, RawEnvironmentConfig } from "../../src/types";

// Mock environment config for testing
const mockEnvConfig: RawEnvironmentConfig = {
  KEYCLOAK_SERVER_URL: "https://keycloak.example.com",
  KEYCLOAK_REALM: "test-realm",
  KEYCLOAK_FRONTEND_CLIENT_ID: "frontend-client",
  KEYCLOAK_SERVICE_CLIENT_ID: "service-client",
  KEYCLOAK_SERVICE_CLIENT_SECRET: "service-secret",
  KEYCLOAK_TRACKER_CLIENT_ID: "tracker-client",
  KEYCLOAK_TRACKER_CLIENT_SECRET: "tracker-secret",
  KEYCLOAK_WEBSOCKET_CLIENT_ID: "websocket-client",
  REDIS_URL: "redis://localhost:6379",
  AUTH_CACHE_TTL: "3600",
  AUTH_INTROSPECTION_TTL: "300",
};

describe("TokenRefreshManager", () => {
  let clientFactory: KeycloakClientFactory;
  let refreshManager: TokenRefreshManager;
  let mockTokenResponse: TokenResponse;

  beforeEach(() => {
    // Reset timers and mocks
    jest.clearAllTimers();
    jest.useFakeTimers();

    clientFactory = new KeycloakClientFactory(mockEnvConfig);

    // Mock the client factory methods
    jest.spyOn(clientFactory, "getDiscoveryDocument").mockResolvedValue({
      token_endpoint: "https://keycloak.example.com/token",
    });

    mockTokenResponse = {
      access_token: "mock-access-token",
      token_type: "Bearer",
      expires_in: 3600, // 1 hour
      refresh_token: "mock-refresh-token",
      scope: "openid profile",
      refresh_expires_in: 86400, // 24 hours
    };

    refreshManager = new TokenRefreshManager(clientFactory, {
      refreshBufferSeconds: 300, // 5 minutes
      maxRetryAttempts: 2,
      retryBaseDelay: 100, // Faster for testing
      refreshCheckInterval: 1000, // 1 second for testing
    });
  });

  afterEach(() => {
    if (refreshManager) {
      refreshManager.dispose();
    }
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe("Token Management", () => {
    it("should add and manage tokens", () => {
      const sessionId = "test-session-1";

      const managedToken = refreshManager.addManagedToken(
        sessionId,
        mockTokenResponse,
        "frontend"
      );

      expect(managedToken.sessionId).toBe(sessionId);
      expect(managedToken.accessToken).toBe(mockTokenResponse.access_token);
      expect(managedToken.refreshToken).toBe(mockTokenResponse.refresh_token);
      expect(managedToken.clientType).toBe("frontend");
      expect(managedToken.expiresAt).toBeGreaterThan(Date.now());
    });

    it("should retrieve managed tokens", () => {
      const sessionId = "test-session-2";

      refreshManager.addManagedToken(sessionId, mockTokenResponse);
      const retrieved = refreshManager.getManagedToken(sessionId);

      expect(retrieved?.sessionId).toBe(sessionId);
      expect(retrieved?.accessToken).toBe(mockTokenResponse.access_token);
    });

    it("should remove managed tokens", () => {
      const sessionId = "test-session-3";

      refreshManager.addManagedToken(sessionId, mockTokenResponse);
      expect(refreshManager.getManagedToken(sessionId)).toBeDefined();

      refreshManager.removeManagedToken(sessionId);
      expect(refreshManager.getManagedToken(sessionId)).toBeUndefined();
    });

    it("should throw error for token without refresh token", () => {
      const tokenWithoutRefresh = { ...mockTokenResponse };
      delete tokenWithoutRefresh.refresh_token;

      expect(() => {
        refreshManager.addManagedToken("test-session", tokenWithoutRefresh);
      }).toThrow("Cannot manage token without refresh token");
    });
  });

  describe("Token Refresh Detection", () => {
    it("should detect when token needs refresh", () => {
      const sessionId = "refresh-test-1";
      const shortLivedToken = {
        ...mockTokenResponse,
        expires_in: 600, // 600 seconds (10 minutes) - longer than 5-minute buffer
      };

      refreshManager.addManagedToken(sessionId, shortLivedToken);

      // Should not need refresh initially
      expect(refreshManager.needsRefresh(sessionId)).toBe(false);

      // Fast forward to within refresh buffer (400 seconds remaining < 300 second buffer)
      jest.advanceTimersByTime(200 * 1000); // 200 seconds

      // Should need refresh now (within 5-minute buffer)
      expect(refreshManager.needsRefresh(sessionId)).toBe(true);
    });

    it("should detect expired refresh tokens", () => {
      const sessionId = "expire-test-1";
      const token = {
        ...mockTokenResponse,
        refresh_expires_in: 5, // 5 seconds
      };

      refreshManager.addManagedToken(sessionId, token);

      expect(refreshManager.isRefreshTokenExpired(sessionId)).toBe(false);

      // Fast forward past refresh token expiry
      jest.advanceTimersByTime(10 * 1000); // 10 seconds

      expect(refreshManager.isRefreshTokenExpired(sessionId)).toBe(true);
    });
  });

  describe("Automatic Token Refresh", () => {
    it("should automatically refresh tokens", async () => {
      const sessionId = "auto-refresh-1";
      const events: TokenRefreshEvent[] = [];

      // Mock successful refresh
      const newTokenResponse = {
        ...mockTokenResponse,
        access_token: "new-access-token",
        refresh_token: "new-refresh-token",
      };

      jest
        .spyOn(clientFactory, "refreshToken")
        .mockResolvedValue(newTokenResponse);

      // Add event listener
      refreshManager.onRefreshEvent((event) => events.push(event));

      // Add token that expires soon
      const shortLivedToken = {
        ...mockTokenResponse,
        expires_in: 100, // 100 seconds
      };

      refreshManager.addManagedToken(sessionId, shortLivedToken);

      // Fast forward to trigger refresh
      jest.advanceTimersByTime(95 * 1000); // 95 seconds

      // Allow async operations to complete
      await Promise.resolve();

      // Check that refresh was called
      expect(clientFactory.refreshToken).toHaveBeenCalledWith(
        shortLivedToken.refresh_token
      );

      // Check that token was updated
      const updatedToken = refreshManager.getManagedToken(sessionId);
      expect(updatedToken?.accessToken).toBe("new-access-token");

      // Check that success event was emitted
      expect(events.some((e) => e.type === "refresh_success")).toBe(true);
    });

    it("should handle refresh failures with retry", async () => {
      const sessionId = "retry-test-1";
      const events: TokenRefreshEvent[] = [];

      // Mock first call to fail, second to succeed
      const newTokenResponse = {
        ...mockTokenResponse,
        access_token: "retry-success-token",
      };

      jest
        .spyOn(clientFactory, "refreshToken")
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce(newTokenResponse);

      refreshManager.onRefreshEvent((event) => events.push(event));

      // Force refresh
      refreshManager.addManagedToken(sessionId, mockTokenResponse);
      await refreshManager.refreshManagedToken(sessionId);

      // Allow retries to complete
      await jest.advanceTimersByTimeAsync(1000);

      // Should have been called twice (initial + retry)
      expect(clientFactory.refreshToken).toHaveBeenCalledTimes(2);

      // Check events
      const failureEvents = events.filter((e) => e.type === "refresh_failed");
      const successEvents = events.filter((e) => e.type === "refresh_success");

      expect(failureEvents).toHaveLength(1);
      expect(successEvents).toHaveLength(1);
    });

    it("should remove token after max retry attempts", async () => {
      const sessionId = "max-retry-test";
      const events: TokenRefreshEvent[] = [];

      // Mock all refresh attempts to fail
      jest
        .spyOn(clientFactory, "refreshToken")
        .mockRejectedValue(new Error("Persistent failure"));

      refreshManager.onRefreshEvent((event) => events.push(event));

      refreshManager.addManagedToken(sessionId, mockTokenResponse);

      try {
        await refreshManager.refreshManagedToken(sessionId);
      } catch (error) {
        // Expected to fail after retries
      }

      // Allow all retries to complete
      await jest.advanceTimersByTimeAsync(5000);

      // Should have tried maxRetryAttempts times
      expect(clientFactory.refreshToken).toHaveBeenCalledTimes(2); // Initial + 1 retry

      // Token should be removed from management
      expect(refreshManager.getManagedToken(sessionId)).toBeUndefined();

      // Should have session_removed event
      expect(events.some((e) => e.type === "session_removed")).toBe(true);
    });
  });

  describe("WebSocket Integration", () => {
    it("should handle long-lived WebSocket token refresh", async () => {
      const sessionId = "websocket-session-1";

      // Mock a WebSocket token that needs periodic refresh
      const wsToken = {
        ...mockTokenResponse,
        expires_in: 1800, // 30 minutes
      };

      const managedToken = refreshManager.addManagedToken(
        sessionId,
        wsToken,
        "websocket"
      );

      expect(managedToken.clientType).toBe("websocket");

      // Verify it's managed correctly
      const retrieved = refreshManager.getManagedToken(sessionId);
      expect(retrieved?.clientType).toBe("websocket");
    });

    it("should provide refresh statistics", () => {
      // Add multiple tokens with different refresh needs
      const tokens = [
        { sessionId: "stats-1", expiresIn: 3600 }, // Not needing refresh
        { sessionId: "stats-2", expiresIn: 200 }, // Needs refresh
        { sessionId: "stats-3", expiresIn: 100 }, // Needs refresh
      ];

      tokens.forEach(({ sessionId, expiresIn }) => {
        refreshManager.addManagedToken(sessionId, {
          ...mockTokenResponse,
          expires_in: expiresIn,
        });
      });

      // Fast forward to make some need refresh
      jest.advanceTimersByTime(150 * 1000);

      const stats = refreshManager.getRefreshStats();
      expect(stats.totalManagedTokens).toBe(3);
      expect(stats.tokensNeedingRefresh).toBe(2);
    });
  });

  describe("Event System", () => {
    it("should emit events for refresh lifecycle", async () => {
      const events: TokenRefreshEvent[] = [];
      const sessionId = "event-test-1";

      // Add multiple event handlers
      const handler1 = jest.fn((event: TokenRefreshEvent) =>
        events.push(event)
      );
      const handler2 = jest.fn();

      refreshManager.onRefreshEvent(handler1);
      refreshManager.onRefreshEvent(handler2);

      // Mock successful refresh
      jest.spyOn(clientFactory, "refreshToken").mockResolvedValue({
        ...mockTokenResponse,
        access_token: "event-new-token",
      });

      // Add token and force refresh
      refreshManager.addManagedToken(sessionId, mockTokenResponse);
      await refreshManager.refreshManagedToken(sessionId);

      // Both handlers should have been called
      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();

      // Should have success event
      const successEvents = events.filter((e) => e.type === "refresh_success");
      expect(successEvents).toHaveLength(1);
      expect(successEvents[0]!.sessionId).toBe(sessionId);
    });

    it("should handle event handler removal", () => {
      const handler = jest.fn();

      refreshManager.onRefreshEvent(handler);
      refreshManager.removeRefreshEventHandler(handler);

      // Add and refresh token
      refreshManager.addManagedToken("test-session", mockTokenResponse);

      // Handler should not be called
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("Configuration", () => {
    it("should use default configuration", () => {
      const defaultManager = new TokenRefreshManager(clientFactory);

      // Should not throw and should work with defaults
      expect(() => {
        defaultManager.addManagedToken("default-test", mockTokenResponse);
      }).not.toThrow();

      defaultManager.dispose();
    });

    it("should use custom configuration", () => {
      const customConfig = {
        refreshBufferSeconds: 600, // 10 minutes
        maxRetryAttempts: 5,
      };

      const customManager = new TokenRefreshManager(
        clientFactory,
        customConfig
      );

      // Should work with custom config
      expect(() => {
        customManager.addManagedToken("custom-test", mockTokenResponse);
      }).not.toThrow();

      customManager.dispose();
    });
  });

  describe("Singleton Factory", () => {
    it("should create and return singleton instance", () => {
      const manager1 = createTokenRefreshManager(clientFactory);
      const manager2 = createTokenRefreshManager(clientFactory);
      const manager3 = getTokenRefreshManager();

      expect(manager1).toBe(manager2);
      expect(manager2).toBe(manager3);

      manager1.dispose();
    });
  });

  describe("Cleanup", () => {
    it("should clean up all resources on dispose", () => {
      const sessionId = "cleanup-test";

      refreshManager.addManagedToken(sessionId, mockTokenResponse);
      expect(refreshManager.getManagedSessions()).toHaveLength(1);

      refreshManager.dispose();

      expect(refreshManager.getManagedSessions()).toHaveLength(0);
      expect(refreshManager.getManagedToken(sessionId)).toBeUndefined();
    });
  });
});
