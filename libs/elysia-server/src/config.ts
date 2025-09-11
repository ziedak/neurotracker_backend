export interface ServerConfig {
  port: number;
  name: string;
  version: string;
  description?: string;
  cors?: {
    origin?: string | string[];
    credentials?: boolean;
    methods?: string[];
    allowedHeaders?: string[];
  };
  swagger?: {
    enabled?: boolean;
    path?: string;
    title?: string;
    version?: string;
    description?: string;
  };
  rateLimiting?: {
    enabled?: boolean;
    requests?: number;
    windowMs?: number;
    skipPaths?: string[];
  };
  logging?: {
    enabled?: boolean;
    level?: "debug" | "info" | "warn" | "error";
  };
  websocket?: {
    enabled?: boolean;
    path?: string;
    idleTimeout?: number;
    maxPayloadLength?: number;
    perMessageDeflate?: boolean;
    backpressureLimit?: number;
    closeOnBackpressureLimit?: boolean;
  };
  middleware?: {
    enabled?: boolean;
    auth?: {
      enabled?: boolean;
      requireAuth?: boolean;
      roles?: string[];
      permissions?: string[];
      allowAnonymous?: boolean;
      bypassRoutes?: string[];
      apiKeyAuth?: boolean;
      jwtAuth?: boolean;
      sessionAuth?: boolean;
    };
    rateLimit?: {
      enabled?: boolean;
      algorithm?: "sliding-window" | "token-bucket" | "fixed-window";
      maxRequests?: number;
      windowMs?: number;
      keyStrategy?: "ip" | "user" | "apiKey";
      standardHeaders?: boolean;
      skipSuccessfulRequests?: boolean;
      skipFailedRequests?: boolean;
    };
    security?: {
      enabled?: boolean;
      cors?: boolean;
      csp?: boolean;
      hsts?: boolean;
      xssFilter?: boolean;
      noSniff?: boolean;
      frameOptions?: string;
    };
    error?: {
      enabled?: boolean;
      includeStackTrace?: boolean;
      logErrors?: boolean;
      customErrorMessages?: Record<string, string>;
    };
    audit?: {
      enabled?: boolean;
      includeBody?: boolean;
      includeResponse?: boolean;
      storageStrategy?: "redis" | "clickhouse" | "both";
      maxBodySize?: number;
    };
    requestLogging?: {
      enabled?: boolean;
      logLevel?: "debug" | "info" | "warn" | "error";
      logRequestBody?: boolean;
      logResponseBody?: boolean;
      excludePaths?: string[];
    };
    prometheus?: {
      enabled?: boolean;
      endpoint?: string;
      defaultMetrics?: boolean;
      httpMetrics?: boolean;
    };
  };
}

export const DEFAULT_SERVER_CONFIG: Partial<ServerConfig> = {
  port: 3000,
  version: "1.0.0",
  cors: {
    origin: ["http://localhost:3000"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-ID"],
  },
  swagger: {
    enabled: true,
    path: "/swagger",
  },
  rateLimiting: {
    enabled: true,
    requests: 1000,
    windowMs: 60000,
    skipPaths: ["/swagger", "/swagger/", "/health", "/docs"],
  },
  logging: {
    enabled: true,
    level: "info",
  },
  websocket: {
    enabled: false,
    path: "/ws",
    idleTimeout: 120,
    maxPayloadLength: 16 * 1024 * 1024, // 16MB
    perMessageDeflate: false,
    backpressureLimit: 16 * 1024 * 1024, // 16MB
    closeOnBackpressureLimit: false,
  },
  middleware: {
    enabled: true,
    auth: {
      enabled: false,
      requireAuth: false,
      allowAnonymous: true,
      bypassRoutes: ["/health", "/metrics", "/docs", "/swagger"],
      apiKeyAuth: true,
      jwtAuth: true,
      sessionAuth: false,
    },
    rateLimit: {
      enabled: true,
      algorithm: "sliding-window",
      maxRequests: 1000,
      windowMs: 60000,
      keyStrategy: "ip",
      standardHeaders: true,
      skipSuccessfulRequests: false,
      skipFailedRequests: false,
    },
    security: {
      enabled: true,
      cors: true,
      csp: false,
      hsts: false,
      xssFilter: true,
      noSniff: true,
      frameOptions: "SAMEORIGIN",
    },
    error: {
      enabled: true,
      includeStackTrace: false,
      logErrors: true,
      customErrorMessages: {},
    },
    audit: {
      enabled: false,
      includeBody: false,
      includeResponse: false,
      storageStrategy: "redis",
      maxBodySize: 1024 * 5, // 5KB
    },
    requestLogging: {
      enabled: true,
      logLevel: "info",
      logRequestBody: false,
      logResponseBody: false,
      excludePaths: ["/health", "/metrics", "/favicon.ico"],
    },
    prometheus: {
      enabled: false,
      endpoint: "/metrics",
      defaultMetrics: true,
      httpMetrics: true,
    },
  },
};
