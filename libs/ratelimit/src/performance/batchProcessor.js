import { createLogger } from "@libs/utils";
/**
 * High-performance batch rate limit processor
 * Uses Redis pipelining and parallel processing for optimal throughput
 */
export class BatchRateLimitProcessor {
    redisClient;
    scriptManager;
    keyPrefix;
    ttlBuffer;
    config;
    defaultConfig = {
        maxBatchSize: 100,
        timeout: 5000,
        concurrency: 10,
        retries: 2,
    };
    logger = createLogger("BatchRateLimitProcessor");
    constructor(redisClient, scriptManager, keyPrefix = "rate_limit", ttlBuffer = 10, config = {}) {
        this.redisClient = redisClient;
        this.scriptManager = scriptManager;
        this.keyPrefix = keyPrefix;
        this.ttlBuffer = ttlBuffer;
        this.config = config;
    }
    /**
     * Process multiple rate limit checks in parallel batches
     */
    async processBatch(requests, algorithm = "sliding-window") {
        const startTime = Date.now();
        const config = { ...this.defaultConfig, ...this.config };
        try {
            // Validate inputs first
            this.validateBatchRequests(requests);
            this.logger.debug("Starting batch processing", {
                requestCount: requests.length,
                algorithm,
                config,
            });
            // Sort by priority (high first)
            const sortedRequests = this.sortByPriority(requests);
            // Split into manageable chunks
            const chunks = this.chunkRequests(sortedRequests, config.maxBatchSize);
            // Process chunks with concurrency control
            const results = [];
            const semaphore = new Semaphore(config.concurrency);
            const chunkPromises = chunks.map(async (chunk, index) => {
                await semaphore.acquire();
                try {
                    return await this.processChunk(chunk, algorithm, index);
                }
                finally {
                    semaphore.release();
                }
            });
            const chunkResults = await Promise.all(chunkPromises);
            for (const chunkResult of chunkResults) {
                results.push(...chunkResult);
            }
            // Log performance statistics
            const duration = Date.now() - startTime;
            const stats = this.calculateBatchStats(results, duration);
            this.logger.info("Batch processing completed", stats);
            return results;
        }
        catch (error) {
            const duration = Date.now() - startTime;
            this.logger.error("Batch processing failed", {
                requestCount: requests?.length || 0,
                duration,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }
    /**
     * Process a single chunk using Redis pipelining
     */
    async processChunk(requests, algorithm, chunkIndex) {
        const startTime = Date.now();
        this.logger.debug("Processing chunk", {
            chunkIndex,
            requestCount: requests.length,
            algorithm,
        });
        try {
            if (algorithm === "sliding-window" && requests.length > 1) {
                return await this.processSlidingWindowBatch(requests);
            }
            else {
                return await this.processIndividualRequests(requests, algorithm);
            }
        }
        catch (error) {
            this.logger.error("Chunk processing failed", {
                chunkIndex,
                requestCount: requests.length,
                error: error instanceof Error ? error.message : String(error),
            });
            // Return error results for all requests in chunk
            return requests.map((request) => ({
                key: request.key,
                result: this.createErrorResult(request, algorithm),
                executionTime: Date.now() - startTime,
            }));
        }
    }
    /**
     * Process sliding window requests using batch script
     */
    async processSlidingWindowBatch(requests) {
        if (requests.length === 0) {
            return [];
        }
        const now = Date.now();
        const scriptSha = this.scriptManager.getScriptSha("BATCH_SLIDING_WINDOW");
        if (!scriptSha) {
            throw new Error("Batch sliding window script not loaded");
        }
        // Assume all requests have same window parameters for batch optimization
        const firstRequest = requests[0];
        if (!firstRequest) {
            throw new Error("No requests to process");
        }
        const windowMs = firstRequest.windowMs;
        const maxRequests = firstRequest.maxRequests;
        const windowStart = now - windowMs;
        const expiry = Math.ceil((now + windowMs + this.ttlBuffer * 1000) / 1000);
        const keys = requests.map((req) => `${this.keyPrefix}:${req.key}`);
        const args = [
            String(now),
            String(windowStart),
            String(maxRequests),
            String(expiry),
            String(windowMs),
        ];
        try {
            const redis = this.redisClient.getRedis();
            const results = (await redis.evalsha(scriptSha, keys.length, ...keys, ...args));
            return results.map((result, index) => {
                const [allowed, remaining, resetTime, totalRequests] = result;
                const request = requests[index];
                if (!request) {
                    throw new Error(`Missing request at index ${index}`);
                }
                return {
                    key: request.key,
                    result: {
                        allowed: allowed === 1,
                        totalHits: totalRequests || 0,
                        remaining: Math.max(0, remaining || 0),
                        resetTime: resetTime || now + windowMs,
                        retryAfter: allowed === 0
                            ? Math.ceil(((resetTime || now + windowMs) - now) / 1000)
                            : 0,
                        algorithm: "sliding-window",
                        windowStart: windowStart,
                        windowEnd: now + windowMs,
                        limit: request.maxRequests,
                        cached: false,
                        responseTime: Date.now() - now,
                    },
                    executionTime: Date.now() - now,
                };
            });
        }
        catch (error) {
            this.logger.error("Batch script execution failed", error);
            throw error;
        }
    }
    /**
     * Process requests individually using pipeline
     */
    async processIndividualRequests(requests, algorithm) {
        const pipeline = this.redisClient.getRedis().pipeline();
        const now = Date.now();
        // Build pipeline commands
        const scriptSha = this.scriptManager.getScriptSha(this.getScriptName(algorithm));
        if (!scriptSha) {
            throw new Error(`Script not loaded for algorithm: ${algorithm}`);
        }
        for (const request of requests) {
            const redisKey = `${this.keyPrefix}:${request.key}`;
            const args = this.buildScriptArgs(request, algorithm, now);
            const keys = algorithm === "fixed-window"
                ? [`${redisKey}:${Math.floor(now / request.windowMs)}`]
                : [redisKey];
            pipeline.evalsha(scriptSha, keys.length, ...keys, ...args);
        }
        // Execute pipeline
        const pipelineResults = await pipeline.exec();
        if (!pipelineResults) {
            throw new Error("Pipeline execution failed");
        }
        // Process results
        return requests.map((request, index) => {
            const pipelineResult = pipelineResults[index];
            const executionTime = Date.now() - now;
            if (!pipelineResult) {
                this.logger.warn("Missing pipeline result", {
                    key: request.key,
                    index,
                });
                return {
                    key: request.key,
                    result: this.createErrorResult(request, algorithm),
                    executionTime,
                    cacheHit: false,
                };
            }
            if (pipelineResult[0]) {
                // Error in this specific command
                this.logger.warn("Individual request failed in pipeline", {
                    key: request.key,
                    error: pipelineResult[0],
                });
                return {
                    key: request.key,
                    result: this.createErrorResult(request, algorithm),
                    executionTime,
                    cacheHit: false,
                };
            }
            const scriptResult = pipelineResult[1];
            if (!Array.isArray(scriptResult) || scriptResult.length < 4) {
                this.logger.warn("Invalid script result format", {
                    key: request.key,
                    result: scriptResult,
                });
                return {
                    key: request.key,
                    result: this.createErrorResult(request, algorithm),
                    executionTime,
                    cacheHit: false,
                };
            }
            const [allowed, remaining, resetTime, totalRequests] = scriptResult;
            const windowStart = now - request.windowMs;
            return {
                key: request.key,
                result: {
                    allowed: allowed === 1,
                    totalHits: totalRequests || 0,
                    remaining: Math.max(0, remaining || 0),
                    resetTime: resetTime || now + request.windowMs,
                    retryAfter: allowed === 0
                        ? Math.ceil(((resetTime || now + request.windowMs) - now) / 1000)
                        : 0,
                    algorithm: algorithm,
                    windowStart: windowStart,
                    windowEnd: now + request.windowMs,
                    limit: request.maxRequests,
                    cached: false,
                    responseTime: executionTime,
                },
                executionTime,
                cacheHit: false,
            };
        });
    }
    /**
     * Build script arguments for different algorithms
     */
    buildScriptArgs(request, algorithm, now) {
        const windowMs = request.windowMs;
        const maxRequests = request.maxRequests;
        const expiry = Math.ceil((now + windowMs + this.ttlBuffer * 1000) / 1000);
        switch (algorithm) {
            case "sliding-window":
                const windowStart = now - windowMs;
                return [
                    String(now),
                    String(windowStart),
                    String(maxRequests),
                    String(expiry),
                    `${now}_${request.key}`,
                    String(windowMs),
                ];
            case "token-bucket":
                const refillRate = maxRequests / (windowMs / 1000);
                return [
                    String(now),
                    String(maxRequests),
                    String(refillRate),
                    String(expiry),
                ];
            case "fixed-window":
                const window = Math.floor(now / windowMs);
                const windowEnd = (window + 1) * windowMs;
                const windowExpiry = Math.ceil((windowEnd + this.ttlBuffer * 1000) / 1000);
                return [String(maxRequests), String(windowExpiry), String(windowEnd)];
            default:
                throw new Error(`Unsupported algorithm: ${algorithm}`);
        }
    }
    /**
     * Get script name for algorithm
     */
    getScriptName(algorithm) {
        switch (algorithm) {
            case "sliding-window":
                return "SLIDING_WINDOW";
            case "token-bucket":
                return "TOKEN_BUCKET";
            case "fixed-window":
                return "FIXED_WINDOW";
            default:
                return "SLIDING_WINDOW";
        }
    }
    /**
     * Validate batch requests
     */
    validateBatchRequests(requests) {
        if (!Array.isArray(requests) || requests.length === 0) {
            throw new Error("Requests must be a non-empty array");
        }
        if (requests.length > this.defaultConfig.maxBatchSize * 10) {
            throw new Error(`Batch size too large: ${requests.length}`);
        }
        for (let i = 0; i < requests.length; i++) {
            const request = requests[i];
            if (!request) {
                throw new Error(`Request at index ${i} is undefined`);
            }
            if (!request.key ||
                typeof request.key !== "string" ||
                request.key.length > 250) {
                throw new Error(`Invalid key at index ${i}`);
            }
            if (!Number.isInteger(request.maxRequests) ||
                request.maxRequests <= 0 ||
                request.maxRequests > 10000) {
                throw new Error(`Invalid maxRequests at index ${i}`);
            }
            if (!Number.isInteger(request.windowMs) ||
                request.windowMs <= 0 ||
                request.windowMs > 86400000) {
                throw new Error(`Invalid windowMs at index ${i}`);
            }
        }
    }
    /**
     * Sort requests by priority
     */
    sortByPriority(requests) {
        const priorityOrder = { high: 0, normal: 1, low: 2 };
        return [...requests].sort((a, b) => {
            const priorityA = priorityOrder[a.priority || "normal"];
            const priorityB = priorityOrder[b.priority || "normal"];
            return priorityA - priorityB;
        });
    }
    /**
     * Split requests into chunks
     */
    chunkRequests(requests, chunkSize) {
        const chunks = [];
        for (let i = 0; i < requests.length; i += chunkSize) {
            chunks.push(requests.slice(i, i + chunkSize));
        }
        return chunks;
    }
    /**
     * Calculate batch statistics
     */
    calculateBatchStats(results, _totalDuration) {
        if (results.length === 0) {
            return {
                totalRequests: 0,
                processedRequests: 0,
                cacheHits: 0,
                avgExecutionTime: 0,
                maxExecutionTime: 0,
                minExecutionTime: 0,
                errors: 0,
            };
        }
        const executionTimes = results.map((r) => r.executionTime);
        const cacheHits = results.filter((r) => r.cacheHit).length;
        const errors = results.filter((r) => !r.result.allowed && r.result.totalHits === -1).length;
        return {
            totalRequests: results.length,
            processedRequests: results.length - errors,
            cacheHits,
            avgExecutionTime: executionTimes.reduce((a, b) => a + b, 0) / executionTimes.length,
            maxExecutionTime: Math.max(...executionTimes),
            minExecutionTime: Math.min(...executionTimes),
            errors,
        };
    }
    /**
     * Create error result for failed requests
     */
    createErrorResult(request, algorithm) {
        const now = Date.now();
        return {
            allowed: false,
            totalHits: -1, // Indicates error
            remaining: 0,
            resetTime: now + request.windowMs,
            retryAfter: Math.ceil(request.windowMs / 1000),
            algorithm: algorithm,
            windowStart: now - request.windowMs,
            windowEnd: now + request.windowMs,
            limit: request.maxRequests,
            cached: false,
            responseTime: 0,
        };
    }
}
/**
 * Simple semaphore for concurrency control
 */
class Semaphore {
    permits;
    waitQueue = [];
    constructor(permits) {
        this.permits = permits;
    }
    async acquire() {
        if (this.permits > 0) {
            this.permits--;
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            this.waitQueue.push(resolve);
        });
    }
    release() {
        if (this.waitQueue.length > 0) {
            const next = this.waitQueue.shift();
            if (next) {
                next();
            }
        }
        else {
            this.permits++;
        }
    }
}
//# sourceMappingURL=batchProcessor.js.map