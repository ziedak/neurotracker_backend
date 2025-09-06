import { z } from "zod";
import { getBooleanEnv, getNumberEnv } from "@libs/config";

export interface ConnectionPoolStats {
  activeConnections: number;
  idleConnections: number;
  totalConnections: number;
  readonly maxConnections: number;
  readonly minConnections: number;
  connectionWaitQueue: number;
  avgConnectionTime: number;
  avgQueryTime: number;
  connectionErrors: number;
  poolUtilization: number;
  healthScore: number;
}

export interface ConnectionPoolConfig {
  readonly initialConnections: number;
  readonly maxConnections: number;
  readonly minConnections: number;
  readonly connectionTimeout: number;
  readonly idleTimeout: number;
  readonly maxIdleTime: number;
  readonly healthCheckInterval: number;
  readonly reconnectAttempts: number;
  readonly reconnectDelay: number;
  readonly enableCircuitBreaker: boolean;
  readonly circuitBreakerThreshold: number;
  readonly enableLoadBalancing: boolean;
}

export const DEFAULT_POOL_CONFIG: ConnectionPoolConfig = {
  initialConnections: getNumberEnv("INITIAL_CONNECTIONS") || 5,
  maxConnections: getNumberEnv("MAX_CONNECTIONS") || 20,
  minConnections: getNumberEnv("MIN_CONNECTIONS") || 2,
  connectionTimeout: getNumberEnv("CONNECTION_TIMEOUT") || 30000, // 30s
  idleTimeout: getNumberEnv("IDLE_TIMEOUT") || 300000, // 5min
  maxIdleTime: getNumberEnv("MAX_IDLE_TIME") || 600000, // 10min
  healthCheckInterval: getNumberEnv("HEALTH_CHECK_INTERVAL") || 30000, // 30s
  reconnectAttempts: getNumberEnv("RECONNECT_ATTEMPTS") || 3,
  reconnectDelay: getNumberEnv("RECONNECT_DELAY") || 5000, // 5s
  enableCircuitBreaker: getBooleanEnv("ENABLE_CIRCUIT_BREAKER") || true,
  circuitBreakerThreshold: getNumberEnv("CIRCUIT_BREAKER_THRESHOLD") || 0.8,
  enableLoadBalancing: getBooleanEnv("ENABLE_LOAD_BALANCING") || true,
};

export const ConnectionPoolConfigSchema = z.object({
  initialConnections: z.number().int().min(1),
  maxConnections: z.number().int().min(1),
  minConnections: z.number().int().min(0),
  connectionTimeout: z.number().int().min(1),
  idleTimeout: z.number().int().min(1),
  maxIdleTime: z.number().int().min(1),
  healthCheckInterval: z.number().int().min(1),
  reconnectAttempts: z.number().int().min(0),
  reconnectDelay: z.number().int().min(0),
  enableCircuitBreaker: z.boolean(),
  circuitBreakerThreshold: z.number().min(0).max(1),
  enableLoadBalancing: z.boolean(),
});
