import { RedisClient } from "@libs/database";
// Metrics types
export interface Metric {
  name: string;
  value: number;
  timestamp: number;
  tags?: Record<string, string> | undefined;
}

export interface TimingMetric extends Metric {
  duration: number;
}

export interface CounterMetric extends Metric {
  count: number;
}

export interface IMetricsCollector {
  recordCounter(
    name: string,
    value?: number,
    tags?: Record<string, string>
  ): Promise<void>;
  recordTimer(
    name: string,
    duration: number,
    tags?: Record<string, string>
  ): Promise<void>;
  recordGauge(
    name: string,
    value: number,
    tags?: Record<string, string>
  ): Promise<void>;
  recordHistogram(
    name: string,
    value: number,
    tags?: Record<string, string>
  ): Promise<void>;
  getMetrics(name: string, from?: number, to?: number): Promise<Metric[]>;
}

// Metrics collector
export class MetricsCollector implements IMetricsCollector {
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

  async recordHistogram(
    name: string,
    value: number,
    tags?: Record<string, string>
  ) {
    // For now, treat histogram like a gauge
    // In production, you'd implement proper histogram buckets
    const metric: Metric = {
      name: `${name}_histogram`,
      value,
      timestamp: Date.now(),
      tags,
    };

    await this.storeMetric(metric);
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
        const timestamp = parseInt(results[i + 1] ?? "0", 10);
        if (typeof data === "string") {
          metrics.push({ ...JSON.parse(data), timestamp });
        }
      }

      return metrics;
    } catch (error) {
      console.error("Failed to retrieve metrics:", error);
      return [];
    }
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
}
