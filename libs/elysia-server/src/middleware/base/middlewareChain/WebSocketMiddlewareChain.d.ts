import { type IMetricsCollector } from "@libs/monitoring";
import { WebSocketContext, WebSocketMiddlewareFunction } from "../../types";
/**
 * Middleware execution priority levels
 */
export declare enum MiddlewarePriority {
    CRITICAL = 0,// Security, authentication
    HIGH = 10,// Authorization, rate limiting
    NORMAL = 20,// Business logic, validation
    LOW = 30
}
/**
 * Middleware configuration interface
 */
export interface MiddlewareConfig {
    name: string;
    priority: MiddlewarePriority;
    dependencies?: string[] | undefined;
    optional?: boolean | undefined;
    circuitBreakerConfig?: CircuitBreakerConfig | undefined;
    retryConfig?: RetryConfig | undefined;
}
/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
    failureThreshold: number;
    recoveryTimeout: number;
    halfOpenMaxCalls: number;
}
/**
 * Retry configuration
 */
export interface RetryConfig {
    maxRetries: number;
    baseDelay: number;
    maxDelay: number;
    backoffMultiplier: number;
}
/**
 * Circuit breaker states
 */
declare enum CircuitBreakerState {
    CLOSED = "closed",
    OPEN = "open",
    HALF_OPEN = "half_open"
}
/**
 * Production-grade WebSocket Middleware Chain with advanced composition capabilities
 * Provides ordered execution, dependency resolution, circuit breakers, and error isolation
 *
 * Features:
 * - Direct instantiation (no DI)
 * - Dependency resolution
 * - Circuit breaker pattern
 * - Retry logic with exponential backoff
 * - Comprehensive execution metrics
 * - Error isolation
 *
 * Usage:
 * ```typescript
 * const chain = new WebSocketMiddlewareChain(metrics, "ws-chain");
 * chain.register(authConfig, authMiddleware);
 * chain.register(rateLimitConfig, rateLimitMiddleware);
 *
 * const executor = chain.createExecutor();
 * wsHandler.use(executor);
 * ```
 */
export declare class WebSocketMiddlewareChain {
    private readonly middleware;
    private readonly logger;
    private readonly metrics;
    private readonly chainName;
    private executionOrder;
    constructor(metrics?: IMetricsCollector, chainName?: string);
    /**
     * Register a new middleware in the chain
     */
    register(config: MiddlewareConfig, middleware: WebSocketMiddlewareFunction): this;
    /**
     * Check if a missing dependency could potentially create a valid circular dependency when added
     */
    private wouldCreateCircularDependency;
    /**
     * Check for circular dependencies that would be created by registering this middleware
     */
    private validateCircularDependencies;
    /**
     * Check if adding a dependency would create a circular dependency chain
     */
    private hasCircularDependency;
    /**
     * Create circuit breaker if configured
     */
    private createCircuitBreaker;
    /**
     * Unregister middleware from the chain
     */
    unregister(name: string): boolean;
    /**
     * Execute the complete middleware chain
     */
    execute(context: WebSocketContext): Promise<void>;
    /**
     * Get middleware chain statistics
     */
    getChainStats(): {
        middlewareCount: number;
        executionOrder: string[];
        individualStats: Record<string, {
            totalExecutions: number;
            totalFailures: number;
            averageExecutionTime: number;
            lastExecutionTime?: number;
            circuitBreakerState?: CircuitBreakerState;
            circuitBreakerMetrics?: {
                state: CircuitBreakerState;
                failureCount: number;
                lastFailureTime: number;
            };
        }>;
    };
    /**
     * Build middleware execution order based on priorities and dependencies
     * @param validateDependencies Whether to validate that all dependencies exist
     */
    private buildExecutionOrder;
    /**
     * Execute middleware chain with error isolation
     */
    private executeMiddlewareChain;
    /**
     * Execute individual middleware with circuit breaker and retry logic
     */
    private executeMiddleware;
    /**
     * Execute middleware with retry logic
     */
    private executeWithRetry;
    /**
     * Update execution statistics for middleware
     */
    private updateExecutionStats;
    /**
     * Record chain-level metrics
     */
    private recordChainMetrics;
    /**
     * Record individual middleware metrics
     */
    private recordMiddlewareMetrics;
    /**
     * Generate unique execution ID for tracing
     */
    private generateExecutionId;
    /**
     * Sleep utility for retry delays
     */
    private sleep;
    /**
     * Get middleware count
     */
    getCount(): number;
    /**
     * Create a middleware executor function that can be used directly in WebSocket handlers
     * @returns A WebSocketMiddlewareFunction that executes the entire chain
     */
    createExecutor(): WebSocketMiddlewareFunction;
    /**
     * Cleanup all middlewares in the chain
     */
    cleanup(): Promise<void>;
}
export {};
//# sourceMappingURL=WebSocketMiddlewareChain.d.ts.map