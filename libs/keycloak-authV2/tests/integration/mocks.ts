/**
 * Test Mocks for Integration Tests
 */

/**
 * Minimal IMetricsCollector interface for testing
 */
interface IMetricsCollector {
  recordCounter(
    name: string,
    value?: number,
    labels?: Record<string, string>
  ): Promise<void>;
  recordTimer(
    name: string,
    value: number,
    labels?: Record<string, string>
  ): Promise<void>;
  recordGauge(
    name: string,
    value: number,
    labels?: Record<string, string>
  ): Promise<void>;
  recordHistogram(
    name: string,
    value: number,
    labels?: Record<string, string>,
    buckets?: number[]
  ): Promise<void>;
}

/**
 * Create a mock metrics collector for testing
 */
export function createMockMetricsCollector(): IMetricsCollector {
  return {
    recordCounter: jest.fn().mockResolvedValue(undefined),
    recordGauge: jest.fn().mockResolvedValue(undefined),
    recordHistogram: jest.fn().mockResolvedValue(undefined),
    recordTimer: jest.fn().mockResolvedValue(undefined),
  };
}

/**
 * Global test utilities
 */
export const testUtils = {
  createMockMetricsCollector,
};
