// libs/shared/resilience/src/circuit-breaker.ts
export interface CircuitBreakerConfig {
  threshold: number;
  timeout: number;
  resetTimeout: number;
}

export class CircuitBreaker {
  private state: "CLOSED" | "OPEN" | "HALF_OPEN" = "CLOSED";
  private failureCount = 0;
  private lastFailure = 0;
  private readonly config: CircuitBreakerConfig;

  constructor(config?: CircuitBreakerConfig) {
    this.config = {
      threshold: config?.threshold || 5,
      timeout: config?.timeout || 30000,
      resetTimeout: config?.resetTimeout || 60000,
    };
  }

  async execute(fn: () => Promise<any>) {
    if (this.state === "OPEN") {
      if (Date.now() - this.lastFailure > this.config.resetTimeout) {
        this.state = "HALF_OPEN";
      } else {
        throw new Error("Circuit breaker open");
      }
    }

    try {
      const result = await fn();
      this.reset();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  getState(): string {
    return this.state;
  }

  getFailureCount(): number {
    return this.failureCount;
  }

  getLastFailureTime(): number {
    return this.lastFailure;
  }

  public reset() {
    this.state = "CLOSED";
    this.failureCount = 0;
    this.lastFailure = 0;
  }

  private recordFailure() {
    this.failureCount++;
    this.lastFailure = Date.now();

    if (this.failureCount > this.config.threshold) {
      this.state = "OPEN";
    } else if (this.state === "HALF_OPEN") {
      this.state = "OPEN";
    }
  }
}
