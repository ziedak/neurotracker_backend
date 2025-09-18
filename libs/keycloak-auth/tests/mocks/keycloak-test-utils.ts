export async function createTestKeycloakInstance() {
  // Mock Keycloak client factory, token introspection, metrics
  const invalidatedUsers = new Set<string>();
  return {
    clientFactory: {
      exchangePKCECodeForToken: async () => ({
        access_token: "mock_access_token",
        token_type: "bearer",
        expires_in: 3600,
        refresh_token: "mock_refresh_token",
        scope: "openid",
      }),
      getClientCredentialsToken: async () => ({
        access_token: "mock-client-credentials-access-token",
        refresh_token: "mock-client-credentials-refresh-token",
        expires_in: 3600,
        scope: "openid profile email",
        token_type: "Bearer",
      }),
      logout: async () => "mock-logout-success",
      _refreshCount: 0,
      refreshToken: async function (_refreshToken: string) {
        this._refreshCount = (this._refreshCount || 0) + 1;
        const token = `valid.jwt.token.${this._refreshCount}`;
        console.debug("[MOCK refreshToken]", {
          refreshToken: _refreshToken,
          newToken: token,
        });
        return {
          access_token: token,
          refresh_token: "valid.refresh.token",
          expires_in: 3600,
          scope: "openid profile",
          token_type: "Bearer",
        };
      },
      getClient: (_clientId: string) => ({
        realm: "test-realm",
        serverUrl: "http://localhost:8080",
        clientId: _clientId,
        type: "frontend" as "frontend",
        scopes: ["openid"],
        flow: "websocket" as "websocket",
        clientSecret: "dummy",
        redirectUri: "http://localhost/callback",
      }),
      getDiscoveryDocument: async () => ({}),
      createAuthorizationUrl: async () => "",
      createPKCEAuthorizationUrl: async () => ({
        authorizationUrl: "",
        codeVerifier: "",
        codeChallenge: "",
      }),
      exchangeCodeForToken: async () => ({
        access_token: "mock_access_token",
        token_type: "bearer",
        expires_in: 3600,
        refresh_token: "mock_refresh_token",
        scope: "openid",
      }),
      exchangePKCEForToken: async () => ({}),
      exchangeClientCredentials: async () => ({}),
      getClientConfig: () => ({}),
      recordDatabaseOperation: async () => Promise.resolve(),
      recordAuthOperation: async () => Promise.resolve(),
      recordWebSocketActivity: async () => Promise.resolve(),
      recordNodeMetrics: async () => Promise.resolve(),
      measureEventLoopLag: async () => Promise.resolve(),
    },
    tokenIntrospectionService: {
      validateJWT: async (token: string) => {
        if (token === "expired.jwt.token") {
          return { valid: false, error: "TOKEN_ERROR", cached: false };
        }
        if (token === "not-a-jwt") {
          return { valid: false, error: "VALIDATION_ERROR", cached: false };
        }
        if (token === "jwt.missing.claims") {
          return { valid: false, error: "VALIDATION_ERROR", cached: false };
        }
        if (token === "jwt.no.permissions") {
          return { valid: false, error: "PERMISSION_ERROR", cached: false };
        }
        // Simulate session invalidation
        const claims = {
          iss: "http://localhost:8080/auth/realms/test-realm",
          sub: "test-user",
          aud: ["client-1"],
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
          azp: "client-1",
          scope: "openid",
        };
        if (invalidatedUsers.has(claims.sub)) {
          return { valid: false, error: "SESSION_INVALIDATED", cached: false };
        }
        return { valid: true, claims, cached: false };
      },
      introspect: async (_token: string, _clientConfig: any) => ({
        active: true,
        sub: "test-user",
        azp: "client-1",
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        iss: "http://localhost:8080/auth/realms/test-realm",
        aud: ["client-1"],
        scope: "openid",
      }),
      getPublicKey: async (_keyId: string, _realm: string) => "mock-public-key",
      refreshPublicKeys: async (_realm: string) => {},
    },
    metrics: {
      recordCounter: jest.fn(),
      recordTimer: jest.fn(),
      recordGauge: jest.fn(),
      recordHistogram: jest.fn(),
      recordSummary: jest.fn(),
      getMetrics: jest.fn(),
      recordApiRequest: jest.fn(),
      recordAuthEvent: jest.fn(),
      recordError: jest.fn(),
      recordCustom: jest.fn(),
      recordDatabaseOperation: jest.fn(),
      recordAuthOperation: jest.fn(),
      recordWebSocketActivity: jest.fn(),
      recordNodeMetrics: jest.fn(),
      measureEventLoopLag: jest.fn(),
    },
    shutdown: async () => {},
    simulateNetworkFailure: async () => {},
    restoreNetwork: async () => {},
    // Add session invalidation helper
    _invalidatedUsers: invalidatedUsers,
  };
}
export function getTestToken(_keycloak: any, opts: any = {}) {
  console.debug("[getTestToken]", { opts });
  if (opts.expired) return "expired.jwt.token";
  if (opts.missingClaims) return "jwt.missing.claims";
  if (opts.noPermissions) return "jwt.no.permissions";
  return "valid.jwt.token";
}

export function expireToken(_token: string) {
  console.debug("[expireToken]", { token: _token });
  // Simulate token expiry
}

export function invalidateSession(keycloak: any, userId: string) {
  console.debug("[invalidateSession]", { userId });
  // Simulate session invalidation
  keycloak._invalidatedUsers.add(userId);
}

export async function simulateGracePeriodExpiry(_connectionId: string) {
  // Simulate grace period expiry
}
