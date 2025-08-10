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
};
