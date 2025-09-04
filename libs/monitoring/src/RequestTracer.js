// Request tracing
export class RequestTracer {
    static traces = new Map();
    static startTrace(traceId, operation) {
        const trace = {
            traceId,
            operation,
            startTime: Date.now(),
            spans: [],
        };
        RequestTracer.traces.set(traceId, trace);
        return trace;
    }
    static addSpan(traceId, spanName, metadata) {
        const trace = RequestTracer.traces.get(traceId);
        if (trace) {
            trace.spans.push({
                name: spanName,
                timestamp: Date.now(),
                metadata,
            });
        }
    }
    static finishTrace(traceId) {
        const trace = RequestTracer.traces.get(traceId);
        if (trace) {
            trace.endTime = Date.now();
            trace.duration = trace.endTime - trace.startTime;
            // In production, send to distributed tracing system
            console.log("Trace completed:", JSON.stringify(trace, null, 2));
            RequestTracer.traces.delete(traceId);
            return trace;
        }
    }
}
//# sourceMappingURL=RequestTracer.js.map