import { performance } from "perf_hooks";
import { RedisClient } from "@libs/database";
import { getEnv } from "@libs/config";
// Metrics types
export interface Metric {
  name: string;
  value: number;
  timestamp: number;
  tags?: Record<string, string>;
}

export interface TimingMetric extends Metric {
  duration: number;
}

export interface CounterMetric extends Metric {
  count: number;
}

// Logger utility
export class Logger {
  private service: string;

  constructor(service: string) {
    this.service = service;
  }

  private log(level: string, message: string, meta?: any) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      service: this.service,
      message,
      ...(meta && { meta }),
    };

    console.log(JSON.stringify(logEntry));

    // In production, send to centralized logging
    this.sendToLoggingService(logEntry);
  }

  info(message: string, meta?: any) {
    this.log("info", message, meta);
  }

  warn(message: string, meta?: any) {
    this.log("warn", message, meta);
  }

  error(message: string, error?: Error, meta?: any) {
    this.log("error", message, {
      error: error?.message,
      stack: error?.stack,
      ...meta,
    });
  }

  debug(message: string, meta?: any) {
    if (getEnv("NODE_ENV") === "development") {
      this.log("debug", message, meta);
    }
  }

  private async sendToLoggingService(logEntry: any) {
    // In production, implement actual logging service integration
    // For now, we'll store in Redis for demonstration
    try {
      const redis = RedisClient.getInstance();
      await redis.lpush(`logs:${this.service}`, JSON.stringify(logEntry));
      await redis.ltrim(`logs:${this.service}`, 0, 999); // Keep last 1000 logs
    } catch (error) {
      // Don't throw on logging errors
      console.error("Failed to send log to service:", error);
    }
  }
}

// Metrics collector
export class MetricsCollector {
  private static instance: MetricsCollector;

  private constructor() {
    // No need to store redis instance as property since we get it when needed
  }

  static getInstance(): MetricsCollector {
    if (!MetricsCollector.instance) {
      MetricsCollector.instance = new MetricsCollector();
    }
    return MetricsCollector.instance;
  }

  async recordCounter(name: string, value = 1, tags?: Record<string, string>) {
    const metric: CounterMetric = {
      name,
      value,
      count: value,
      timestamp: Date.now(),
      tags,
    };

    await this.storeMetric(metric);
  }

  async recordTimer(
    name: string,
    duration: number,
    tags?: Record<string, string>
  ) {
    const metric: TimingMetric = {
      name,
      value: duration,
      duration,
      timestamp: Date.now(),
      tags,
    };

    await this.storeMetric(metric);
  }

  async recordGauge(
    name: string,
    value: number,
    tags?: Record<string, string>
  ) {
    const metric: Metric = {
      name,
      value,
      timestamp: Date.now(),
      tags,
    };

    await this.storeMetric(metric);
  }

  private async storeMetric(metric: Metric) {
    try {
      const key = `metrics:${metric.name}`;
      const redis = RedisClient.getInstance();
      await redis.zadd(key, metric.timestamp, JSON.stringify(metric));

      // Keep metrics for 24 hours
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      await redis.zremrangebyscore(key, 0, oneDayAgo);
    } catch (error) {
      console.error("Failed to store metric:", error);
    }
  }

  async getMetrics(
    name: string,
    from?: number,
    to?: number
  ): Promise<Metric[]> {
    try {
      const key = `metrics:${name}`;
      const fromScore = from || Date.now() - 60 * 60 * 1000; // Last hour by default
      const toScore = to || Date.now();

      const redis = RedisClient.getInstance();
      const results = await redis.zrangebyscore(
        key,
        fromScore,
        toScore,
        "WITHSCORES"
      );

      const metrics: Metric[] = [];
      for (let i = 0; i < results.length; i += 2) {
        const data = results[i];
        const timestamp = parseInt(results[i + 1]);
        metrics.push({ ...JSON.parse(data), timestamp });
      }

      return metrics;
    } catch (error) {
      console.error("Failed to retrieve metrics:", error);
      return [];
    }
  }
}

// Performance monitoring decorator
export function timed(metricName?: string) {
  return function (
    target: any,
    propertyName: string,
    descriptor: PropertyDescriptor
  ) {
    const method = descriptor.value;
    const name = metricName || `${target.constructor.name}.${propertyName}`;

    descriptor.value = async function (...args: any[]) {
      const startTime = performance.now();
      const metrics = MetricsCollector.getInstance();

      try {
        const result = await method.apply(this, args);
        const duration = performance.now() - startTime;

        await metrics.recordTimer(name, duration, { status: "success" });
        return result;
      } catch (error) {
        const duration = performance.now() - startTime;

        await metrics.recordTimer(name, duration, { status: "error" });
        await metrics.recordCounter(`${name}.errors`);

        throw error;
      }
    };

    return descriptor;
  };
}

// Health check utility
export interface HealthCheck {
  name: string;
  status: "healthy" | "unhealthy" | "degraded";
  lastCheck: number;
  details?: any;
}

export class HealthChecker {
  private checks: Map<string, () => Promise<boolean>> = new Map();
  private results: Map<string, HealthCheck> = new Map();

  registerCheck(name: string, checkFn: () => Promise<boolean>) {
    this.checks.set(name, checkFn);
  }

  async runChecks(): Promise<HealthCheck[]> {
    const checkPromises = Array.from(this.checks.entries()).map(
      async ([name, checkFn]) => {
        const startTime = Date.now();

        try {
          const isHealthy = await Promise.race([
            checkFn(),
            new Promise<boolean>((_, reject) =>
              setTimeout(() => reject(new Error("Health check timeout")), 5000)
            ),
          ]);

          const healthCheck: HealthCheck = {
            name,
            status: isHealthy ? "healthy" : "unhealthy",
            lastCheck: startTime,
            details: { responseTime: Date.now() - startTime },
          };

          this.results.set(name, healthCheck);
          return healthCheck;
        } catch (error) {
          const healthCheck: HealthCheck = {
            name,
            status: "unhealthy",
            lastCheck: startTime,
            details: {
              error: error instanceof Error ? error.message : String(error),
            },
          };

          this.results.set(name, healthCheck);
          return healthCheck;
        }
      }
    );

    return Promise.all(checkPromises);
  }

  getCheck(name: string): HealthCheck | undefined {
    return this.results.get(name);
  }

  getAllChecks(): HealthCheck[] {
    return Array.from(this.results.values());
  }
}

// Rate limiter
export class RateLimiter {
  constructor() {
    // No need to store redis instance
  }

  async checkRateLimit(
    key: string,
    limit: number,
    windowMs: number
  ): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
    const now = Date.now();
    const window = Math.floor(now / windowMs);
    const redisKey = `ratelimit:${key}:${window}`;

    try {
      const redis = RedisClient.getInstance();
      const current = await redis.incr(redisKey);

      if (current === 1) {
        await redis.expire(redisKey, Math.ceil(windowMs / 1000));
      }

      const allowed = current <= limit;
      const remaining = Math.max(0, limit - current);
      const resetTime = (window + 1) * windowMs;

      return { allowed, remaining, resetTime };
    } catch (error) {
      // If Redis fails, allow the request but log the error
      console.error("Rate limiting failed:", error);
      return { allowed: true, remaining: limit, resetTime: now + windowMs };
    }
  }
}

// Request tracing
export class RequestTracer {
  private static traces: Map<string, any> = new Map();

  static startTrace(traceId: string, operation: string) {
    const trace = {
      traceId,
      operation,
      startTime: Date.now(),
      spans: [],
    };

    RequestTracer.traces.set(traceId, trace);
    return trace;
  }

  static addSpan(traceId: string, spanName: string, metadata?: any) {
    const trace = RequestTracer.traces.get(traceId);
    if (trace) {
      trace.spans.push({
        name: spanName,
        timestamp: Date.now(),
        metadata,
      });
    }
  }

  static finishTrace(traceId: string) {
    const trace = RequestTracer.traces.get(traceId);
    if (trace) {
      trace.endTime = Date.now();
      trace.duration = trace.endTime - trace.startTime;

      // In production, send to distributed tracing system
      console.log("Trace completed:", JSON.stringify(trace, null, 2));

      RequestTracer.traces.delete(traceId);
      return trace;
    }
  }
}
