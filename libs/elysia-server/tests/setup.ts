/**
 * Jest Setup File
 * Global test configuration and utilities
 */

// Required for tsyringe dependency injection
import "reflect-metadata";

// Mock @libs/monitoring module
jest.mock("@libs/monitoring", () => ({
  Logger: {
    getInstance: jest.fn(() => ({
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    })),
  },
  MetricsCollector: {
    getInstance: jest.fn(() => ({
      recordCounter: jest.fn(),
      recordTimer: jest.fn(),
      recordGauge: jest.fn(),
    })),
  },
}));

// Mock problematic ES modules
jest.mock("@elysiajs/swagger", () => ({
  swagger: jest.fn(() => ({})),
}));

jest.mock("elysia", () => ({
  Elysia: jest.fn().mockImplementation(() => ({
    use: jest.fn().mockReturnThis(),
    get: jest.fn().mockReturnThis(),
    post: jest.fn().mockReturnThis(),
    put: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    patch: jest.fn().mockReturnThis(),
    ws: jest.fn().mockReturnThis(),
    listen: jest.fn().mockReturnValue({
      stop: jest.fn(),
    }),
    onError: jest.fn().mockReturnThis(),
    onBeforeHandle: jest.fn().mockReturnThis(),
    onAfterHandle: jest.fn().mockReturnThis(),
    onRequest: jest.fn().mockReturnThis(),
    onResponse: jest.fn().mockReturnThis(),
    group: jest.fn().mockReturnThis(),
    guard: jest.fn().mockReturnThis(),
    derive: jest.fn().mockReturnThis(),
    state: jest.fn().mockReturnThis(),
    decorate: jest.fn().mockReturnThis(),
  })),
  t: {
    Object: jest.fn(() => ({})),
    String: jest.fn(() => ({})),
    Any: jest.fn(() => ({})),
    Optional: jest.fn(() => ({})),
    Number: jest.fn(() => ({})),
    Boolean: jest.fn(() => ({})),
    Array: jest.fn(() => ({})),
  },
}));

// Mock RateLimitWebSocketMiddleware to avoid CacheService initialization issues
jest.mock("../src/middleware/rateLimit/rateLimit.websocket.middleware", () => ({
  RateLimitWebSocketMiddleware: jest.fn().mockImplementation(() => ({
    middleware: jest.fn(() => jest.fn()),
    execute: jest.fn().mockResolvedValue(undefined),
    resetRateLimit: jest.fn().mockResolvedValue(undefined),
    getRateLimitStats: jest.fn().mockResolvedValue({ messageStats: {} }),
    getHealth: jest
      .fn()
      .mockResolvedValue({ messageRateLimiter: { healthy: true } }),
  })),
  createRateLimitWebSocketMiddleware: jest.fn(() => ({
    middleware: jest.fn(() => jest.fn()),
    execute: jest.fn().mockResolvedValue(undefined),
  })),
  WEBSOCKET_RATE_LIMIT_PRESETS: {
    general: jest.fn(() => ({})),
    strict: jest.fn(() => ({})),
    gaming: jest.fn(() => ({})),
    chat: jest.fn(() => ({})),
    development: jest.fn(() => ({})),
    production: jest.fn(() => ({})),
  },
}));

jest.mock("jose", () => ({
  SignJWT: jest.fn().mockReturnValue({
    setProtectedHeader: jest.fn().mockReturnThis(),
    setIssuedAt: jest.fn().mockReturnThis(),
    setExpirationTime: jest.fn().mockReturnThis(),
    sign: jest.fn().mockResolvedValue("mock.jwt.token"),
  }),
  jwtVerify: jest.fn().mockResolvedValue({
    payload: { userId: "test-user", sessionId: "test-session" },
  }),
  JWTPayload: {},
}));

// Mock timers for consistent testing
global.setImmediate = setImmediate;

// Global test timeout
jest.setTimeout(30000);

// Cleanup after each test
afterEach(() => {
  jest.clearAllMocks();
  jest.clearAllTimers();
});

// Global error handler for unhandled promises
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  // Don't exit in test environment
});
