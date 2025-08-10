# Monitoring & Observability Guide

## Overview

This document outlines the comprehensive monitoring and observability strategy for the **Elysia-based Cart Recovery Platform**. It covers monitoring for the 4 Elysia services and 8 shared libraries using the three pillars of observability (metrics, logs, traces), with specific focus on Elysia performance characteristics and shared library integration patterns.

## Architecture

### The Three Pillars of Observability for Elysia Services

```
┌─────────────────────────────────────────────────────────────────────┐
│                Elysia Services Observability Stack                 │
├─────────────────┬───────────────────┬─────────────────────────────────┤
│     Metrics     │      Traces       │             Logs               │
│                 │                   │                                │
│• Prometheus     │• OpenTelemetry    │• ELK Stack (Elasticsearch)     │
│• Grafana        │• Jaeger           │• @libs/monitoring integration   │
│• @libs/monitoring│• Correlation IDs  │• Structured JSON logging       │
│• Elysia metrics │• Service-to-service│• Shared library logs          │
│• WebSocket metrics│ tracing          │                                │
│                 │                   │                                │
│Services:        │Cross-service:     │Library-specific:               │
│• api-gateway    │• API Gateway →    │• @libs/auth events            │
│• ingestion      │  downstream       │• @libs/database queries       │
│• prediction     │• Event processing │• @libs/messaging patterns     │
│• ai-engine      │• ML pipeline      │• @libs/monitoring metrics     │
└─────────────────┴───────────────────┴─────────────────────────────────┘
```

### Monitoring Infrastructure for Elysia Architecture
- **Metrics**: Prometheus + Grafana integrated with @libs/monitoring
- **Tracing**: OpenTelemetry + Jaeger with Elysia service correlation
- **Logging**: ELK Stack + @libs/monitoring Logger for structured logs
- **Alerting**: AlertManager + PagerDuty for incident management
- **Health Checks**: Multi-level health checks using shared library patterns
- **WebSocket Monitoring**: Real-time connection tracking via @libs/messaging
- **Shared Library Metrics**: Individual library performance tracking

## Service Level Indicators (SLIs)

### API Gateway Service SLIs (Elysia Main Entry Point)
```yaml
slis:
  availability:
    name: "API Gateway Availability"
    description: "Percentage of successful HTTP requests to main gateway"
    query: |
      (
        sum(rate(http_requests_total{service="api-gateway",status!~"5.."}[5m])) /
        sum(rate(http_requests_total{service="api-gateway"}[5m]))
      ) * 100
    threshold: "> 99.95%"
    
  latency:
    name: "Elysia API Response Time P95"
    description: "95th percentile API response time (Elysia optimized)"
    query: |
      histogram_quantile(0.95,
        rate(http_request_duration_seconds_bucket{service="api-gateway",framework="elysia"}[5m])
      ) * 1000
    threshold: "< 50ms"  # Lower threshold due to Elysia efficiency
    
  websocket_connections:
    name: "WebSocket Connection Health"
    description: "Number of active WebSocket connections"
    query: |
      websocket_active_connections{service="api-gateway"}
    threshold: "> 0 and < 10000"
    
  auth_success_rate:
    name: "JWT Authentication Success Rate (@libs/auth)"
    description: "Percentage of successful authentications"
    query: |
      (
        sum(rate(auth_attempts_total{result="success"}[5m])) /
        sum(rate(auth_attempts_total[5m]))
      ) * 100
    threshold: "> 99%"
    
  downstream_service_health:
    name: "Downstream Service Availability"
    description: "Health of ingestion, prediction, ai-engine services"
    query: |
      min(
        up{service=~"ingestion|prediction|ai-engine"}
      )
    threshold: "== 1"
```

### Ingestion Service SLIs (Event Processing)
```yaml
slis:
  ingestion_rate:
    name: "Event Ingestion Rate"
    description: "Events ingested per second by Elysia ingestion service"
    query: |
      sum(rate(events_ingested_total{service="ingestion"}[5m]))
    threshold: "> 10000 events/sec"
    
  processing_latency:
    name: "Event Processing Latency P95"
    description: "95th percentile event processing time using @libs/models validation"
    query: |
      histogram_quantile(0.95,
        rate(event_processing_duration_seconds_bucket{service="ingestion"}[5m])
      ) * 1000
    threshold: "< 5ms"  # Improved with Elysia performance
    
  websocket_event_rate:
    name: "WebSocket Event Processing Rate"
    description: "Events received via WebSocket using @libs/messaging"
    query: |
      sum(rate(websocket_events_received_total{service="ingestion"}[5m]))
    threshold: "> 5000 events/sec"
    
  validation_success_rate:
    name: "Event Validation Success Rate (@libs/models)"
    description: "Percentage of events passing validation"
    query: |
      (
        sum(rate(events_validated_total{result="success",service="ingestion"}[5m])) /
        sum(rate(events_validated_total{service="ingestion"}[5m]))
      ) * 100
    threshold: "> 98%"
    
  database_write_latency:
    name: "Database Write Latency (@libs/database)"
    description: "95th percentile database write time"
    query: |
      histogram_quantile(0.95,
        rate(database_operation_duration_seconds_bucket{operation="write",client="ingestion"}[5m])
      ) * 1000
    threshold: "< 10ms"
```

### Prediction & AI Engine Services SLIs
```yaml
slis:
  prediction_latency:
    name: "ML Prediction Latency P95"
    description: "95th percentile prediction response time"
    query: |
      histogram_quantile(0.95,
        rate(ml_prediction_duration_seconds_bucket{service=~"prediction|ai-engine"}[5m])
      ) * 1000
    threshold: "< 30ms"  # Improved with Elysia efficiency
    
  model_accuracy:
    name: "Model Prediction Accuracy"
    description: "Percentage of accurate predictions"
    query: |
      (
        sum(ml_predictions_correct_total{service=~"prediction|ai-engine"}[24h]) /
        sum(ml_predictions_total{service=~"prediction|ai-engine"}[24h])
      ) * 100
    threshold: "> 85%"
    
  feature_extraction_rate:
    name: "Feature Extraction Rate"
    description: "Features extracted per second using @libs/models"
    query: |
      sum(rate(features_extracted_total{service="prediction"}[5m]))
    threshold: "> 1000 features/sec"
    
  cache_hit_ratio:
    name: "Prediction Cache Hit Rate (@libs/database Redis)"
    description: "Percentage of cache hits for predictions"
    query: |
      (
        sum(rate(redis_cache_hits_total{cache_type="predictions"}[5m])) /
        sum(rate(redis_cache_requests_total{cache_type="predictions"}[5m]))
      ) * 100
    threshold: "> 80%"
    
  shared_library_health:
    name: "Shared Libraries Health"
    description: "Health status of @libs/* dependencies"
    query: |
      min(
        library_health_status{library=~"auth|database|models|utils|monitoring"}
      )
    threshold: "== 1"
```

## Service Level Objectives (SLOs)

### Production SLO Targets for Elysia Services
```yaml
slos:
  availability:
    target: "99.97%"  # Higher target due to Elysia reliability
    measurement_window: "30d"
    error_budget: "0.03%" # ~13 minutes per month
    
  latency:
    p95_target: "50ms"   # Lower target due to Elysia performance
    p99_target: "150ms"  # Improved from theoretical targets
    measurement_window: "24h"
    websocket_latency: "< 10ms"  # Real-time requirement
    
  throughput:
    api_gateway: "25000 req/sec"
    ingestion: "50000 events/sec" 
    prediction: "10000 predictions/sec"
    ai_engine: "5000 inferences/sec"
    measurement_window: "5m"
    
  shared_library_performance:
    auth_latency: "< 5ms"        # @libs/auth JWT validation
    database_query: "< 10ms"     # @libs/database operations
    websocket_message: "< 2ms"   # @libs/messaging throughput
    measurement_window: "5m"
    
  data_freshness:
    event_processing: "< 1 minute"   # Improved with Elysia
    ml_features: "< 30 seconds"
    websocket_data: "< 1 second"     # Real-time requirement
    measurement_window: "1h"
```

### Error Budget Policy
```yaml
error_budget_policy:
  budget_consumption_fast: # >2% of budget in 1 hour
    actions:
      - "Page on-call engineer"
      - "Stop non-critical deployments"
      - "Escalate to senior engineer"
      
  budget_consumption_medium: # >5% of budget in 6 hours  
    actions:
      - "Notify team via Slack"
      - "Review recent changes"
      - "Consider rollback"
      
  budget_exhausted: # 100% budget consumed
    actions:
      - "Emergency response activated"
      - "Stop all deployments"
      - "Focus only on reliability"
      - "Executive notification"
```

## Metrics Collection

### Elysia Services Application Metrics
```typescript
// Prometheus metrics definitions integrated with @libs/monitoring
import { MetricsCollector } from '@libs/monitoring';

export class ElysiaMetricsService extends MetricsCollector {
  // Elysia HTTP request metrics
  httpRequestsTotal = new prometheus.Counter({
    name: 'elysia_http_requests_total',
    help: 'Total HTTP requests handled by Elysia services',
    labelNames: ['method', 'route', 'status_code', 'service', 'framework']
  });

  httpRequestDuration = new prometheus.Histogram({
    name: 'elysia_http_request_duration_seconds',
    help: 'Elysia HTTP request duration in seconds',
    labelNames: ['method', 'route', 'service', 'framework'],
    buckets: [0.001, 0.002, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1]  // Optimized for Elysia performance
  });

  // WebSocket metrics using @libs/messaging
  websocketConnections = new prometheus.Gauge({
    name: 'elysia_websocket_connections_active',
    help: 'Active WebSocket connections',
    labelNames: ['service', 'room', 'connection_type']
  });

  websocketMessages = new prometheus.Counter({
    name: 'elysia_websocket_messages_total',
    help: 'Total WebSocket messages processed',
    labelNames: ['service', 'message_type', 'direction']
  });

  // Shared library metrics
  authOperations = new prometheus.Counter({
    name: 'libs_auth_operations_total',
    help: 'Total authentication operations using @libs/auth',
    labelNames: ['operation', 'result', 'user_role']
  });

  databaseOperations = new prometheus.Counter({
    name: 'libs_database_operations_total',
    help: 'Total database operations using @libs/database',
    labelNames: ['client_type', 'operation', 'result']  // redis, postgres, clickhouse
  });

  // Business metrics
  eventsIngested = new prometheus.Counter({
    name: 'elysia_events_ingested_total',
    help: 'Total events ingested by ingestion service',
    labelNames: ['event_type', 'source', 'store_id', 'validation_result']
  });

  predictionsGenerated = new prometheus.Counter({
    name: 'elysia_ml_predictions_total',
    help: 'Total ML predictions generated',
    labelNames: ['service', 'model_version', 'prediction_type', 'store_id']
  });

  // Service-to-service communication metrics
  serviceRequests = new prometheus.Counter({
    name: 'elysia_service_requests_total',
    help: 'Requests between Elysia services',
    labelNames: ['from_service', 'to_service', 'endpoint', 'status']
  });

  // Shared library performance metrics
  libraryOperationDuration = new prometheus.Histogram({
    name: 'elysia_library_operation_duration_seconds',
    help: 'Duration of shared library operations',
    labelNames: ['library', 'operation', 'service'],
    buckets: [0.001, 0.002, 0.005, 0.01, 0.025, 0.05, 0.1]
  });

  // Circuit breaker metrics (@libs/utils)
  circuitBreakerState = new prometheus.Gauge({
    name: 'elysia_circuit_breaker_state',
    help: 'Circuit breaker state (0=closed, 1=open, 2=half-open)',
    labelNames: ['service', 'target_service', 'breaker_name']
  });

  // Health check metrics
  healthCheckDuration = new prometheus.Histogram({
    name: 'elysia_health_check_duration_seconds',
    help: 'Duration of health checks',
    labelNames: ['service', 'check_type', 'dependency']
  });

  // Resource metrics optimized for Node.js/Elysia
  nodeMemoryUsage = new prometheus.Gauge({
    name: 'elysia_node_memory_usage_bytes',
    help: 'Node.js memory usage in bytes',
    labelNames: ['service', 'type'] // rss, heapUsed, heapTotal, external
  });

  eventLoopLag = new prometheus.Gauge({
    name: 'elysia_event_loop_lag_seconds',
    help: 'Node.js event loop lag in seconds',
    labelNames: ['service']
  });

  // pnpm workspace build metrics
  buildMetrics = new prometheus.Counter({
    name: 'elysia_build_operations_total',
    help: 'pnpm workspace build operations',
    labelNames: ['workspace', 'operation', 'result']  // @apps/*, @libs/*
  });
}
```

### Custom Business Metrics
```typescript
// Business-specific metrics
export class BusinessMetricsService {
  // Revenue tracking
  revenueRecovered = new prometheus.Counter({
    name: 'revenue_recovered_dollars_total',
    help: 'Total revenue recovered through interventions',
    labelNames: ['store_id', 'intervention_type', 'currency']
  });

  cartAbandonmentRate = new prometheus.Gauge({
    name: 'cart_abandonment_rate_percentage',
    help: 'Cart abandonment rate percentage',
    labelNames: ['store_id', 'time_window']
  });

  conversionRate = new prometheus.Gauge({
    name: 'conversion_rate_percentage', 
    help: 'Conversion rate percentage',
    labelNames: ['store_id', 'traffic_source', 'user_segment']
  });

  // Customer engagement
  emailOpenRate = new prometheus.Gauge({
    name: 'email_open_rate_percentage',
    help: 'Email open rate percentage',
    labelNames: ['campaign_id', 'store_id', 'segment']
  });

  clickThroughRate = new prometheus.Gauge({
    name: 'click_through_rate_percentage',
    help: 'Click through rate percentage', 
    labelNames: ['channel', 'content_type', 'store_id']
  });

  // Model performance
  modelAccuracy = new prometheus.Gauge({
    name: 'model_accuracy_percentage',
    help: 'ML model accuracy percentage',
    labelNames: ['model_name', 'version', 'dataset']
  });

  featureDrift = new prometheus.Gauge({
    name: 'feature_drift_score',
    help: 'Feature drift score (KL divergence)',
    labelNames: ['feature_name', 'model_version']
  });

  async recordBusinessMetrics(storeId: string): Promise<void> {
    // Calculate and record business metrics
    const stats = await this.analyticsService.getStoreStats(storeId);
    
    this.cartAbandonmentRate
      .labels({ store_id: storeId, time_window: '24h' })
      .set(stats.abandonmentRate);

    this.conversionRate
      .labels({ store_id: storeId, traffic_source: 'all', user_segment: 'all' })
      .set(stats.conversionRate);

    this.revenueRecovered
      .labels({ store_id: storeId, intervention_type: 'email', currency: 'USD' })
      .inc(stats.emailRecoveredRevenue);
  }
}
```

## Distributed Tracing for Elysia Services

### OpenTelemetry Configuration with Shared Libraries
```typescript
// @libs/monitoring/tracing/tracer.ts
import { NodeTracerProvider } from '@opentelemetry/sdk-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { Logger } from '@libs/monitoring';

export class ElysiaTracingService {
  private provider: NodeTracerProvider;
  private logger = new Logger('tracing');

  init(serviceName: string, serviceVersion: string) {
    this.provider = new NodeTracerProvider({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
        [SemanticResourceAttributes.SERVICE_VERSION]: serviceVersion,
        [SemanticResourceAttributes.SERVICE_NAMESPACE]: 'elysia-cart-recovery',
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV,
        'framework.name': 'elysia',
        'framework.version': '1.3.8',
        'workspace.type': 'pnpm-monorepo'
      })
    });

    // Configure Jaeger exporter
    const jaegerExporter = new JaegerExporter({
      endpoint: process.env.JAEGER_ENDPOINT || 'http://jaeger:14268/api/traces'
    });

    this.provider.addSpanProcessor(
      new BatchSpanProcessor(jaegerExporter, {
        maxQueueSize: 1000,
        maxExportBatchSize: 100,
        scheduledDelayMillis: 5000
      })
    );

    this.provider.register();
  }

  // Trace Elysia service operations with shared library integration
  async traceCartProcessing(cartId: string, operation: () => Promise<any>) {
    const tracer = trace.getTracer('elysia-cart-processing');
    
    return tracer.startActiveSpan(`cart.${operation.name}`, {
      attributes: {
        'cart.id': cartId,
        'cart.operation': operation.name,
        'service.name': 'ingestion',
        'framework': 'elysia',
        'libraries.used': '@libs/models,@libs/database,@libs/messaging'
      }
    }, async (span) => {
      try {
        const startTime = performance.now();
        const result = await operation();
        const duration = performance.now() - startTime;
        
        span.setAttributes({
          'cart.items_count': result.itemsCount,
          'cart.total_value': result.totalValue,
          'operation.success': true,
          'operation.duration_ms': duration,
          'validation.library': '@libs/models',
          'database.client': '@libs/database'
        });
        
        this.logger.logCartEvent({
          cartId,
          eventType: operation.name,
          processingTime: duration
        });
        
        return result;
      } catch (error) {
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
        this.logger.error('Cart processing failed', error, { cartId, operation: operation.name });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  // Trace shared library operations
  async traceLibraryOperation<T>(libraryName: string, operation: string, fn: () => Promise<T>): Promise<T> {
    const tracer = trace.getTracer(`libs-${libraryName}`);
    
    return tracer.startActiveSpan(`${libraryName}.${operation}`, {
      attributes: {
        'library.name': `@libs/${libraryName}`,
        'library.operation': operation,
        'framework': 'elysia'
      }
    }, async (span) => {
      const startTime = performance.now();
      try {
        const result = await fn();
        const duration = performance.now() - startTime;
        
        span.setAttributes({
          'operation.success': true,
          'operation.duration_ms': duration
        });
        
        return result;
      } catch (error) {
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  // Trace ML predictions across prediction/ai-engine services
  async tracePrediction(cartId: string, modelVersion: string, prediction: () => Promise<any>) {
    const tracer = trace.getTracer('elysia-ml-engine');
    
    return tracer.startActiveSpan('ml.predict', {
      attributes: {
        'ml.cart_id': cartId,
        'ml.model_version': modelVersion,
        'ml.model_type': 'cart_recovery',
        'service.name': 'prediction',
        'framework': 'elysia',
        'libraries.used': '@libs/models,@libs/database,@libs/utils'
      }
    }, async (span) => {
      const startTime = performance.now();
      
      try {
        const result = await prediction();
        const inferenceTime = performance.now() - startTime;
        
        span.setAttributes({
          'ml.prediction_probability': result.probability,
          'ml.prediction_confidence': result.confidence,
          'ml.features_count': Object.keys(result.features).length,
          'ml.inference_time_ms': inferenceTime,
          'cache.hit': result.fromCache ? 'true' : 'false',
          'cache.client': '@libs/database.redis'
        });
        
        // Log using shared monitoring library
        this.logger.logMLPrediction(result, { inferenceTime });
        
        return result;
      } catch (error) {
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR });
        this.logger.error('ML prediction failed', error, { cartId, modelVersion });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  // Trace service-to-service communication
  async traceServiceCall(fromService: string, toService: string, endpoint: string, call: () => Promise<any>) {
    const tracer = trace.getTracer('elysia-service-mesh');
    
    return tracer.startActiveSpan(`${fromService}->${toService}`, {
      attributes: {
        'service.from': fromService,
        'service.to': toService,
        'http.endpoint': endpoint,
        'framework': 'elysia'
      }
    }, async (span) => {
      const startTime = performance.now();
      try {
        const result = await call();
        const duration = performance.now() - startTime;
        
        span.setAttributes({
          'http.status_code': result.status || 200,
          'operation.success': true,
          'operation.duration_ms': duration
        });
        
        return result;
      } catch (error) {
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    });
  }
}
```

### Correlation ID Propagation in Elysia Services
```typescript
// @libs/monitoring/middleware/correlation.middleware.ts
import { Elysia } from 'elysia';
import { randomUUID } from 'crypto';
import { trace } from '@opentelemetry/api';

export class ElysiaCorrelationMiddleware {
  // Elysia middleware plugin
  plugin() {
    return new Elysia()
      .onRequest(({ request, set }) => {
        // Generate or extract correlation ID
        const correlationId = request.headers.get('x-correlation-id') || 
                             request.headers.get('x-request-id') ||
                             randomUUID();

        // Store in context for this request
        (request as any).correlationId = correlationId;
        
        // Add to response headers
        set.headers = {
          ...set.headers,
          'x-correlation-id': correlationId
        };

        // Add to OpenTelemetry span
        const span = trace.getActiveSpan();
        if (span) {
          span.setAttributes({
            'request.correlation_id': correlationId,
            'request.path': new URL(request.url).pathname,
            'request.method': request.method,
            'request.user_agent': request.headers.get('user-agent') || 'unknown',
            'service.framework': 'elysia'
          });
        }
      })
      .onError(({ error, request }) => {
        const correlationId = (request as any).correlationId;
        console.error('Request failed', {
          correlationId,
          error: error.message,
          stack: error.stack
        });
      });
  }
}

// Service-to-service propagation for Elysia services
export class ElysiaHttpClient {
  constructor(private serviceName: string) {}

  async request(url: string, options: RequestInit = {}) {
    // Extract correlation ID from current request context
    const correlationId = trace.getActiveSpan()?.getContext()?.traceId || randomUUID();
    
    const headers = {
      ...options.headers,
      'x-correlation-id': correlationId,
      'x-service-name': this.serviceName,
      'x-framework': 'elysia',
      'x-workspace': 'pnpm-monorepo'
    };

    // Inject OpenTelemetry context for distributed tracing
    const activeContext = trace.setSpanContext(
      context.active(), 
      trace.getActiveSpan()?.spanContext()
    );
    propagation.inject(activeContext, headers);

    // Trace the HTTP call
    return this.traceServiceCall(
      this.serviceName,
      this.extractServiceFromUrl(url),
      url,
      () => fetch(url, { ...options, headers })
    );
  }

  private extractServiceFromUrl(url: string): string {
    // Extract service name from internal URLs
    // e.g., http://ingestion:3001/health -> "ingestion"
    const match = url.match(/https?:\/\/([^:]+)/);
    return match ? match[1] : 'unknown';
  }

  private async traceServiceCall(from: string, to: string, url: string, call: () => Promise<Response>) {
    const tracer = trace.getTracer('elysia-http-client');
    
    return tracer.startActiveSpan(`${from}->${to}`, {
      attributes: {
        'http.method': 'GET',  // Could be dynamic
        'http.url': url,
        'service.from': from,
        'service.to': to
      }
    }, async (span) => {
      try {
        const response = await call();
        span.setAttributes({
          'http.status_code': response.status,
          'operation.success': response.ok
        });
        return response;
      } catch (error) {
        span.recordException(error as Error);
        throw error;
      } finally {
        span.end();
      }
    });
  }
}
```

## Structured Logging

### Log Configuration
```typescript
// logging/logger.ts
import winston from 'winston';
import { ElasticsearchTransport } from 'winston-elasticsearch';

export class LoggerService {
  private logger: winston.Logger;

  constructor(serviceName: string) {
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const correlationId = AsyncLocalStorage.getStore()?.correlationId;
          
          return JSON.stringify({
            '@timestamp': timestamp,
            level,
            message,
            service: serviceName,
            environment: process.env.NODE_ENV,
            correlation_id: correlationId,
            trace_id: trace.getActiveSpan()?.spanContext().traceId,
            span_id: trace.getActiveSpan()?.spanContext().spanId,
            ...meta
          });
        })
      ),
      transports: [
        new winston.transports.Console(),
        new ElasticsearchTransport({
          level: 'info',
          clientOpts: {
            node: process.env.ELASTICSEARCH_URL || 'http://elasticsearch:9200'
          },
          index: `cart-recovery-${serviceName}`,
          indexTemplate: {
            name: 'cart-recovery-logs',
            body: {
              index_patterns: ['cart-recovery-*'],
              mappings: {
                properties: {
                  '@timestamp': { type: 'date' },
                  level: { type: 'keyword' },
                  message: { type: 'text' },
                  service: { type: 'keyword' },
                  correlation_id: { type: 'keyword' },
                  trace_id: { type: 'keyword' },
                  user_id: { type: 'keyword' },
                  store_id: { type: 'keyword' }
                }
              }
            }
          }
        })
      ]
    });
  }

  // Structured logging methods for Elysia services
  logCartEvent(event: CartEvent, metadata: any = {}) {
    this.logger.info('Cart event processed', {
      event_type: event.eventType,
      cart_id: event.cartId,
      store_id: event.storeId,
      user_id: event.userId,
      event_value: event.cartValue,
      processing_time_ms: metadata.processingTime,
      service_name: metadata.serviceName || 'ingestion',
      framework: 'elysia',
      validation_library: '@libs/models',
      database_client: '@libs/database',
      ...metadata
    });
  }

  logMLPrediction(prediction: MLPrediction, metadata: any = {}) {
    this.logger.info('ML prediction generated', {
      cart_id: prediction.cartId,
      model_version: prediction.modelVersion,
      probability: prediction.probability,
      confidence: prediction.confidence,
      features_used: Object.keys(prediction.features).length,
      inference_time_ms: metadata.inferenceTime,
      service_name: metadata.serviceName || 'prediction',
      framework: 'elysia',
      cache_hit: metadata.cacheHit || false,
      cache_client: '@libs/database.redis',
      models_library: '@libs/models',
      ...metadata
    });
  }

  logInterventionDelivery(intervention: Intervention, result: DeliveryResult) {
    this.logger.info('Intervention delivered', {
      intervention_id: intervention.id,
      cart_id: intervention.cartId,
      channel: intervention.channel,
      template_id: intervention.templateId,
      delivery_status: result.status,
      delivery_time_ms: result.deliveryTime,
      error: result.error
    });
  }

  logSecurityEvent(eventType: string, details: any) {
    this.logger.warn('Security event detected', {
      security_event_type: eventType,
      ip_address: details.ipAddress,
      user_agent: details.userAgent,
      user_id: details.userId,
      severity: details.severity,
      action_taken: details.actionTaken
    });
  }

  logPerformanceIssue(issue: PerformanceIssue) {
    this.logger.warn('Performance issue detected', {
      issue_type: issue.type,
      service: issue.service,
      endpoint: issue.endpoint,
      latency_ms: issue.latency,
      threshold_ms: issue.threshold,
      cpu_usage: issue.cpuUsage,
      memory_usage: issue.memoryUsage
    });
  }
}
```

### Log Aggregation Pipeline
```yaml
# ELK Stack configuration
# fluentd-config.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: fluentd-config
data:
  fluent.conf: |
    <source>
      @type tail
      path /var/log/containers/*cart-recovery*.log
      pos_file /var/log/fluentd-containers.log.pos
      tag kubernetes.*
      format json
      time_format %Y-%m-%dT%H:%M:%S.%NZ
    </source>

    <filter kubernetes.**>
      @type kubernetes_metadata
    </filter>

    <filter kubernetes.**>
      @type parser
      key_name log
      reserve_data true
      <parse>
        @type json
        time_key @timestamp
        time_format %Y-%m-%dT%H:%M:%S.%NZ
      </parse>
    </filter>

    <match kubernetes.**>
      @type elasticsearch
      host elasticsearch.logging.svc.cluster.local
      port 9200
      index_name cart-recovery-logs
      type_name _doc
      
      <buffer>
        @type file
        path /var/log/fluentd-buffers/kubernetes.system.buffer
        flush_mode interval
        retry_type exponential_backoff
        flush_thread_count 2
        flush_interval 5s
        retry_forever
        retry_max_interval 30
        chunk_limit_size 2M
        queue_limit_length 8
        overflow_action block
      </buffer>
    </match>
```

## Alerting Configuration

### AlertManager Rules
```yaml
# alerts/cart-recovery.rules.yml
groups:
- name: cart-recovery-slos
  rules:
  # Availability alerts
  - alert: HighErrorRate
    expr: |
      (
        sum(rate(http_requests_total{status=~"5.."}[5m])) by (service) /
        sum(rate(http_requests_total[5m])) by (service)
      ) * 100 > 1
    for: 2m
    labels:
      severity: critical
      slo: availability
    annotations:
      summary: "High error rate detected for {{ $labels.service }}"
      description: "Error rate is {{ $value }}% for service {{ $labels.service }}"
      runbook_url: "https://runbooks.company.com/cart-recovery/high-error-rate"

  # Latency alerts  
  - alert: HighLatency
    expr: |
      histogram_quantile(0.95,
        sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service)
      ) * 1000 > 200
    for: 5m
    labels:
      severity: warning
      slo: latency
    annotations:
      summary: "High latency detected for {{ $labels.service }}"
      description: "P95 latency is {{ $value }}ms for service {{ $labels.service }}"

  # Throughput alerts
  - alert: LowThroughput
    expr: |
      sum(rate(http_requests_total[5m])) by (service) < 100
    for: 10m
    labels:
      severity: warning
      slo: throughput
    annotations:
      summary: "Low throughput for {{ $labels.service }}"
      description: "Throughput is {{ $value }} RPS for service {{ $labels.service }}"

- name: cart-recovery-business
  rules:
  # Business metric alerts
  - alert: LowConversionRate
    expr: |
      avg_over_time(conversion_rate_percentage[1h]) < 2
    for: 30m
    labels:
      severity: warning
      category: business
    annotations:
      summary: "Low conversion rate detected"
      description: "Conversion rate is {{ $value }}% averaged over 1 hour"

  - alert: HighCartAbandonmentRate
    expr: |
      avg_over_time(cart_abandonment_rate_percentage[1h]) > 70
    for: 30m
    labels:
      severity: warning
      category: business
    annotations:
      summary: "High cart abandonment rate"
      description: "Cart abandonment rate is {{ $value }}% averaged over 1 hour"

- name: cart-recovery-infrastructure
  rules:
  # Infrastructure alerts
  - alert: HighMemoryUsage
    expr: |
      (container_memory_usage_bytes / container_spec_memory_limit_bytes) * 100 > 85
    for: 5m
    labels:
      severity: warning
      category: infrastructure
    annotations:
      summary: "High memory usage for {{ $labels.pod }}"
      description: "Memory usage is {{ $value }}% for pod {{ $labels.pod }}"

  - alert: HighCPUUsage
    expr: |
      rate(container_cpu_usage_seconds_total[5m]) * 100 > 80
    for: 10m
    labels:
      severity: warning
      category: infrastructure
    annotations:
      summary: "High CPU usage for {{ $labels.pod }}"
      description: "CPU usage is {{ $value }}% for pod {{ $labels.pod }}"

  - alert: KafkaConsumerLag
    expr: |
      kafka_consumer_lag_sum > 10000
    for: 5m
    labels:
      severity: critical
      category: infrastructure
    annotations:
      summary: "High Kafka consumer lag"
      description: "Consumer lag is {{ $value }} messages for topic {{ $labels.topic }}"

  - alert: DatabaseConnectionsHigh
    expr: |
      pg_stat_activity_count > 80
    for: 5m
    labels:
      severity: warning
      category: infrastructure
    annotations:
      summary: "High database connection count"
      description: "Database has {{ $value }} active connections"
```

### PagerDuty Integration
```yaml
# alertmanager/config.yml
global:
  pagerduty_url: 'https://events.pagerduty.com/v2/enqueue'

route:
  group_by: ['alertname']
  group_wait: 10s
  group_interval: 10s
  repeat_interval: 1h
  receiver: 'web.hook'
  routes:
  - match:
      severity: critical
    receiver: pagerduty-critical
  - match:
      severity: warning
    receiver: slack-warnings

receivers:
- name: 'web.hook'
  webhook_configs:
  - url: 'http://webhook-service/alerts'

- name: 'pagerduty-critical'
  pagerduty_configs:
  - routing_key: 'YOUR_PAGERDUTY_INTEGRATION_KEY'
    description: '{{ range .Alerts }}{{ .Annotations.summary }}{{ end }}'
    details:
      severity: '{{ .GroupLabels.severity }}'
      service: '{{ .GroupLabels.service }}'
      runbook: '{{ .CommonAnnotations.runbook_url }}'

- name: 'slack-warnings'
  slack_configs:
  - api_url: 'YOUR_SLACK_WEBHOOK_URL'
    channel: '#cart-recovery-alerts'
    title: 'Cart Recovery Alert'
    text: '{{ range .Alerts }}{{ .Annotations.description }}{{ end }}'
    actions:
    - type: button
      text: 'View Dashboard'
      url: 'https://grafana.company.com/d/cart-recovery'
```

## Dashboard Configuration

### Grafana Dashboards
```json
{
  "dashboard": {
    "id": null,
    "title": "Cart Recovery Platform - Overview",
    "tags": ["cart-recovery", "overview"],
    "timezone": "browser",
    "panels": [
      {
        "id": 1,
        "title": "Elysia Service Request Rates",
        "type": "graph",
        "targets": [
          {
            "expr": "sum(rate(elysia_http_requests_total{framework=\"elysia\"}[5m])) by (service)",
            "legendFormat": "{{ service }}"
          }
        ],
        "yAxes": [
          {
            "label": "Requests/sec",
            "min": 0
          }
        ]
      },
      {
        "id": 2,
        "title": "Elysia Service P95 Latency", 
        "type": "graph",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, sum(rate(elysia_http_request_duration_seconds_bucket{framework=\"elysia\"}[5m])) by (le, service)) * 1000",
            "legendFormat": "{{ service }} P95"
          }
        ],
        "yAxes": [
          {
            "label": "Milliseconds",
            "min": 0
          }
        ]
      },
      {
        "id": 3,
        "title": "Elysia Services Error Rate %",
        "type": "singlestat",
        "targets": [
          {
            "expr": "(sum(rate(elysia_http_requests_total{status=~\"5..\",framework=\"elysia\"}[5m])) / sum(rate(elysia_http_requests_total{framework=\"elysia\"}[5m]))) * 100",
            "legendFormat": "Error Rate"
          }
        ],
        "thresholds": "0.1,1",
        "colors": ["green", "yellow", "red"]
      },
      {
        "id": 4,
        "title": "Event Processing Rate (Ingestion Service)",
        "type": "graph", 
        "targets": [
          {
            "expr": "sum(rate(elysia_events_ingested_total{service=\"ingestion\"}[5m]))",
            "legendFormat": "Events Ingested/sec"
          },
          {
            "expr": "sum(rate(elysia_websocket_messages_total{service=\"ingestion\",direction=\"received\"}[5m]))",
            "legendFormat": "WebSocket Events/sec"
          }
        ]
      },
      {
        "id": 5,
        "title": "ML Prediction Accuracy",
        "type": "stat",
        "targets": [
          {
            "expr": "(sum(ml_predictions_correct_total[24h]) / sum(ml_predictions_total[24h])) * 100",
            "legendFormat": "Accuracy %"
          }
        ]
      },
      {
        "id": 6,
        "title": "Revenue Recovery",
        "type": "graph",
        "targets": [
          {
            "expr": "sum(increase(revenue_recovered_dollars_total[1h])) by (intervention_type)",
            "legendFormat": "{{ intervention_type }}"
          }
        ],
        "yAxes": [
          {
            "label": "USD",
            "min": 0
          }
        ]
      }
    ]
  }
}
```

### Business Intelligence Dashboard
```json
{
  "dashboard": {
    "title": "Cart Recovery - Business Metrics",
    "panels": [
      {
        "title": "Conversion Funnel",
        "type": "bargauge",
        "targets": [
          {
            "expr": "sum(cart_events_total{event_type=\"cart_created\"}) by (store_id)",
            "legendFormat": "Carts Created"
          },
          {
            "expr": "sum(cart_events_total{event_type=\"cart_abandoned\"}) by (store_id)", 
            "legendFormat": "Carts Abandoned"
          },
          {
            "expr": "sum(cart_events_total{event_type=\"purchase_completed\"}) by (store_id)",
            "legendFormat": "Purchases Completed"
          }
        ]
      },
      {
        "title": "Intervention Effectiveness",
        "type": "table",
        "targets": [
          {
            "expr": "sum(interventions_delivered_total) by (intervention_type, channel)",
            "legendFormat": "Delivered"
          },
          {
            "expr": "sum(interventions_converted_total) by (intervention_type, channel)",
            "legendFormat": "Converted"
          }
        ]
      },
      {
        "title": "Revenue by Channel",
        "type": "piechart",
        "targets": [
          {
            "expr": "sum(revenue_recovered_dollars_total) by (intervention_type)",
            "legendFormat": "{{ intervention_type }}"
          }
        ]
      }
    ]
  }
}
```

## Health Check Strategy

### Multi-Level Health Checks
```typescript
// health/health.service.ts
export class HealthService {
  async getHealthStatus(): Promise<HealthStatus> {
    const checks = await Promise.allSettled([
      this.checkDatabaseHealth(),
      this.checkRedisHealth(), 
      this.checkKafkaHealth(),
      this.checkExternalServices(),
      this.checkDiskSpace(),
      this.checkMemoryUsage()
    ]);

    const overallStatus = checks.every(check => check.status === 'fulfilled') 
      ? 'healthy' : 'unhealthy';

    return {
      status: overallStatus,
      timestamp: new Date(),
      checks: {
        database: this.getCheckResult(checks[0]),
        redis: this.getCheckResult(checks[1]),
        kafka: this.getCheckResult(checks[2]),
        external: this.getCheckResult(checks[3]),
        disk: this.getCheckResult(checks[4]),
        memory: this.getCheckResult(checks[5])
      },
      metrics: await this.getCurrentMetrics(),
      version: process.env.VERSION || 'unknown'
    };
  }

  private async checkDatabaseHealth(): Promise<HealthCheck> {
    try {
      const start = Date.now();
      await this.database.query('SELECT 1');
      const duration = Date.now() - start;

      return {
        status: duration < 100 ? 'healthy' : 'degraded',
        responseTime: duration,
        details: { connectionCount: await this.database.getConnectionCount() }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        responseTime: -1
      };
    }
  }

  private async checkKafkaHealth(): Promise<HealthCheck> {
    try {
      const admin = kafka.admin();
      const metadata = await admin.fetchTopicMetadata();
      
      const unhealthyTopics = metadata.topics.filter(
        topic => topic.partitions.some(p => p.leader === -1)
      );

      return {
        status: unhealthyTopics.length === 0 ? 'healthy' : 'degraded',
        details: {
          topicCount: metadata.topics.length,
          unhealthyTopics: unhealthyTopics.map(t => t.name)
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message
      };
    }
  }
}
```

### Readiness vs Liveness
```typescript
// Different health check endpoints for Kubernetes
@Controller('health')
export class HealthController {
  
  // Liveness probe - is the app running?
  @Get('live')
  getLiveness(): HealthResponse {
    return {
      status: 'ok',
      timestamp: new Date(),
      uptime: process.uptime()
    };
  }

  // Readiness probe - is the app ready to serve traffic?
  @Get('ready')
  async getReadiness(): Promise<HealthResponse> {
    const checks = await Promise.allSettled([
      this.database.isConnected(),
      this.redis.ping(),
      this.kafka.isConnected()
    ]);

    const ready = checks.every(check => check.status === 'fulfilled');
    
    return {
      status: ready ? 'ready' : 'not-ready',
      timestamp: new Date(),
      checks: checks.map(this.formatCheckResult)
    };
  }

  // Startup probe - has the app finished starting?
  @Get('startup')
  async getStartup(): Promise<HealthResponse> {
    const isReady = await this.applicationService.isInitialized();
    
    return {
      status: isReady ? 'started' : 'starting',
      timestamp: new Date(),
      initialization: await this.applicationService.getInitializationStatus()
    };
  }
}
```

## Summary

This comprehensive monitoring and observability setup provides complete visibility into the **Elysia-based Cart Recovery Platform's** health, performance, and business metrics. Key highlights:

### Elysia-Specific Monitoring Benefits
- **Framework Optimization**: Monitoring metrics optimized for Elysia's performance characteristics
- **Shared Library Visibility**: Individual monitoring for each @libs/* dependency
- **WebSocket Native Monitoring**: Real-time connection and message tracking
- **Service Mesh Tracing**: Complete request flow across all 4 Elysia services
- **pnpm Workspace Insights**: Build and dependency monitoring

### Production Readiness
- **Lower Latency SLOs**: Improved targets leveraging Elysia's performance (50ms P95 vs 100ms)
- **Enhanced Availability**: 99.97% SLO target with reduced error budget
- **Real-time Metrics**: Sub-second WebSocket and event processing monitoring
- **Shared Library Health**: Individual health checks for all infrastructure libraries
- **Business Intelligence**: Revenue recovery and conversion tracking

### Operational Excellence
- **Proactive Alerting**: Multi-level alerts for services and shared libraries
- **Distributed Tracing**: Full request correlation across microservices
- **Structured Logging**: Centralized logs with correlation IDs and trace context
- **Health Monitoring**: Liveness, readiness, and startup probes for Kubernetes
- **Performance Optimization**: Event loop lag and Node.js specific metrics

The monitoring setup enables proactive incident management, performance optimization, and business intelligence while maintaining full observability into the Elysia microservices architecture.