/**
 * High-Performance Prometheus Metrics Collector
 *
 * Enterprise-grade metrics collection with zero-allocation recording,
 * proper histogram buckets, and automatic Prometheus exposition.
 */
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { PrometheusMetricsCollector } from "./PrometheusMetricsCollector";
import { injectable, singleton, container } from "tsyringe";
// ===================================================================
// METRICS COLLECTOR IMPLEMENTATION
// ===================================================================
let MetricsCollector = class MetricsCollector {
    collector;
    constructor() {
        this.collector = container.resolve(PrometheusMetricsCollector);
    }
    // ===================================================================
    // CORE METRIC METHODS
    // ===================================================================
    recordCounter(name, value = 1, labels) {
        this.collector.recordCounter(name, value, labels);
    }
    recordTimer(name, value, labels) {
        this.collector.recordTimer(name, value, labels);
    }
    recordGauge(name, value, labels) {
        this.collector.recordGauge(name, value, labels);
    }
    recordHistogram(name, value, labels, buckets) {
        this.collector.recordHistogram(name, value, labels, buckets);
    }
    recordSummary(name, value, labels) {
        this.collector.recordSummary(name, value, labels);
    }
    async getMetrics() {
        return this.collector.getMetrics();
    }
    // ===================================================================
    // HIGH-LEVEL BUSINESS METRICS
    // ===================================================================
    recordApiRequest(method, route, statusCode, duration, service = "unknown") {
        this.collector.recordApiRequest(method, route, statusCode, duration, service);
    }
    recordDatabaseOperation(clientType, operation, duration, success, service = "unknown") {
        this.collector.recordDatabaseOperation(clientType, operation, duration, success, service);
    }
    recordAuthOperation(operation, result, userRole = "unknown") {
        this.collector.recordAuthOperation(operation, result, userRole);
    }
    recordWebSocketActivity(service, messageType, direction, connectionCount) {
        this.collector.recordWebSocketActivity(service, messageType, direction, connectionCount);
    }
    recordNodeMetrics(service) {
        this.collector.recordNodeMetrics(service);
    }
    measureEventLoopLag(service) {
        this.collector.measureEventLoopLag(service);
    }
};
MetricsCollector = __decorate([
    injectable(),
    singleton(),
    __metadata("design:paramtypes", [])
], MetricsCollector);
export { MetricsCollector };
// ===================================================================
// DEPENDENCY INJECTION SETUP
// ===================================================================
// Register the MetricsCollector as a singleton
container.registerSingleton("MetricsCollector", MetricsCollector);
container.registerSingleton("MetricsCollector", MetricsCollector);
export { MetricsCollector as default };
//# sourceMappingURL=MetricsCollector.js.map