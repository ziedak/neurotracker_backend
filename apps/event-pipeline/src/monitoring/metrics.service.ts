import { MetricsCollector } from "@libs/monitoring";
import { inject } from "tsyringe";

export class MetricsService {
  constructor(@inject("MetricsCollector") private metrics: MetricsCollector) {}
  async record(metric: string, value: number, tags?: Record<string, string>) {
    await this.metrics.recordGauge(metric, value, tags);
  }

  async recordCounter(
    metric: string,
    value: number = 1,
    tags?: Record<string, string>
  ) {
    await this.metrics.recordCounter(metric, value, tags);
  }

  async recordTimer(
    metric: string,
    duration: number,
    tags?: Record<string, string>
  ) {
    await this.metrics.recordTimer(metric, duration, tags);
  }

  async getMetrics() {
    // async getMetrics(metric: string, from?: number, to?: number) {
    // return await this.metrics.getMetrics(metric, from, to);
    return await this.metrics.getMetrics();
  }
}
