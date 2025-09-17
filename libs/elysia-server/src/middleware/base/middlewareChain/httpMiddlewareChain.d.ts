import { MiddlewareFunction } from "../../types";
import { type IMetricsCollector } from "@libs/monitoring";
/**
 * Middleware configuration for HTTP middleware chain
 */
export interface HttpMiddlewareChainConfig {
    readonly name: string;
    readonly middlewares?: readonly HttpMiddlewareChainItem[];
}
/**
 * Individual middleware configuration in chain
 */
export interface HttpMiddlewareChainItem {
    readonly name: string;
    readonly middleware: MiddlewareFunction;
    readonly priority?: number;
    readonly enabled?: boolean;
}
/**
 * Utility class for chaining multiple HTTP middleware functions
 * Handles priority ordering, error propagation, and execution statistics
 *
 * Features:
 * - Direct instantiation (no DI)
 * - Priority-based execution ordering
 * - Error isolation and propagation
 * - Execution metrics and monitoring
 * - Dynamic middleware management
 *
 * Usage:
 * ```typescript
 * const chain = new HttpMiddlewareChain(metrics, config);
 * const chainFunction = chain.execute();
 * app.use(chainFunction);
 * ```
 */
export declare class HttpMiddlewareChain {
    private readonly middlewares;
    private readonly logger;
    private readonly metrics;
    private readonly chainName;
    constructor(metrics: IMetricsCollector, config: HttpMiddlewareChainConfig);
    /**
     * Execute the middleware chain
     */
    execute(): MiddlewareFunction;
    /**
     * Add a middleware to the chain
     */
    add(name: string, middleware: MiddlewareFunction, priority?: number): void;
    /**
     * Remove a middleware from the chain
     */
    remove(name: string): boolean;
    /**
     * Enable or disable a middleware
     */
    toggle(name: string, enabled: boolean): boolean;
    /**
     * Get the list of middlewares in execution order
     */
    getMiddlewares(): Array<{
        name: string;
        priority: number;
        enabled: boolean;
    }>;
    /**
     * Get middleware count
     */
    getCount(): number;
    /**
     * Create a new chain with additional middleware
     */
    with(name: string, middleware: MiddlewareFunction, priority?: number): HttpMiddlewareChain;
    /**
     * Record chain-level metrics
     */
    private recordChainMetrics;
    /**
     * Record individual middleware metrics
     */
    private recordMiddlewareMetrics;
    /**
     * Cleanup all middlewares in the chain
     */
    cleanup(): Promise<void>;
    /**
     * Generate unique execution ID for tracing
     */
    private generateExecutionId;
}
//# sourceMappingURL=httpMiddlewareChain.d.ts.map