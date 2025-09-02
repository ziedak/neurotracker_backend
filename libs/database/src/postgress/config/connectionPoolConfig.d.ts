import { z } from "@libs/utils";
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
export declare const DEFAULT_POOL_CONFIG: ConnectionPoolConfig;
export declare const ConnectionPoolConfigSchema: z.ZodObject<{
    initialConnections: z.ZodNumber;
    maxConnections: z.ZodNumber;
    minConnections: z.ZodNumber;
    connectionTimeout: z.ZodNumber;
    idleTimeout: z.ZodNumber;
    maxIdleTime: z.ZodNumber;
    healthCheckInterval: z.ZodNumber;
    reconnectAttempts: z.ZodNumber;
    reconnectDelay: z.ZodNumber;
    enableCircuitBreaker: z.ZodBoolean;
    circuitBreakerThreshold: z.ZodNumber;
    enableLoadBalancing: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    enableCircuitBreaker: boolean;
    circuitBreakerThreshold: number;
    initialConnections: number;
    maxConnections: number;
    minConnections: number;
    connectionTimeout: number;
    idleTimeout: number;
    maxIdleTime: number;
    healthCheckInterval: number;
    reconnectAttempts: number;
    reconnectDelay: number;
    enableLoadBalancing: boolean;
}, {
    enableCircuitBreaker: boolean;
    circuitBreakerThreshold: number;
    initialConnections: number;
    maxConnections: number;
    minConnections: number;
    connectionTimeout: number;
    idleTimeout: number;
    maxIdleTime: number;
    healthCheckInterval: number;
    reconnectAttempts: number;
    reconnectDelay: number;
    enableLoadBalancing: boolean;
}>;
//# sourceMappingURL=connectionPoolConfig.d.ts.map