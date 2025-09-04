export interface Metric {
    name: string;
    value: number;
    timestamp: number;
    tags?: Record<string, string> | undefined;
}
export interface TimingMetric extends Metric {
    duration: number;
}
export interface CounterMetric extends Metric {
    count: number;
}
export interface IMetricsCollector {
    recordCounter(name: string, value?: number, tags?: Record<string, string>): Promise<void>;
    recordTimer(name: string, duration: number, tags?: Record<string, string>): Promise<void>;
    recordGauge(name: string, value: number, tags?: Record<string, string>): Promise<void>;
    recordHistogram(name: string, value: number, tags?: Record<string, string>): Promise<void>;
    getMetrics(name: string, from?: number, to?: number): Promise<Metric[]>;
}
export declare class MetricsCollector implements IMetricsCollector {
    private static instance;
    private constructor();
    static getInstance(): MetricsCollector;
    recordCounter(name: string, value?: number, tags?: Record<string, string>): Promise<void>;
    recordTimer(name: string, duration: number, tags?: Record<string, string>): Promise<void>;
    recordGauge(name: string, value: number, tags?: Record<string, string>): Promise<void>;
    recordHistogram(name: string, value: number, tags?: Record<string, string>): Promise<void>;
    getMetrics(_name: string, _from?: number, _to?: number): Promise<Metric[]>;
    private storeMetric;
}
//# sourceMappingURL=MetricsCollector.d.ts.map