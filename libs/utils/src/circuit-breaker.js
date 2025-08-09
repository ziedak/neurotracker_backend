// libs/shared/resilience/src/circuit-breaker.ts
export class CircuitBreaker {
    state = 'CLOSED';
    failureCount = 0;
    lastFailure = 0;
    async execute(fn) {
        if (this.state === 'OPEN') {
            if (Date.now() - this.lastFailure > 30000) {
                this.state = 'HALF_OPEN';
            }
            else {
                throw new Error('Circuit breaker open');
            }
        }
        try {
            const result = await fn();
            this.reset();
            return result;
        }
        catch (error) {
            this.recordFailure();
            throw error;
        }
    }
    reset() {
        this.state = 'CLOSED';
        this.failureCount = 0;
        this.lastFailure = 0;
    }
    recordFailure() {
        this.failureCount++;
        this.lastFailure = Date.now();
        if (this.failureCount > 5) {
            this.state = 'OPEN';
        }
        else if (this.state === 'HALF_OPEN') {
            this.state = 'OPEN';
        }
    }
}
//# sourceMappingURL=circuit-breaker.js.map