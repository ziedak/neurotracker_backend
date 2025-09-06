import { createLogger } from "@libs/utils";
export class HealthChecker {
    checks = new Map();
    results = new Map();
    logger = createLogger("PrometheusMetricsCollector");
    registerCheck(name, checkFn, timeoutMs) {
        this.checks.set(name, { fn: checkFn, timeout: timeoutMs });
    }
    async runChecks() {
        const { executeWithRetry } = await import("@libs/utils");
        const results = [];
        let details = {};
        for (const [name, { fn, timeout }] of this.checks.entries()) {
            const startTime = Date.now();
            let status = "unhealthy";
            try {
                const result = await executeWithRetry(async () => {
                    return await Promise.race([
                        fn(),
                        new Promise((_, reject) => setTimeout(() => reject(new Error("Health check timeout")), timeout ?? 5000)),
                    ]);
                }, (err) => {
                    if (this.logger)
                        this.logger.warn(`[HealthChecker] ${name} error: ${err}`);
                }, { operationName: name, maxRetries: 2, retryDelay: 500 });
                const responseTime = Date.now() - startTime;
                if (result) {
                    status = responseTime > (timeout ?? 5000) ? "degraded" : "healthy";
                }
                details = { responseTime };
            }
            catch (error) {
                details = {
                    error: error instanceof Error ? error.message : String(error),
                };
                if (this.logger)
                    this.logger.error(`[HealthChecker] ${name} failed:`, error);
            }
            const healthCheck = {
                name,
                status,
                lastCheck: startTime,
                details,
            };
            this.results.set(name, healthCheck);
            results.push(healthCheck);
        }
        return results;
    }
    getCheck(name) {
        return this.results.get(name);
    }
    getAllChecks() {
        return Array.from(this.results.values());
    }
}
//# sourceMappingURL=HealthChecker.js.map