// Temporarily removed Redis dependency to resolve circular dependency
// import { RedisClient } from "@libs/database";

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
    _name: string,
    _from?: number,
    _to?: number
  ): Promise<Metric[]> {
    try {
      // Temporarily disabled Redis metrics retrieval
      return [];
    } catch (error) {
      console.error("Failed to get metrics", { error });
      return [];
    }
  }

  private async storeMetric(metric: Metric) {
    try {
      // Temporarily disabled Redis storage
      console.log("Storing metric:", metric);
    } catch (error) {
      console.error("Failed to store metric:", error);
    }
  }
}
