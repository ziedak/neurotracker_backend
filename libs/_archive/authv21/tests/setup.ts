/**
 * Jest test setup for AuthV2 library
 */

// Mock environment variables
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret";
process.env.KEYCLOAK_URL = "http://localhost:8080";
process.env.KEYCLOAK_REALM = "test-realm";
process.env.KEYCLOAK_CLIENT_ID = "test-client";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";

// Global test utilities
global.testConfig = {
  jwt: {
    secret: "test-jwt-secret",
    issuer: "test-issuer",
    audience: "test-audience",
    expiresIn: "1h",
    refreshExpiresIn: "24h",
    algorithm: "HS256",
  },
  keycloak: {
    url: "http://localhost:8080",
    realm: "test-realm",
    clientId: "test-client",
    clientSecret: "test-secret",
  },
  session: {
    secret: "test-session-secret",
    maxAge: 3600000,
    secure: false,
    httpOnly: true,
    sameSite: "lax" as const,
  },
  apiKey: {
    headerName: "X-API-Key",
    hashRounds: 10,
  },
  rateLimit: {
    windowMs: 900000,
    maxAttempts: 5,
    blockDuration: 900000,
  },
};

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
});

// Clean up after all tests
afterAll(async () => {
  // Add any cleanup logic here
});
