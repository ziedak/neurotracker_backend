export declare class CircuitBreaker {
    private state;
    private failureCount;
    private lastFailure;
    execute(fn: () => Promise<any>): Promise<any>;
    private reset;
    private recordFailure;
}
