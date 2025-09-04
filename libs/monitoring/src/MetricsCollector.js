// Temporarily removed Redis dependency to resolve circular dependency
// import { RedisClient } from "@libs/database";
// Metrics collector
export class MetricsCollector {
    static instance;
    constructor() {
        // No need to store redis instance as property since we get it when needed
    }
    static getInstance() {
        if (!MetricsCollector.instance) {
            MetricsCollector.instance = new MetricsCollector();
        }
        return MetricsCollector.instance;
    }
    async recordCounter(name, value = 1, tags) {
        const metric = {
            name,
            value,
            count: value,
            timestamp: Date.now(),
            tags,
        };
        await this.storeMetric(metric);
    }
    async recordTimer(name, duration, tags) {
        const metric = {
            name,
            value: duration,
            duration,
            timestamp: Date.now(),
            tags,
        };
        await this.storeMetric(metric);
    }
    async recordGauge(name, value, tags) {
        const metric = {
            name,
            value,
            timestamp: Date.now(),
            tags,
        };
        await this.storeMetric(metric);
    }
    async recordHistogram(name, value, tags) {
        // For now, treat histogram like a gauge
        // In production, you'd implement proper histogram buckets
        const metric = {
            name: `${name}_histogram`,
            value,
            timestamp: Date.now(),
            tags,
        };
        await this.storeMetric(metric);
    }
    async getMetrics(_name, _from, _to) {
        try {
            // Temporarily disabled Redis metrics retrieval
            return [];
        }
        catch (error) {
            console.error("Failed to get metrics", { error });
            return [];
        }
    }
    async storeMetric(metric) {
        try {
            // Temporarily disabled Redis storage
            console.log("Storing metric:", metric);
        }
        catch (error) {
            console.error("Failed to store metric:", error);
        }
    }
}
//# sourceMappingURL=MetricsCollector.js.map