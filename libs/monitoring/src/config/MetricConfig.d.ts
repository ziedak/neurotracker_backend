/**
 * Optimized histogram buckets for different use cases
 */
export declare const METRIC_BUCKETS: {
    readonly API_DURATION: readonly [0.001, 0.002, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];
    readonly DATABASE_DURATION: readonly [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5];
    readonly CACHE_DURATION: readonly [0.0001, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.025, 0.05, 0.1];
    readonly BUSINESS_DURATION: readonly [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300];
    readonly FILE_SIZE: readonly [1024, 4096, 16384, 65536, 262144, 1048576, 4194304, 16777216];
    readonly QUEUE_SIZE: readonly [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
};
/**
 * Metric configuration with cardinality protection
 */
export interface MetricConfig {
    name: string;
    help: string;
    labelNames?: string[];
    buckets?: number[];
    maxLabels?: number;
    ttl?: number;
}
//# sourceMappingURL=MetricConfig.d.ts.map