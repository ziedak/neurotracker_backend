# Monitoring & Observability

Comprehensive monitoring, metrics collection, alerting, and observability features for the authentication library.

## Metrics Collection Architecture

### Metrics Collector

```typescript
class MetricsCollector {
  private metrics = new Map<string, Metric>();
  private collectors = new Map<string, MetricCollector>();

  async collect(
    metricName: string,
    value: number,
    labels: Record<string, string> = {}
  ): Promise<void> {
    const metric = this.metrics.get(metricName);
    if (!metric) {
      throw new MetricNotFoundError(metricName);
    }

    await metric.collect(value, labels);
  }

  async incrementCounter(
    metricName: string,
    labels: Record<string, string> = {}
  ): Promise<void> {
    await this.collect(metricName, 1, labels);
  }

  async recordTimer(
    metricName: string,
    duration: number,
    labels: Record<string, string> = {}
  ): Promise<void> {
    const metric = this.metrics.get(metricName);
    if (metric?.type === "histogram") {
      await metric.observe(duration, labels);
    }
  }

  async setGauge(
    metricName: string,
    value: number,
    labels: Record<string, string> = {}
  ): Promise<void> {
    const metric = this.metrics.get(metricName);
    if (metric?.type === "gauge") {
      await metric.set(value, labels);
    }
  }

  registerMetric(definition: MetricDefinition): void {
    const metric = this.createMetric(definition);
    this.metrics.set(definition.name, metric);
  }

  registerCollector(collector: MetricCollector): void {
    this.collectors.set(collector.name, collector);

    // Start collection if interval is specified
    if (collector.interval) {
      setInterval(() => {
        collector.collect().catch((error) => {
          this.logger.error("Collector failed", {
            collector: collector.name,
            error,
          });
        });
      }, collector.interval);
    }
  }

  async getMetrics(): Promise<MetricData[]> {
    const results = await Promise.all(
      Array.from(this.collectors.values()).map((collector) =>
        collector.collect()
      )
    );

    return results.flat();
  }

  private createMetric(definition: MetricDefinition): Metric {
    switch (definition.type) {
      case "counter":
        return new CounterMetric(definition);
      case "gauge":
        return new GaugeMetric(definition);
      case "histogram":
        return new HistogramMetric(definition);
      case "summary":
        return new SummaryMetric(definition);
      default:
        throw new UnsupportedMetricTypeError(definition.type);
    }
  }
}
```

### Authentication Metrics

```typescript
class AuthenticationMetricsCollector implements MetricCollector {
  name = "auth_metrics";
  interval = 10000; // 10 seconds

  async collect(): Promise<MetricData[]> {
    const metrics: MetricData[] = [];

    // Authentication success/failure rates
    const authStats = await this.getAuthStats();

    metrics.push({
      name: "auth_attempts_total",
      type: "counter",
      value: authStats.total,
      labels: { result: "total" },
    });

    metrics.push({
      name: "auth_attempts_total",
      type: "counter",
      value: authStats.success,
      labels: { result: "success" },
    });

    metrics.push({
      name: "auth_attempts_total",
      type: "counter",
      value: authStats.failure,
      labels: { result: "failure" },
    });

    // Authentication latency
    const latencyStats = await this.getAuthLatencyStats();
    metrics.push({
      name: "auth_duration_seconds",
      type: "histogram",
      value: latencyStats.p50,
      labels: { quantile: "0.5" },
    });

    metrics.push({
      name: "auth_duration_seconds",
      type: "histogram",
      value: latencyStats.p95,
      labels: { quantile: "0.95" },
    });

    metrics.push({
      name: "auth_duration_seconds",
      type: "histogram",
      value: latencyStats.p99,
      labels: { quantile: "0.99" },
    });

    // Active sessions
    const activeSessions = await this.sessionRepo.countActive();
    metrics.push({
      name: "active_sessions",
      type: "gauge",
      value: activeSessions,
    });

    // Token issuance rate
    const tokenStats = await this.getTokenStats();
    metrics.push({
      name: "tokens_issued_total",
      type: "counter",
      value: tokenStats.issued,
      labels: { type: "access" },
    });

    metrics.push({
      name: "tokens_issued_total",
      type: "counter",
      value: tokenStats.refresh,
      labels: { type: "refresh" },
    });

    return metrics;
  }

  private async getAuthStats(): Promise<AuthStats> {
    // Implementation would query database/cache for auth statistics
    return {
      total: 1250,
      success: 1200,
      failure: 50,
    };
  }

  private async getAuthLatencyStats(): Promise<LatencyStats> {
    // Implementation would calculate percentiles from recent auth operations
    return {
      p50: 0.15,
      p95: 0.45,
      p99: 1.2,
    };
  }

  private async getTokenStats(): Promise<TokenStats> {
    // Implementation would query token issuance statistics
    return {
      issued: 500,
      refresh: 50,
    };
  }
}
```

### System Metrics

```typescript
class SystemMetricsCollector implements MetricCollector {
  name = "system_metrics";
  interval = 15000; // 15 seconds

  async collect(): Promise<MetricData[]> {
    const metrics: MetricData[] = [];

    // Memory usage
    const memUsage = process.memoryUsage();
    metrics.push({
      name: "process_memory_bytes",
      type: "gauge",
      value: memUsage.heapUsed,
      labels: { type: "heap_used" },
    });

    metrics.push({
      name: "process_memory_bytes",
      type: "gauge",
      value: memUsage.heapTotal,
      labels: { type: "heap_total" },
    });

    // CPU usage
    const cpuUsage = await this.getCPUUsage();
    metrics.push({
      name: "process_cpu_usage_percent",
      type: "gauge",
      value: cpuUsage,
    });

    // Event loop lag
    const eventLoopLag = await this.measureEventLoopLag();
    metrics.push({
      name: "event_loop_lag_seconds",
      type: "gauge",
      value: eventLoopLag,
    });

    // Database connection pool
    const dbStats = await this.db.getPoolStats();
    metrics.push({
      name: "db_connections_active",
      type: "gauge",
      value: dbStats.active,
    });

    metrics.push({
      name: "db_connections_idle",
      type: "gauge",
      value: dbStats.idle,
    });

    // Cache hit/miss rates
    const cacheStats = await this.cache.getStats();
    metrics.push({
      name: "cache_requests_total",
      type: "counter",
      value: cacheStats.hits,
      labels: { result: "hit" },
    });

    metrics.push({
      name: "cache_requests_total",
      type: "counter",
      value: cacheStats.misses,
      labels: { result: "miss" },
    });

    // External service health
    const serviceHealth = await this.checkExternalServices();
    for (const [service, healthy] of Object.entries(serviceHealth)) {
      metrics.push({
        name: "external_service_up",
        type: "gauge",
        value: healthy ? 1 : 0,
        labels: { service },
      });
    }

    return metrics;
  }

  private async getCPUUsage(): Promise<number> {
    const startUsage = process.cpuUsage();
    await this.delay(100);
    const endUsage = process.cpuUsage(startUsage);

    const totalUsage = endUsage.user + endUsage.system;
    const totalTime = endUsage.user + endUsage.system; // This is incorrect, but for demo

    return (totalUsage / 1000) * 100; // Convert to percentage
  }

  private async measureEventLoopLag(): Promise<number> {
    const start = process.hrtime.bigint();
    await new Promise((resolve) => setImmediate(resolve));
    const end = process.hrtime.bigint();

    return Number(end - start) / 1e9; // Convert to seconds
  }

  private async checkExternalServices(): Promise<Record<string, boolean>> {
    const services = ["keycloak", "redis", "database", "email_service"];
    const results: Record<string, boolean> = {};

    for (const service of services) {
      try {
        const healthy = await this.healthCheck.checkService(service);
        results[service] = healthy;
      } catch (error) {
        results[service] = false;
      }
    }

    return results;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```

## Alerting System

### Alert Manager

```typescript
class AlertManager {
  private rules = new Map<string, AlertRule>();
  private activeAlerts = new Map<string, Alert>();
  private notifiers = new Map<string, AlertNotifier>();

  registerRule(rule: AlertRule): void {
    this.rules.set(rule.name, rule);
  }

  registerNotifier(notifier: AlertNotifier): void {
    this.notifiers.set(notifier.name, notifier);
  }

  async evaluateRules(): Promise<void> {
    for (const rule of this.rules.values()) {
      try {
        const shouldAlert = await rule.condition();

        if (shouldAlert) {
          await this.fireAlert(rule);
        } else {
          await this.resolveAlert(rule.name);
        }
      } catch (error) {
        this.logger.error("Rule evaluation failed", { rule: rule.name, error });
      }
    }
  }

  private async fireAlert(rule: AlertRule): Promise<void> {
    const existingAlert = this.activeAlerts.get(rule.name);

    if (existingAlert) {
      // Update existing alert
      existingAlert.lastFired = new Date();
      existingAlert.fireCount++;
    } else {
      // Create new alert
      const alert: Alert = {
        id: crypto.randomUUID(),
        rule: rule.name,
        severity: rule.severity,
        message: rule.message,
        description: rule.description,
        firedAt: new Date(),
        lastFired: new Date(),
        fireCount: 1,
        labels: rule.labels || {},
      };

      this.activeAlerts.set(rule.name, alert);

      // Notify all notifiers
      await this.notifyAll(alert);
    }
  }

  private async resolveAlert(ruleName: string): Promise<void> {
    const alert = this.activeAlerts.get(ruleName);
    if (!alert) return;

    alert.resolvedAt = new Date();
    this.activeAlerts.delete(ruleName);

    // Send resolution notification
    await this.notifyAll({
      ...alert,
      severity: "info",
      message: `Resolved: ${alert.message}`,
    });
  }

  private async notifyAll(alert: Alert): Promise<void> {
    await Promise.allSettled(
      Array.from(this.notifiers.values()).map((notifier) =>
        notifier.notify(alert).catch((error) => {
          this.logger.error("Notifier failed", {
            notifier: notifier.name,
            error,
          });
        })
      )
    );
  }

  getActiveAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values());
  }

  getAlertHistory(since: Date): Promise<Alert[]> {
    // Implementation would query alert history from database
    return this.alertRepo.getAlertsSince(since);
  }
}
```

### Alert Rules

```typescript
class AuthAlertRules {
  createRules(): AlertRule[] {
    return [
      {
        name: "high_auth_failure_rate",
        severity: "warning",
        condition: async () => {
          const stats = await this.metrics.getAuthStats();
          const failureRate = stats.failure / stats.total;
          return failureRate > 0.1; // 10% failure rate
        },
        message: "High authentication failure rate detected",
        description: "More than 10% of authentication attempts are failing",
        labels: { component: "authentication" },
      },

      {
        name: "auth_service_down",
        severity: "critical",
        condition: async () => {
          const health = await this.healthCheck.checkService("auth");
          return !health;
        },
        message: "Authentication service is down",
        description: "The authentication service is not responding",
        labels: { component: "authentication", service: "auth" },
      },

      {
        name: "token_issuance_spike",
        severity: "warning",
        condition: async () => {
          const rate = await this.metrics.getTokenIssuanceRate();
          return rate > 1000; // More than 1000 tokens per minute
        },
        message: "Unusual spike in token issuance",
        description: "Token issuance rate is unusually high",
        labels: { component: "tokens" },
      },

      {
        name: "session_exhaustion",
        severity: "error",
        condition: async () => {
          const activeSessions = await this.sessionRepo.countActive();
          const maxSessions = this.config.maxSessions;
          return activeSessions > maxSessions * 0.9; // 90% of max sessions
        },
        message: "Session capacity nearly exhausted",
        description: "Active sessions are approaching the maximum limit",
        labels: { component: "sessions" },
      },
    ];
  }
}

class SystemAlertRules {
  createRules(): AlertRule[] {
    return [
      {
        name: "high_memory_usage",
        severity: "warning",
        condition: async () => {
          const memUsage = process.memoryUsage();
          const usagePercent = memUsage.heapUsed / memUsage.heapTotal;
          return usagePercent > 0.8; // 80% memory usage
        },
        message: "High memory usage detected",
        description: "Memory usage is above 80% of heap size",
        labels: { component: "system", resource: "memory" },
      },

      {
        name: "high_cpu_usage",
        severity: "warning",
        condition: async () => {
          const cpuUsage = await this.getCPUUsage();
          return cpuUsage > 80; // 80% CPU usage
        },
        message: "High CPU usage detected",
        description: "CPU usage is above 80%",
        labels: { component: "system", resource: "cpu" },
      },

      {
        name: "database_connection_pool_exhausted",
        severity: "error",
        condition: async () => {
          const poolStats = await this.db.getPoolStats();
          return poolStats.active >= poolStats.max;
        },
        message: "Database connection pool exhausted",
        description: "All database connections are in use",
        labels: { component: "database", resource: "connections" },
      },

      {
        name: "cache_high_miss_rate",
        severity: "warning",
        condition: async () => {
          const stats = await this.cache.getStats();
          const missRate = stats.misses / (stats.hits + stats.misses);
          return missRate > 0.3; // 30% miss rate
        },
        message: "High cache miss rate detected",
        description: "Cache miss rate is above 30%",
        labels: { component: "cache" },
      },
    ];
  }
}
```

## Alert Notifiers

```typescript
class SlackNotifier implements AlertNotifier {
  name = "slack";

  async notify(alert: Alert): Promise<void> {
    const color = this.getColorForSeverity(alert.severity);
    const emoji = this.getEmojiForSeverity(alert.severity);

    const message = {
      channel: this.config.channel,
      attachments: [
        {
          color,
          title: `${emoji} ${alert.message}`,
          text: alert.description,
          fields: [
            {
              title: "Severity",
              value: alert.severity.toUpperCase(),
              short: true,
            },
            {
              title: "Rule",
              value: alert.rule,
              short: true,
            },
            {
              title: "Fired At",
              value: alert.firedAt.toISOString(),
              short: true,
            },
          ],
          footer: "Auth Service Monitoring",
          ts: Math.floor(alert.firedAt.getTime() / 1000),
        },
      ],
    };

    await this.slack.webhook.send(message);
  }

  private getColorForSeverity(severity: AlertSeverity): string {
    switch (severity) {
      case "critical":
        return "danger";
      case "error":
        return "danger";
      case "warning":
        return "warning";
      case "info":
        return "good";
      default:
        return "#808080";
    }
  }

  private getEmojiForSeverity(severity: AlertSeverity): string {
    switch (severity) {
      case "critical":
        return "🚨";
      case "error":
        return "❌";
      case "warning":
        return "⚠️";
      case "info":
        return "ℹ️";
      default:
        return "📢";
    }
  }
}

class EmailNotifier implements AlertNotifier {
  name = "email";

  async notify(alert: Alert): Promise<void> {
    const subject = `[${alert.severity.toUpperCase()}] ${alert.message}`;
    const html = this.renderEmailTemplate(alert);

    await this.email.send({
      to: this.config.recipients,
      subject,
      html,
      priority: this.getEmailPriority(alert.severity),
    });
  }

  private renderEmailTemplate(alert: Alert): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: ${this.getColorForSeverity(alert.severity)};">
          ${alert.message}
        </h2>

        <p><strong>Description:</strong> ${alert.description}</p>

        <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <p><strong>Severity:</strong> ${alert.severity.toUpperCase()}</p>
          <p><strong>Rule:</strong> ${alert.rule}</p>
          <p><strong>Fired At:</strong> ${alert.firedAt.toISOString()}</p>
          <p><strong>Fire Count:</strong> ${alert.fireCount}</p>
        </div>

        ${
          alert.labels
            ? `
          <h3>Labels:</h3>
          <ul>
            ${Object.entries(alert.labels)
              .map(
                ([key, value]) => `<li><strong>${key}:</strong> ${value}</li>`
              )
              .join("")}
          </ul>
        `
            : ""
        }

        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">

        <p style="color: #666; font-size: 12px;">
          This alert was generated by the Authentication Service monitoring system.
        </p>
      </div>
    `;
  }

  private getColorForSeverity(severity: AlertSeverity): string {
    switch (severity) {
      case "critical":
        return "#dc3545";
      case "error":
        return "#dc3545";
      case "warning":
        return "#ffc107";
      case "info":
        return "#17a2b8";
      default:
        return "#6c757d";
    }
  }

  private getEmailPriority(severity: AlertSeverity): "high" | "normal" | "low" {
    switch (severity) {
      case "critical":
        return "high";
      case "error":
        return "high";
      case "warning":
        return "normal";
      case "info":
        return "low";
      default:
        return "normal";
    }
  }
}

class PagerDutyNotifier implements AlertNotifier {
  name = "pagerduty";

  async notify(alert: Alert): Promise<void> {
    const event = {
      routing_key: this.config.routingKey,
      event_action: alert.resolvedAt ? "resolve" : "trigger",
      dedup_key: alert.id,
      payload: {
        summary: alert.message,
        severity: this.mapSeverity(alert.severity),
        source: "auth-service",
        component: alert.labels?.component || "authentication",
        group: alert.labels?.service || "auth",
        class: alert.rule,
        custom_details: {
          description: alert.description,
          fireCount: alert.fireCount,
          labels: alert.labels,
        },
      },
    };

    await this.pagerduty.sendEvent(event);
  }

  private mapSeverity(
    severity: AlertSeverity
  ): "critical" | "error" | "warning" | "info" {
    switch (severity) {
      case "critical":
        return "critical";
      case "error":
        return "error";
      case "warning":
        return "warning";
      case "info":
        return "info";
      default:
        return "warning";
    }
  }
}
```

## Logging and Tracing

### Structured Logging

```typescript
class StructuredLogger {
  private loggers = new Map<string, Logger>();
  private processors = new Set<LogProcessor>();

  constructor(private config: LoggingConfig) {
    this.initializeLoggers();
  }

  async log(
    level: LogLevel,
    message: string,
    context?: LogContext
  ): Promise<void> {
    const logEntry = this.createLogEntry(level, message, context);

    // Process log entry
    for (const processor of this.processors) {
      try {
        await processor.process(logEntry);
      } catch (error) {
        // Don't let processor errors break logging
        console.error("Log processor failed:", error);
      }
    }

    // Send to appropriate loggers
    const applicableLoggers = this.getApplicableLoggers(level);
    await Promise.allSettled(
      applicableLoggers.map((logger) => logger.log(logEntry))
    );
  }

  async error(
    message: string,
    error?: Error,
    context?: LogContext
  ): Promise<void> {
    const errorContext = {
      ...context,
      error: error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
          }
        : undefined,
    };

    await this.log("error", message, errorContext);
  }

  async warn(message: string, context?: LogContext): Promise<void> {
    await this.log("warn", message, context);
  }

  async info(message: string, context?: LogContext): Promise<void> {
    await this.log("info", message, context);
  }

  async debug(message: string, context?: LogContext): Promise<void> {
    await this.log("debug", message, context);
  }

  addProcessor(processor: LogProcessor): void {
    this.processors.add(processor);
  }

  removeProcessor(processor: LogProcessor): void {
    this.processors.delete(processor);
  }

  private createLogEntry(
    level: LogLevel,
    message: string,
    context?: LogContext
  ): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: {
        ...context,
        service: "auth-service",
        version: this.config.version,
        environment: this.config.environment,
        hostname: os.hostname(),
        pid: process.pid,
      },
    };
  }

  private getApplicableLoggers(level: LogLevel): Logger[] {
    const levelPriority = { error: 0, warn: 1, info: 2, debug: 3 };
    const minLevel = levelPriority[this.config.level];

    return Array.from(this.loggers.values()).filter(
      (logger) => levelPriority[logger.level] <= minLevel
    );
  }

  private initializeLoggers(): void {
    // Console logger
    this.loggers.set("console", new ConsoleLogger("info"));

    // File logger
    if (this.config.file) {
      this.loggers.set("file", new FileLogger(this.config.file.path, "debug"));
    }

    // Remote logger
    if (this.config.remote) {
      this.loggers.set(
        "remote",
        new RemoteLogger(this.config.remote.endpoint, "warn")
      );
    }
  }
}
```

### Distributed Tracing

```typescript
class TracingManager {
  private tracer: Tracer;
  private spans = new Map<string, Span>();

  constructor(private config: TracingConfig) {
    this.tracer = this.initializeTracer();
  }

  startSpan(name: string, options: SpanOptions = {}): Span {
    const span = this.tracer.startSpan(name, {
      ...options,
      attributes: {
        service: "auth-service",
        version: this.config.version,
        ...options.attributes,
      },
    });

    if (options.childOf) {
      span.setParent(options.childOf);
    }

    this.spans.set(span.context().spanId, span);
    return span;
  }

  getCurrentSpan(): Span | undefined {
    // Implementation would get span from async context
    return this.getSpanFromContext();
  }

  async wrapWithSpan<T>(
    name: string,
    fn: (span: Span) => Promise<T>,
    options: SpanOptions = {}
  ): Promise<T> {
    const span = this.startSpan(name, options);

    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      span.recordException(error);
      throw error;
    } finally {
      span.end();
    }
  }

  injectContext(carrier: any, format: SpanContextFormat): void {
    const span = this.getCurrentSpan();
    if (span) {
      this.tracer.inject(span.context(), format, carrier);
    }
  }

  extractContext(
    carrier: any,
    format: SpanContextFormat
  ): SpanContext | undefined {
    return this.tracer.extract(format, carrier);
  }

  private initializeTracer(): Tracer {
    // Initialize OpenTelemetry tracer
    return trace.getTracer("auth-service", this.config.version);
  }

  private getSpanFromContext(): Span | undefined {
    // Implementation would use async local storage to get current span
    return this.asyncLocalStorage.getStore()?.span;
  }
}
```

## Health Checks

### Health Check Manager

```typescript
class HealthCheckManager {
  private checks = new Map<string, HealthCheck>();
  private results = new Map<string, HealthCheckResult>();

  registerCheck(name: string, check: HealthCheck): void {
    this.checks.set(name, check);
  }

  async runAllChecks(): Promise<HealthStatus> {
    const results = await Promise.allSettled(
      Array.from(this.checks.entries()).map(async ([name, check]) => {
        try {
          const result = await check.execute();
          this.results.set(name, result);
          return { name, result };
        } catch (error) {
          const failedResult: HealthCheckResult = {
            status: "unhealthy",
            timestamp: new Date(),
            duration: 0,
            error: error.message,
          };
          this.results.set(name, failedResult);
          return { name, result: failedResult };
        }
      })
    );

    const overallStatus = this.calculateOverallStatus(results);
    const summary = {
      status: overallStatus,
      timestamp: new Date(),
      checks: results.map((r) =>
        r.status === "fulfilled"
          ? r.value
          : {
              name: "unknown",
              result: {
                status: "unhealthy",
                timestamp: new Date(),
                duration: 0,
              },
            }
      ),
    };

    return summary;
  }

  async runCheck(name: string): Promise<HealthCheckResult> {
    const check = this.checks.get(name);
    if (!check) {
      throw new CheckNotFoundError(name);
    }

    const startTime = Date.now();
    try {
      const result = await check.execute();
      const duration = Date.now() - startTime;

      const fullResult: HealthCheckResult = {
        ...result,
        duration,
      };

      this.results.set(name, fullResult);
      return fullResult;
    } catch (error) {
      const duration = Date.now() - startTime;
      const failedResult: HealthCheckResult = {
        status: "unhealthy",
        timestamp: new Date(),
        duration,
        error: error.message,
      };

      this.results.set(name, failedResult);
      return failedResult;
    }
  }

  getCheckResult(name: string): HealthCheckResult | undefined {
    return this.results.get(name);
  }

  getAllResults(): Map<string, HealthCheckResult> {
    return new Map(this.results);
  }

  private calculateOverallStatus(
    results: PromiseSettledResult<any>[]
  ): HealthStatusType {
    const hasFailure = results.some(
      (result) =>
        result.status === "rejected" ||
        (result.status === "fulfilled" &&
          result.value.result.status !== "healthy")
    );

    return hasFailure ? "unhealthy" : "healthy";
  }
}
```

### Built-in Health Checks

```typescript
class DatabaseHealthCheck implements HealthCheck {
  name = "database";

  async execute(): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      // Test basic connectivity
      await this.db.execute("SELECT 1");

      // Test connection pool
      const poolStats = await this.db.getPoolStats();

      // Check if pool has available connections
      if (poolStats.idle === 0 && poolStats.active >= poolStats.max) {
        return {
          status: "degraded",
          timestamp: new Date(),
          duration: Date.now() - startTime,
          message: "Database connection pool exhausted",
        };
      }

      return {
        status: "healthy",
        timestamp: new Date(),
        duration: Date.now() - startTime,
        details: {
          activeConnections: poolStats.active,
          idleConnections: poolStats.idle,
          totalConnections: poolStats.total,
        },
      };
    } catch (error) {
      return {
        status: "unhealthy",
        timestamp: new Date(),
        duration: Date.now() - startTime,
        error: error.message,
      };
    }
  }
}

class CacheHealthCheck implements HealthCheck {
  name = "cache";

  async execute(): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      // Test basic set/get
      const testKey = `health_check_${Date.now()}`;
      const testValue = "ok";

      await this.cache.set(testKey, testValue, 10);
      const retrieved = await this.cache.get(testKey);

      if (retrieved !== testValue) {
        return {
          status: "unhealthy",
          timestamp: new Date(),
          duration: Date.now() - startTime,
          message: "Cache set/get test failed",
        };
      }

      // Clean up test key
      await this.cache.delete(testKey);

      // Get cache statistics
      const stats = await this.cache.getStats();

      return {
        status: "healthy",
        timestamp: new Date(),
        duration: Date.now() - startTime,
        details: {
          hitRate: stats.hitRate,
          totalRequests: stats.hits + stats.misses,
          connected: stats.connected,
        },
      };
    } catch (error) {
      return {
        status: "unhealthy",
        timestamp: new Date(),
        duration: Date.now() - startTime,
        error: error.message,
      };
    }
  }
}

class ExternalServiceHealthCheck implements HealthCheck {
  constructor(private serviceName: string, private endpoint: string) {
    this.name = `${serviceName}_health`;
  }

  async execute(): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      const response = await fetch(`${this.endpoint}/health`, {
        timeout: 5000,
        headers: {
          "User-Agent": "Auth-Service-Health-Check",
        },
      });

      if (!response.ok) {
        return {
          status: "unhealthy",
          timestamp: new Date(),
          duration: Date.now() - startTime,
          message: `Health check returned ${response.status}`,
        };
      }

      const healthData = await response.json();

      return {
        status: healthData.status === "healthy" ? "healthy" : "degraded",
        timestamp: new Date(),
        duration: Date.now() - startTime,
        details: healthData,
      };
    } catch (error) {
      return {
        status: "unhealthy",
        timestamp: new Date(),
        duration: Date.now() - startTime,
        error: error.message,
      };
    }
  }
}
```

## Dashboards and Visualization

### Metrics Dashboard

```typescript
class MetricsDashboard {
  private panels = new Map<string, DashboardPanel>();

  registerPanel(panel: DashboardPanel): void {
    this.panels.set(panel.id, panel);
  }

  async renderDashboard(timeRange: TimeRange): Promise<DashboardData> {
    const panels = await Promise.all(
      Array.from(this.panels.values()).map((panel) =>
        this.renderPanel(panel, timeRange)
      )
    );

    return {
      title: "Authentication Service Metrics",
      timeRange,
      panels,
      generatedAt: new Date(),
    };
  }

  private async renderPanel(
    panel: DashboardPanel,
    timeRange: TimeRange
  ): Promise<RenderedPanel> {
    const data = await panel.dataSource.getData(timeRange);

    return {
      id: panel.id,
      title: panel.title,
      type: panel.type,
      data,
      config: panel.config,
    };
  }

  getAvailablePanels(): DashboardPanel[] {
    return Array.from(this.panels.values());
  }
}

// Example dashboard panels
const authSuccessRatePanel: DashboardPanel = {
  id: "auth_success_rate",
  title: "Authentication Success Rate",
  type: "line_chart",
  dataSource: {
    getData: async (timeRange) => {
      const metrics = await this.metrics.getAuthMetrics(timeRange);
      return metrics.map((m) => ({
        timestamp: m.timestamp,
        value: m.success / m.total,
      }));
    },
  },
  config: {
    yAxis: { label: "Success Rate", format: "percentage" },
    color: "#10b981",
  },
};

const activeSessionsPanel: DashboardPanel = {
  id: "active_sessions",
  title: "Active Sessions",
  type: "area_chart",
  dataSource: {
    getData: async (timeRange) => {
      const metrics = await this.metrics.getSessionMetrics(timeRange);
      return metrics.map((m) => ({
        timestamp: m.timestamp,
        value: m.activeSessions,
      }));
    },
  },
  config: {
    yAxis: { label: "Active Sessions" },
    color: "#3b82f6",
  },
};

const errorRatePanel: DashboardPanel = {
  id: "error_rate",
  title: "Error Rate by Component",
  type: "stacked_bar_chart",
  dataSource: {
    getData: async (timeRange) => {
      const errorMetrics = await this.metrics.getErrorMetrics(timeRange);
      return errorMetrics.map((m) => ({
        timestamp: m.timestamp,
        auth: m.authErrors,
        database: m.dbErrors,
        cache: m.cacheErrors,
        external: m.externalErrors,
      }));
    },
  },
  config: {
    yAxis: { label: "Error Count" },
    stack: true,
  },
};
```

This completes the comprehensive monitoring and observability documentation for the authentication library, covering metrics collection, alerting, logging, tracing, health checks, and dashboards.
