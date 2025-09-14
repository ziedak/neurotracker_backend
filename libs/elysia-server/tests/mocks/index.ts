/**
 * @file mocks/index.ts
 * @description Centralized mocks for testing elysia-server components
 */

// Local type definitions for mocks (to avoid import issues in tests)
export interface ILogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, error?: Error, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
  child(context: Record<string, unknown>): ILogger;
  setLevel(level: string): void;
}

export interface IMetricsCollector {
  recordCounter(
    name: string,
    value?: number,
    labels?: Record<string, string>
  ): void;
  recordGauge(
    name: string,
    value: number,
    labels?: Record<string, string>
  ): void;
  recordTimer(
    name: string,
    value: number,
    labels?: Record<string, string>
  ): void;
  recordHistogram(
    name: string,
    value: number,
    labels?: Record<string, string>,
    buckets?: number[]
  ): void;
  increment(name: string, labels?: Record<string, string>): void;
  decrement(name: string, labels?: Record<string, string>): void;
  timing(name: string, value: number, labels?: Record<string, string>): void;
  gauge(name: string, value: number, labels?: Record<string, string>): void;
}

// Mock WebSocket interface
interface MockWebSocket {
  send: jest.MockedFunction<
    (data: string | ArrayBuffer | Blob | ArrayBufferView) => void
  >;
  close: jest.MockedFunction<(code?: number, reason?: string) => void>;
  on: jest.MockedFunction<
    (event: string, listener: (...args: unknown[]) => void) => void
  >;
  off: jest.MockedFunction<
    (event: string, listener: (...args: unknown[]) => void) => void
  >;
  readyState: number;
  url: string;
  protocol: string;
  extensions: string;
  binaryType: "blob" | "arraybuffer";
  bufferedAmount: number;
  CONNECTING: number;
  OPEN: number;
  CLOSING: number;
  CLOSED: number;
  addEventListener: jest.MockedFunction<
    (type: string, listener: EventListener) => void
  >;
  removeEventListener: jest.MockedFunction<
    (type: string, listener: EventListener) => void
  >;
  dispatchEvent: jest.MockedFunction<(event: Event) => boolean>;
}

// Mock Elysia context interface
interface MockElysiaContext {
  request: MockRequest;
  response: MockResponse;
  params: Record<string, string>;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
  set: {
    status: jest.MockedFunction<(status: number) => void>;
    headers: jest.MockedFunction<(headers: Record<string, string>) => void>;
    redirect: jest.MockedFunction<(url: string, status?: number) => void>;
  };
  get: jest.MockedFunction<(key: string) => string | undefined>;
  redirect: jest.MockedFunction<(url: string, status?: number) => void>;
  error: jest.MockedFunction<(status: number, message?: string) => void>;
  json: jest.MockedFunction<(data: unknown) => Response>;
  text: jest.MockedFunction<(text: string) => Response>;
  html: jest.MockedFunction<(html: string) => Response>;
  send: jest.MockedFunction<(data: unknown) => Response>;
  websocket: MockWebSocket;
  logger: ILogger;
  metrics: IMetricsCollector;
  cache: MockCacheService;
  db: MockDatabaseConnection;
  auth: MockAuthService;
  validation: MockValidationService;
  errorHandler: MockErrorHandler;
  healthChecker: MockHealthChecker;
  config: MockConfig;
  store: Record<string, unknown>;
}

// Mock scheduler interface (replacing TimerManager)
interface MockScheduler {
  setInterval: jest.MockedFunction<
    (key: string, ms: number, callback: () => void) => void
  >;
  setTimeout: jest.MockedFunction<
    (key: string, ms: number, callback: () => void) => void
  >;
  clear: jest.MockedFunction<(key: string) => void>;
  clearAll: jest.MockedFunction<() => void>;
}

// Mock object pool interface
interface MockObjectPool {
  acquire: jest.MockedFunction<() => unknown>;
  release: jest.MockedFunction<(obj: unknown) => void>;
  clear: jest.MockedFunction<() => void>;
  getStats: jest.MockedFunction<
    () => {
      poolSize: number;
      maxPoolSize: number;
      utilization: number;
      totalAcquires: number;
      totalReleases: number;
      totalCreations: number;
    }
  >;
  size: number;
  capacity: number;
}

// Mock LRU cache interface
interface MockLRUCache {
  set: jest.MockedFunction<(key: string, value: unknown) => void>;
  get: jest.MockedFunction<(key: string) => unknown>;
  has: jest.MockedFunction<(key: string) => boolean>;
  delete: jest.MockedFunction<(key: string) => boolean>;
  clear: jest.MockedFunction<() => void>;
  size: number;
  max: number;
  calculatedSize: number;
  entries: jest.MockedFunction<() => IterableIterator<[string, unknown]>>;
  values: jest.MockedFunction<() => IterableIterator<unknown>>;
}

// Mock EventEmitter interface
interface MockEventEmitter {
  emit: jest.MockedFunction<(event: string, ...args: unknown[]) => boolean>;
  on: jest.MockedFunction<
    (event: string, listener: (...args: unknown[]) => void) => MockEventEmitter
  >;
  off: jest.MockedFunction<
    (event: string, listener: (...args: unknown[]) => void) => MockEventEmitter
  >;
  once: jest.MockedFunction<
    (event: string, listener: (...args: unknown[]) => void) => MockEventEmitter
  >;
  removeAllListeners: jest.MockedFunction<(event?: string) => MockEventEmitter>;
  listeners: jest.MockedFunction<
    (event: string) => ((...args: unknown[]) => void)[]
  >;
  listenerCount: jest.MockedFunction<(event: string) => number>;
}

// Mock database connection interface
interface MockDatabaseConnection {
  query: jest.MockedFunction<
    (sql: string, params?: unknown[]) => Promise<unknown>
  >;
  connect: jest.MockedFunction<() => Promise<void>>;
  disconnect: jest.MockedFunction<() => Promise<void>>;
  isConnected: jest.MockedFunction<() => boolean>;
  healthCheck: jest.MockedFunction<() => Promise<{ status: string }>>;
}

// Mock CacheService interface
interface MockCacheService {
  get: jest.MockedFunction<(key: string) => Promise<unknown>>;
  set: jest.MockedFunction<
    (key: string, value: unknown, ttl?: number) => Promise<void>
  >;
  del: jest.MockedFunction<(key: string) => Promise<boolean>>;
  exists: jest.MockedFunction<(key: string) => Promise<boolean>>;
  expire: jest.MockedFunction<(key: string, ttl: number) => Promise<boolean>>;
  ttl: jest.MockedFunction<(key: string) => Promise<number>>;
  keys: jest.MockedFunction<(pattern: string) => Promise<string[]>>;
  flush: jest.MockedFunction<() => Promise<void>>;
  ping: jest.MockedFunction<() => Promise<string>>;
  connect: jest.MockedFunction<() => Promise<void>>;
  disconnect: jest.MockedFunction<() => Promise<void>>;
  isConnected: jest.MockedFunction<() => boolean>;
  getStats: jest.MockedFunction<
    () => Promise<{
      hits: number;
      misses: number;
      keys: number;
      memory: number;
    }>
  >;
}

// Mock circuit breaker interface
interface MockCircuitBreaker {
  execute: jest.MockedFunction<
    (fn: () => Promise<unknown>) => Promise<unknown>
  >;
  call: jest.MockedFunction<(fn: () => unknown) => unknown>;
  isOpen: jest.MockedFunction<() => boolean>;
  isClosed: jest.MockedFunction<() => boolean>;
  isHalfOpen: jest.MockedFunction<() => boolean>;
  getState: jest.MockedFunction<() => string>;
  getStats: jest.MockedFunction<
    () => {
      failures: number;
      successes: number;
      timeouts: number;
      state: string;
    }
  >;
}

// Mock rate limiter interface
interface MockRateLimiter {
  check: jest.MockedFunction<
    (key: string) => Promise<{ allowed: boolean; remaining: number }>
  >;
  reset: jest.MockedFunction<(key: string) => Promise<void>>;
  getRemaining: jest.MockedFunction<(key: string) => Promise<number>>;
  getResetTime: jest.MockedFunction<(key: string) => Promise<number>>;
}

// Mock authentication service interface
interface MockAuthService {
  validateToken: jest.MockedFunction<(token: string) => Promise<unknown>>;
  generateToken: jest.MockedFunction<(payload: unknown) => Promise<string>>;
  refreshToken: jest.MockedFunction<(token: string) => Promise<string>>;
  revokeToken: jest.MockedFunction<(token: string) => Promise<void>>;
  getUserFromToken: jest.MockedFunction<(token: string) => Promise<unknown>>;
  hasPermission: jest.MockedFunction<
    (user: unknown, permission: string) => Promise<boolean>
  >;
  getUserRoles: jest.MockedFunction<(user: unknown) => Promise<string[]>>;
}

// Mock validation service interface
interface MockValidationService {
  validate: jest.MockedFunction<
    (data: unknown, schema?: unknown) => Promise<boolean>
  >;
  sanitize: jest.MockedFunction<(data: unknown) => Promise<unknown>>;
  validateSchema: jest.MockedFunction<
    (data: unknown, schema: unknown) => Promise<boolean>
  >;
  validateInput: jest.MockedFunction<(input: unknown) => Promise<boolean>>;
  validateOutput: jest.MockedFunction<(output: unknown) => Promise<boolean>>;
}

// Mock error handler interface
interface MockErrorHandler {
  handle: jest.MockedFunction<
    (error: Error, context?: unknown) => Promise<void>
  >;
  log: jest.MockedFunction<(error: Error, context?: unknown) => void>;
  report: jest.MockedFunction<
    (error: Error, context?: unknown) => Promise<void>
  >;
  recover: jest.MockedFunction<(error: Error) => Promise<boolean>>;
}

// Mock health checker interface
interface MockHealthChecker {
  check: jest.MockedFunction<
    () => Promise<{
      status: string;
      timestamp: number;
      services: Record<string, string>;
    }>
  >;
  getStatus: jest.MockedFunction<() => string>;
  getDetails: jest.MockedFunction<() => Record<string, unknown>>;
}

// Mock configuration interface
interface MockConfig {
  port: number;
  host: string;
  cors: {
    enabled: boolean;
    origins: string[];
    methods: string[];
    headers: string[];
  };
  rateLimit: {
    enabled: boolean;
    windowMs: number;
    maxRequests: number;
  };
  auth: {
    enabled: boolean;
    jwtSecret: string;
    tokenExpiry: string;
  };
  websocket: {
    enabled: boolean;
    maxConnections: number;
    heartbeatInterval: number;
    connectionTimeout: number;
  };
  logging: {
    level: string;
    format: string;
  };
  metrics: {
    enabled: boolean;
    interval: number;
  };
}

// Utility function interfaces
interface MockRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  params: Record<string, string>;
  query: Record<string, string>;
}

interface MockResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  json: jest.MockedFunction<(data: unknown) => void>;
  text: jest.MockedFunction<(data: string) => void>;
  html: jest.MockedFunction<(data: string) => void>;
  redirect: jest.MockedFunction<(url: string, status?: number) => void>;
}

interface MockMiddlewareContext {
  request: MockRequest;
  response: MockResponse;
  logger: ILogger;
  config: MockConfig;
  store: Record<string, unknown>;
}

interface MockWebSocketContext {
  ws: MockWebSocket;
  connectionId: string;
  message: { type: string; payload: unknown };
  metadata: {
    connectedAt: Date;
    lastActivity: Date;
    messageCount: number;
    clientIp: string;
    userAgent: string;
    headers: Record<string, string>;
    query: Record<string, string>;
  };
  authenticated: boolean;
  user: unknown;
}

// Mock WebSocket implementation
export const createMockWebSocket = (): MockWebSocket => ({
  send: jest.fn(),
  close: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
  readyState: 1,
  url: "ws://localhost:3000",
  protocol: "",
  extensions: "",
  binaryType: "blob",
  bufferedAmount: 0,
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  dispatchEvent: jest.fn(),
});

// Mock Elysia context
export const createMockElysiaContext = (): MockElysiaContext => ({
  request: createMockRequest(),
  response: createMockResponse(),
  params: {},
  query: {},
  headers: {},
  body: null,
  set: {
    status: jest.fn(),
    headers: jest.fn(),
    redirect: jest.fn(),
  },
  get: jest.fn(),
  redirect: jest.fn(),
  error: jest.fn(),
  json: jest.fn(),
  text: jest.fn(),
  html: jest.fn(),
  send: jest.fn(),
  websocket: createMockWebSocket(),
  logger: createMockLogger(),
  metrics: createMockMetricsCollector(),
  cache: createMockCacheService(),
  db: createMockDatabaseConnection(),
  auth: createMockAuthService(),
  validation: createMockValidationService(),
  errorHandler: createMockErrorHandler(),
  healthChecker: createMockHealthChecker(),
  config: createMockConfig(),
  store: {},
});

// Mock logger
export const createMockLogger = (): ILogger => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnValue(createMockLogger()),
  setLevel: jest.fn(),
});

// Mock scheduler (replacing timer manager)
export const createMockScheduler = (): MockScheduler => ({
  setInterval: jest.fn(),
  setTimeout: jest.fn(),
  clear: jest.fn(),
  clearAll: jest.fn(),
});

// Mock object pool
export const createMockObjectPool = (): MockObjectPool => ({
  acquire: jest.fn(),
  release: jest.fn(),
  clear: jest.fn(),
  getStats: jest.fn().mockReturnValue({
    poolSize: 0,
    maxPoolSize: 10,
    utilization: 0,
    totalAcquires: 0,
    totalReleases: 0,
    totalCreations: 0,
  }),
  size: 0,
  capacity: 10,
});

// Mock LRU cache
export const createMockLRUCache = (): MockLRUCache => ({
  set: jest.fn(),
  get: jest.fn(),
  has: jest.fn(),
  delete: jest.fn(),
  clear: jest.fn(),
  size: 0,
  max: 100,
  calculatedSize: 0,
  entries: jest.fn().mockReturnValue([]),
  values: jest.fn().mockReturnValue([]),
});

// Mock EventEmitter
export const createMockEventEmitter = (): MockEventEmitter => ({
  emit: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
  once: jest.fn(),
  removeAllListeners: jest.fn(),
  listeners: jest.fn().mockReturnValue([]),
  listenerCount: jest.fn().mockReturnValue(0),
});

// Mock database connection
export const createMockDatabaseConnection = (): MockDatabaseConnection => ({
  query: jest.fn(),
  connect: jest.fn(),
  disconnect: jest.fn(),
  isConnected: jest.fn().mockReturnValue(true),
  healthCheck: jest.fn().mockResolvedValue({ status: "healthy" }),
});

// Mock CacheService
export const createMockCacheService = (): MockCacheService => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  exists: jest.fn(),
  expire: jest.fn(),
  ttl: jest.fn(),
  keys: jest.fn(),
  flush: jest.fn(),
  ping: jest.fn().mockResolvedValue("PONG"),
  connect: jest.fn(),
  disconnect: jest.fn(),
  isConnected: jest.fn().mockReturnValue(true),
  getStats: jest.fn().mockReturnValue({
    hits: 0,
    misses: 0,
    keys: 0,
    memory: 0,
  }),
});

// Mock metrics collector
export const createMockMetricsCollector = (): IMetricsCollector => ({
  recordCounter: jest.fn(),
  recordGauge: jest.fn(),
  recordTimer: jest.fn(),
  recordHistogram: jest.fn(),
  increment: jest.fn(),
  decrement: jest.fn(),
  timing: jest.fn(),
  gauge: jest.fn(),
});

// Mock circuit breaker
export const createMockCircuitBreaker = (): MockCircuitBreaker => ({
  execute: jest.fn(),
  call: jest.fn(),
  isOpen: jest.fn().mockReturnValue(false),
  isClosed: jest.fn().mockReturnValue(true),
  isHalfOpen: jest.fn().mockReturnValue(false),
  getState: jest.fn().mockReturnValue("closed"),
  getStats: jest.fn().mockReturnValue({
    failures: 0,
    successes: 0,
    timeouts: 0,
    state: "closed",
  }),
});

// Mock rate limiter
export const createMockRateLimiter = (): MockRateLimiter => ({
  check: jest.fn().mockResolvedValue({ allowed: true, remaining: 99 }),
  reset: jest.fn(),
  getRemaining: jest.fn().mockReturnValue(100),
  getResetTime: jest.fn().mockReturnValue(Date.now() + 60000),
});

// Mock authentication service
export const createMockAuthService = (): MockAuthService => ({
  validateToken: jest.fn(),
  generateToken: jest.fn(),
  refreshToken: jest.fn(),
  revokeToken: jest.fn(),
  getUserFromToken: jest.fn(),
  hasPermission: jest.fn(),
  getUserRoles: jest.fn(),
});

// Mock validation service
export const createMockValidationService = (): MockValidationService => ({
  validate: jest.fn(),
  sanitize: jest.fn(),
  validateSchema: jest.fn(),
  validateInput: jest.fn(),
  validateOutput: jest.fn(),
});

// Mock error handler
export const createMockErrorHandler = (): MockErrorHandler => ({
  handle: jest.fn(),
  log: jest.fn(),
  report: jest.fn(),
  recover: jest.fn(),
});

// Mock health checker
export const createMockHealthChecker = (): MockHealthChecker => ({
  check: jest.fn().mockResolvedValue({
    status: "healthy",
    timestamp: Date.now(),
    services: {
      database: "healthy",
      redis: "healthy",
      websocket: "healthy",
    },
  }),
  getStatus: jest.fn().mockReturnValue("healthy"),
  getDetails: jest.fn().mockReturnValue({}),
});

// Mock configuration
export const createMockConfig = (): MockConfig => ({
  port: 3000,
  host: "localhost",
  cors: {
    enabled: true,
    origins: ["*"],
    methods: ["GET", "POST", "PUT", "DELETE"],
    headers: ["*"],
  },
  rateLimit: {
    enabled: true,
    windowMs: 60000,
    maxRequests: 100,
  },
  auth: {
    enabled: true,
    jwtSecret: "test-secret",
    tokenExpiry: "1h",
  },
  websocket: {
    enabled: true,
    maxConnections: 1000,
    heartbeatInterval: 30000,
    connectionTimeout: 60000,
  },
  logging: {
    level: "info",
    format: "json",
  },
  metrics: {
    enabled: true,
    interval: 30000,
  },
});

// Utility function to create mock request
export const createMockRequest = (
  overrides: Partial<MockRequest> = {}
): MockRequest => ({
  method: "GET",
  url: "http://localhost:3000/test",
  headers: { "content-type": "application/json" },
  body: { test: "data" },
  params: {},
  query: {},
  ...overrides,
});

// Utility function to create mock response
export const createMockResponse = (
  overrides: Partial<MockResponse> = {}
): MockResponse => ({
  status: 200,
  headers: {},
  body: null,
  json: jest.fn(),
  text: jest.fn(),
  html: jest.fn(),
  redirect: jest.fn(),
  ...overrides,
});

// Utility function to create mock middleware context
export const createMockMiddlewareContext = (
  overrides: Partial<MockMiddlewareContext> = {}
): MockMiddlewareContext => ({
  request: createMockRequest(),
  response: createMockResponse(),
  logger: createMockLogger(),
  config: createMockConfig(),
  store: {},
  ...overrides,
});

// Utility function to create mock WebSocket context
export const createMockWebSocketContext = (
  overrides: Partial<MockWebSocketContext> = {}
): MockWebSocketContext => ({
  ws: createMockWebSocket(),
  connectionId: "test-conn-123",
  message: { type: "test", payload: { data: "test" } },
  metadata: {
    connectedAt: new Date(),
    lastActivity: new Date(),
    messageCount: 1,
    clientIp: "192.168.1.1",
    userAgent: "test-agent",
    headers: { origin: "https://test.com" },
    query: {},
  },
  authenticated: false,
  user: null,
  ...overrides,
});

// Utility function to reset all mocks
export const resetAllMocks = (): void => {
  jest.clearAllMocks();
};

// Utility function to setup common mocks
export const setupCommonMocks = (): void => {
  // Mock console methods
  global.console = {
    ...global.console,
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  };

  // Mock process methods

  process.on = jest.fn();

  // Mock timers
  jest.useFakeTimers();
};
