// libs/shared/resilience/src/circuit-breaker.ts
export class CircuitBreaker {
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private failureCount = 0;
  private lastFailure = 0;

  async execute(fn: () => Promise<any>) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailure > 30000) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error('Circuit breaker open');
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
  private reset() {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.lastFailure = 0;
  }

  private recordFailure() {
    this.failureCount++;
    this.lastFailure = Date.now();

    if (this.failureCount > 5) {
      this.state = 'OPEN';
    } else if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
    }
  }
}
