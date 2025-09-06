export interface HealthCheck {
    name: string;
    status: "healthy" | "unhealthy" | "degraded";
    lastCheck: number;
    details?: any;
}
export declare class HealthChecker {
    private checks;
    private results;
    private logger;
    registerCheck(name: string, checkFn: () => Promise<boolean>, timeoutMs?: number | undefined): void;
    runChecks(): Promise<HealthCheck[]>;
    getCheck(name: string): HealthCheck | undefined;
    getAllChecks(): HealthCheck[];
}
//# sourceMappingURL=HealthChecker.d.ts.map