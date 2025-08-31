// libs/utils/src/circuit-breaker.ts
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
        throw new Error(
          `Circuit breaker is OPEN. Retry after ${
            this.config.resetTimeout - (Date.now() - this.lastFailure)
          }ms`
        );
      }
    }

    try {
      const result = await this.withTimeout(fn, this.config.timeout);
      // If HALF_OPEN and success, close breaker
      if (this.state === "HALF_OPEN") {
        this.reset();
      } else {
        this.reset();
      }
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  getState(): string {
    return this.state;
  }

  isOpen(): boolean {
    return this.state === "OPEN";
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

  public recordFailure() {
    this.failureCount++;
    this.lastFailure = Date.now();

    if (this.failureCount >= this.config.threshold) {
      this.state = "OPEN";
    } else if (this.state === "HALF_OPEN") {
      this.state = "OPEN";
    }
  }

  private async withTimeout(
    fn: () => Promise<any>,
    timeout: number
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Operation timed out after ${timeout}ms`));
      }, timeout);
      fn()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }
}
