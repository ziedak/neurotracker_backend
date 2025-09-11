/**
 * @file mocks/index.ts
 * @description Centralized mocks for testing elysia-server components
 */

// Mock WebSocket implementation
export const createMockWebSocket = (): any => ({
  send: jest.fn(),
  close: jest.fn(),
  ping: jest.fn(),
  pong: jest.fn(),
  readyState: 1, // WebSocket.OPEN
  remoteAddress: "127.0.0.1",
  remotePort: 12345,
  protocol: "ws",
  url: "ws://localhost:3000",
  onopen: jest.fn(),
  onclose: jest.fn(),
  onmessage: jest.fn(),
  onerror: jest.fn(),
  data: {}, // Add data property for WebSocket context
});

// Mock Elysia context
export const createMockElysiaContext = (): any => ({
  request: {
    method: "GET",
    url: "http://localhost:3000/test",
    headers: new Headers({ "content-type": "application/json" }),
    json: jest.fn().mockResolvedValue({ test: "data" }),
    text: jest.fn().mockResolvedValue("test data"),
    formData: jest.fn().mockResolvedValue(new FormData()),
  },
  response: {
    status: 200,
    headers: new Headers(),
    json: jest.fn(),
    text: jest.fn(),
    html: jest.fn(),
    redirect: jest.fn(),
  },
  params: {},
  query: {},
  body: { test: "data" },
  set: {
    status: jest.fn(),
    headers: jest.fn(),
    redirect: jest.fn(),
  },
  store: {},
});

// Mock logger
export const createMockLogger = (): any => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  trace: jest.fn(),
  fatal: jest.fn(),
  child: jest.fn().mockReturnValue(createMockLogger()),
});

// Mock timer manager
export const createMockTimerManager = (): any => ({
  setTimeout: jest.fn().mockReturnValue({} as NodeJS.Timeout),
  clearTimeout: jest.fn(),
  setInterval: jest.fn().mockReturnValue({} as NodeJS.Timeout),
  clearInterval: jest.fn(),
  getActiveTimers: jest.fn().mockReturnValue([]),
  cleanup: jest.fn(),
});

// Mock scheduler
export const createMockScheduler = (): any => ({
  setTimeout: jest.fn(),
  setInterval: jest.fn(),
  clear: jest.fn(),
  clearAll: jest.fn(),
});

// Mock object pool
export const createMockObjectPool = (): any => ({
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
export const createMockLRUCache = (): any => ({
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
export const createMockEventEmitter = (): any => ({
  emit: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
  once: jest.fn(),
  removeAllListeners: jest.fn(),
  listeners: jest.fn().mockReturnValue([]),
  listenerCount: jest.fn().mockReturnValue(0),
});

// Mock database connection
export const createMockDatabaseConnection = (): any => ({
  query: jest.fn(),
  connect: jest.fn(),
  disconnect: jest.fn(),
  isConnected: jest.fn().mockReturnValue(true),
  healthCheck: jest.fn().mockResolvedValue({ status: "healthy" }),
});

// Mock CacheService
export const createMockCacheService = (): any => ({
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
export const createMockMetricsCollector = (): any => ({
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
export const createMockCircuitBreaker = (): any => ({
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
export const createMockRateLimiter = (): any => ({
  check: jest.fn().mockResolvedValue({ allowed: true, remaining: 99 }),
  reset: jest.fn(),
  getRemaining: jest.fn().mockReturnValue(100),
  getResetTime: jest.fn().mockReturnValue(Date.now() + 60000),
});

// Mock authentication service
export const createMockAuthService = (): any => ({
  validateToken: jest.fn(),
  generateToken: jest.fn(),
  refreshToken: jest.fn(),
  revokeToken: jest.fn(),
  getUserFromToken: jest.fn(),
  hasPermission: jest.fn(),
  getUserRoles: jest.fn(),
});

// Mock validation service
export const createMockValidationService = (): any => ({
  validate: jest.fn(),
  sanitize: jest.fn(),
  validateSchema: jest.fn(),
  validateInput: jest.fn(),
  validateOutput: jest.fn(),
});

// Mock error handler
export const createMockErrorHandler = (): any => ({
  handle: jest.fn(),
  log: jest.fn(),
  report: jest.fn(),
  recover: jest.fn(),
});

// Mock health checker
export const createMockHealthChecker = (): any => ({
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
export const createMockConfig = (): any => ({
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
export const createMockRequest = (overrides = {}): any => ({
  method: "GET",
  url: "http://localhost:3000/test",
  headers: { "content-type": "application/json" },
  body: { test: "data" },
  params: {},
  query: {},
  ...overrides,
});

// Utility function to create mock response
export const createMockResponse = (overrides = {}): any => ({
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
export const createMockMiddlewareContext = (overrides = {}): any => ({
  request: createMockRequest(),
  response: createMockResponse(),
  logger: createMockLogger(),
  config: createMockConfig(),
  store: {},
  ...overrides,
});

// Utility function to create mock WebSocket context
export const createMockWebSocketContext = (overrides = {}): any => ({
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
export const resetAllMocks = () => {
  jest.clearAllMocks();
};

// Utility function to setup common mocks
export const setupCommonMocks = () => {
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
  process.exit = jest.fn() as any;
  process.on = jest.fn();

  // Mock timers
  jest.useFakeTimers();
};
