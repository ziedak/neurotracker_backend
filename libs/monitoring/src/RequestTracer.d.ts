export declare class RequestTracer {
    private static traces;
    static startTrace(traceId: string, operation: string): {
        traceId: string;
        operation: string;
        startTime: number;
        spans: never[];
    };
    static addSpan(traceId: string, spanName: string, metadata?: any): void;
    static finishTrace(traceId: string): any;
}
//# sourceMappingURL=RequestTracer.d.ts.map