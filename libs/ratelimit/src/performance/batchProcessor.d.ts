import { RedisClient } from "@libs/database";
import { SharedScriptManager } from "./scriptManager";
import { RateLimitResult } from "../types";
/**
 * Batch rate limit request
 */
export interface BatchRateLimitRequest {
    key: string;
    maxRequests: number;
    windowMs: number;
    priority?: "high" | "normal" | "low";
}
/**
 * Batch rate limit response
 */
export interface BatchRateLimitResponse {
    key: string;
    result: RateLimitResult;
    executionTime: number;
    cacheHit?: boolean;
}
/**
 * Batch operation statistics
 */
export interface BatchStats {
    totalRequests: number;
    processedRequests: number;
    cacheHits: number;
    avgExecutionTime: number;
    maxExecutionTime: number;
    minExecutionTime: number;
    errors: number;
}
/**
 * Pipeline configuration
 */
interface PipelineConfig {
    maxBatchSize: number;
    timeout: number;
    concurrency: number;
    retries: number;
}
/**
 * High-performance batch rate limit processor
 * Uses Redis pipelining and parallel processing for optimal throughput
 */
export declare class BatchRateLimitProcessor {
    private readonly redisClient;
    private readonly scriptManager;
    private readonly keyPrefix;
    private readonly ttlBuffer;
    private readonly config;
    private readonly defaultConfig;
    logger: import("@libs/utils").ILogger;
    constructor(redisClient: RedisClient, scriptManager: SharedScriptManager, keyPrefix?: string, ttlBuffer?: number, config?: Partial<PipelineConfig>);
    /**
     * Process multiple rate limit checks in parallel batches
     */
    processBatch(requests: BatchRateLimitRequest[], algorithm?: "sliding-window" | "token-bucket" | "fixed-window"): Promise<BatchRateLimitResponse[]>;
    /**
     * Process a single chunk using Redis pipelining
     */
    private processChunk;
    /**
     * Process sliding window requests using batch script
     */
    private processSlidingWindowBatch;
    /**
     * Process requests individually using pipeline
     */
    private processIndividualRequests;
    /**
     * Build script arguments for different algorithms
     */
    private buildScriptArgs;
    /**
     * Get script name for algorithm
     */
    private getScriptName;
    /**
     * Validate batch requests
     */
    private validateBatchRequests;
    /**
     * Sort requests by priority
     */
    private sortByPriority;
    /**
     * Split requests into chunks
     */
    private chunkRequests;
    /**
     * Calculate batch statistics
     */
    private calculateBatchStats;
    /**
     * Create error result for failed requests
     */
    private createErrorResult;
}
export {};
//# sourceMappingURL=batchProcessor.d.ts.map