export declare class RateLimiter {
    constructor();
    checkRateLimit(_key: string, limit: number, windowMs: number): Promise<{
        allowed: boolean;
        remaining: number;
        resetTime: number;
    }>;
}
//# sourceMappingURL=RateLimiter.d.ts.map