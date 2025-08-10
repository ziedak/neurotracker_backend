# Detailed Service Implementation Specifications

## 1. Core Platform Service

### Functional Responsibilities
- **API Gateway**: Request routing, load balancing, protocol translation
- **Authentication**: JWT-based auth, API key management, session handling
- **Authorization**: Role-based access control, store-level permissions
- **Configuration**: Dynamic config management, feature flags
- **Rate Limiting**: Per-user, per-store, per-endpoint limits
- **Security**: SSL termination, request validation, CORS handling

### Technical Implementation

#### Module Structure
```
core-platform/
├── src/
│   ├── gateway/
│   │   ├── gateway.controller.ts     # Main routing controller
│   │   ├── proxy.service.ts          # Service proxying logic
│   │   └── load-balancer.service.ts  # Load balancing algorithms
│   ├── auth/
│   │   ├── jwt.strategy.ts           # JWT validation strategy
│   │   ├── api-key.strategy.ts       # API key validation
│   │   ├── auth.controller.ts        # Login/logout endpoints
│   │   ├── auth.service.ts           # Authentication logic
│   │   └── session.service.ts        # Session management
│   ├── config/
│   │   ├── config.controller.ts      # Config CRUD operations
│   │   ├── config.service.ts         # Configuration logic
│   │   └── feature-flags.service.ts  # Feature flag management
│   ├── security/
│   │   ├── rate-limit.guard.ts       # Rate limiting implementation
│   │   ├── cors.guard.ts             # CORS validation
│   │   └── validation.pipe.ts        # Input validation
│   └── health/
│       └── health.controller.ts      # System health checks
```

#### Data Layer
```typescript
// Redis Structures
session:{userId}            -> {sessionData, expiresAt}
api_key:{keyId}            -> {storeId, permissions, rateLimit}
config:{storeId}           -> {settings, featureFlags}
rate_limit:{identifier}    -> {count, windowStart}

// PostgreSQL Tables
users                      -> {id, email, password_hash, role, store_id}
stores                     -> {id, name, url, api_key, settings}
api_keys                   -> {id, key_hash, store_id, permissions}
audit_logs                 -> {id, user_id, action, timestamp, details}
```

#### Communication Patterns
```typescript
// Incoming: HTTP/HTTPS from clients
// Outgoing: HTTP to downstream services
// Internal: Redis for sessions/cache, PostgreSQL for persistence

// Service Discovery
const serviceRegistry = {
  'event-pipeline': ['http://event-1:3001', 'http://event-2:3001'],
  'ai-engine': ['http://ai-1:3002', 'http://ai-2:3002'],
  'intervention-engine': ['http://intervention-1:3003']
};

// Load Balancing Strategy
- Round-robin for equal load distribution
- Health check integration (remove unhealthy instances)
- Circuit breaker per downstream service
- Retry with exponential backoff
```

#### API Endpoints
```typescript
// Authentication
POST   /auth/login           # User login
POST   /auth/logout          # User logout  
POST   /auth/refresh         # Token refresh
GET    /auth/me              # Current user info

// API Key Management
POST   /api-keys             # Create API key
GET    /api-keys             # List API keys
DELETE /api-keys/:id         # Revoke API key

// Configuration
GET    /config               # Get configuration
PUT    /config               # Update configuration
GET    /feature-flags        # Get feature flags
PUT    /feature-flags/:flag  # Toggle feature flag

// Gateway/Proxy
ALL    /api/events/*         # Proxy to event-pipeline
ALL    /api/predict/*        # Proxy to ai-engine
ALL    /api/interventions/*  # Proxy to intervention-engine
ALL    /api/analytics/*      # Proxy to data-platform

// Health & Monitoring
GET    /health               # Overall system health
GET    /health/detailed      # Detailed service health
GET    /metrics              # Prometheus metrics
```

---

## 2. Event Pipeline Service

### Functional Responsibilities
- **Event Ingestion**: Multi-protocol event collection (WebSocket primary, REST fallback)
- **Event Processing**: Real-time stream processing, data enrichment
- **Schema Management**: Event schema validation, evolution, registry
- **Event Routing**: Intelligent routing to downstream consumers
- **Batch Processing**: High-throughput batch event processing
- **Dead Letter Handling**: Failed event retry and alerting

### Technical Implementation

#### Module Structure
```
event-pipeline/
├── src/
│   ├── ingestion/
│   │   ├── websocket.gateway.ts      # WebSocket event ingestion
│   │   ├── rest.controller.ts        # REST fallback endpoint
│   │   ├── batch.controller.ts       # Batch processing endpoint
│   │   └── validation.service.ts     # Event validation
│   ├── processing/
│   │   ├── stream.processor.ts       # Kafka streams processing
│   │   ├── enrichment.service.ts     # Data enrichment logic
│   │   ├── deduplication.service.ts  # Event deduplication
│   │   └── routing.service.ts        # Event routing logic
│   ├── schema/
│   │   ├── registry.service.ts       # Schema version management
│   │   ├── validator.service.ts      # Schema validation
│   │   └── migration.service.ts      # Schema evolution
│   ├── deadletter/
│   │   ├── handler.service.ts        # Dead letter processing
│   │   └── retry.service.ts          # Retry mechanism
│   └── monitoring/
│       ├── metrics.service.ts        # Pipeline metrics
│       └── alerts.service.ts         # Alert generation
```

#### Data Layer
```typescript
// Kafka Topics
cart-events-raw            -> Raw incoming events
cart-events-validated      -> Schema-validated events  
cart-events-enriched       -> Enriched with user/store data
cart-events-dlq            -> Dead letter queue

// Redis Structures
event_dedup:{hash}         -> {eventId, timestamp} (TTL: 1 hour)
user_profile:{userId}      -> {lastSeen, purchaseHistory, preferences}
store_config:{storeId}     -> {timezone, businessHours, settings}
schema_cache:{version}     -> {schema, validationRules}

// ClickHouse Tables (Raw Events)
events_raw                 -> All incoming events (18 months retention)
events_processed          -> Processed events with enrichment
events_errors             -> Processing errors and failures
```

#### Kafka Streams Topology
```typescript
// Stream Processing Flow
Source: cart-events-raw
├── Filter: Remove duplicates
├── Transform: Validate schema
├── Branch: 
│   ├── Valid Events -> Enrichment -> cart-events-enriched
│   └── Invalid Events -> cart-events-dlq
└── Sink: Store to ClickHouse

// Enrichment Process
1. Get user profile from Redis/PostgreSQL
2. Get store configuration 
3. Add session context
4. Calculate derived features
5. Add processing metadata
```

#### API Endpoints
```typescript
// Event Ingestion
WS     /events/stream        # WebSocket event ingestion
POST   /events               # Single event (REST fallback)
POST   /events/batch         # Batch event processing
GET    /events/stats         # Ingestion statistics

// Schema Management
GET    /schemas              # List available schemas
POST   /schemas              # Register new schema
GET    /schemas/:version     # Get specific schema
PUT    /schemas/:version     # Update schema

// Monitoring
GET    /health               # Service health
GET    /metrics              # Processing metrics
GET    /pipeline/status      # Pipeline health status
```

#### Performance Requirements
- **Throughput**: 50,000 events/second
- **Latency**: <10ms for ingestion, <100ms for processing
- **Availability**: 99.95% uptime
- **Scalability**: Horizontal scaling via Kafka partitions

---

## 3. AI Engine Service

### Functional Responsibilities
- **Prediction Service**: Real-time ML predictions for cart recovery
- **Feature Engineering**: Real-time and batch feature computation
- **Model Management**: Version control, deployment, A/B testing
- **Model Serving**: High-performance model inference
- **Feature Store**: Real-time feature serving and offline storage
- **ML Pipeline**: Training pipeline coordination and monitoring

### Technical Implementation

#### Module Structure
```
ai-engine/
├── src/
│   ├── prediction/
│   │   ├── prediction.controller.ts  # Prediction API endpoints
│   │   ├── prediction.service.ts     # Core prediction logic
│   │   ├── batch.service.ts          # Batch prediction processing
│   │   └── cache.service.ts          # Prediction result caching
│   ├── models/
│   │   ├── registry.service.ts       # Model version management
│   │   ├── loader.service.ts         # Model loading/unloading
│   │   ├── serving.service.ts        # Model inference
│   │   ├── abtest.service.ts         # A/B testing framework
│   │   └── monitoring.service.ts     # Model performance monitoring
│   ├── features/
│   │   ├── store.service.ts          # Feature store management
│   │   ├── engineering.service.ts    # Feature computation
│   │   ├── serving.service.ts        # Real-time feature serving
│   │   └── validation.service.ts     # Feature validation
│   ├── training/
│   │   ├── pipeline.service.ts       # Training orchestration
│   │   ├── data.service.ts           # Training data preparation
│   │   └── evaluation.service.ts     # Model evaluation
│   └── ml-ops/
│       ├── deployment.service.ts     # Model deployment
│       ├── rollback.service.ts       # Model rollback
│       └── drift.service.ts          # Model drift detection
```

#### Data Layer
```typescript
// Redis Structures (Hot Features)
features:{cartId}          -> {realTimeFeatures, computedAt}
prediction:{cartId}:{version} -> {prediction, confidence, expiresAt}
model_cache:{version}      -> {modelMetadata, loadedAt}
user_features:{userId}     -> {behavioralFeatures, updatedAt}

// PostgreSQL Tables (Model Registry)
models                     -> {id, version, path, status, performance_metrics}
model_experiments         -> {id, model_id, traffic_split, start_date, end_date}
feature_definitions       -> {id, name, type, computation_logic, dependencies}
model_performance         -> {model_id, metric_name, value, timestamp}

// ClickHouse Tables (Feature Store)
features_offline          -> Historical features for training
prediction_logs           -> All predictions with outcomes
model_metrics            -> Model performance over time
feature_statistics       -> Feature distribution statistics
```

#### ML Model Interface
```typescript
interface MLModel {
  version: string;
  
  // Core prediction methods
  predict(features: Record<string, number>): Promise<Prediction>;
  predictBatch(features: Record<string, number>[]): Promise<Prediction[]>;
  
  // Model lifecycle
  load(): Promise<void>;
  unload(): Promise<void>;
  isLoaded(): boolean;
  
  // Performance monitoring
  getMetrics(): ModelMetrics;
  validateInput(features: Record<string, number>): boolean;
}

interface Prediction {
  cartId: string;
  probability: number;           // 0-1 conversion probability
  confidence: number;            // 0-1 prediction confidence
  recommendedAction: 'none' | 'discount' | 'reminder' | 'urgency';
  recommendedDiscount?: number;  // Suggested discount percentage
  reasoning: string[];           // Explainable AI reasons
  features: Record<string, number>; // Features used
  modelVersion: string;
  computedAt: string;
  expiresAt: string;
}
```

#### Feature Engineering Pipeline
```typescript
// Real-time Features (computed on demand)
- timeSinceAbandonment      # Minutes since cart abandonment
- cartValue                 # Total cart value
- itemCount                 # Number of items
- avgItemPrice             # Average item price
- userSegment              # Customer segment (new/returning/vip)

// Behavioral Features (from user history)
- purchaseHistory          # Previous purchase count
- avgOrderValue            # Average historical order value
- daysSinceLastPurchase    # Recency
- preferredCategories      # Product category preferences
- priceSenitivity          # Historical discount usage

// Contextual Features (real-time context)
- timeOfDay               # Current hour (0-23)
- dayOfWeek              # Current day (0-6)
- isWeekend              # Weekend indicator
- isHoliday              # Holiday period indicator
- deviceType             # mobile/tablet/desktop
- trafficSource          # organic/paid/email/social

// Store Features (store-specific)
- storeConversionRate    # Store's average conversion rate
- competitorPricing      # Price competitiveness
- inventoryLevel         # Product availability
- storeReputationScore   # Review scores, ratings
```

#### API Endpoints
```typescript
// Prediction Endpoints
POST   /predict              # Single prediction
POST   /predict/batch        # Batch predictions
GET    /predict/:cartId      # Get cached prediction

// Feature Endpoints  
GET    /features/:cartId     # Get computed features
POST   /features/compute     # Trigger feature computation
GET    /features/definitions # Feature schema

// Model Management
GET    /models               # List available models
POST   /models/:version/load # Load model version
POST   /models/:version/unload # Unload model version
GET    /models/:version/status # Model status
POST   /models/deploy        # Deploy new model version

// A/B Testing
POST   /experiments          # Create A/B test
GET    /experiments          # List active experiments
PUT    /experiments/:id      # Update experiment
DELETE /experiments/:id      # End experiment

// Monitoring
GET    /health               # Service health
GET    /metrics              # Model performance metrics
GET    /drift                # Model drift detection
```

#### Communication Patterns
```typescript
// Incoming
- HTTP from Core Platform (predictions)
- Kafka from Event Pipeline (feature updates)
- HTTP from Data Platform (training triggers)

// Outgoing  
- HTTP to Data Platform (feature requests)
- Kafka to Intervention Engine (prediction results)
- HTTP to Model Registry (model metadata)

// Internal
- Redis for prediction caching
- PostgreSQL for model registry
- File system for model artifacts
```

---

## 4. Intervention Engine Service

### Functional Responsibilities
- **Real-time Delivery**: WebSocket-based instant interventions
- **Multi-channel Notifications**: Email, SMS, push notifications
- **Intervention Tracking**: Delivery confirmation, engagement tracking
- **Personalization**: Dynamic content personalization
- **Campaign Management**: Intervention templates, A/B testing
- **Delivery Optimization**: Channel selection, timing optimization

### Technical Implementation

#### Module Structure
```
intervention-engine/
├── src/
│   ├── delivery/
│   │   ├── websocket.gateway.ts      # Real-time WebSocket delivery
│   │   ├── delivery.controller.ts    # Delivery API endpoints
│   │   ├── delivery.service.ts       # Core delivery logic
│   │   ├── channel.service.ts        # Channel management
│   │   └── optimization.service.ts   # Delivery optimization
│   ├── notifications/
│   │   ├── email.service.ts          # Email provider integration
│   │   ├── sms.service.ts            # SMS provider integration
│   │   ├── push.service.ts           # Push notification service
│   │   └── template.service.ts       # Template management
│   ├── tracking/
│   │   ├── tracking.controller.ts    # Tracking API endpoints
│   │   ├── tracking.service.ts       # Event tracking logic
│   │   ├── attribution.service.ts    # Attribution modeling
│   │   └── analytics.service.ts      # Performance analytics
│   ├── personalization/
│   │   ├── personalization.service.ts # Content personalization
│   │   ├── segmentation.service.ts    # User segmentation
│   │   └── optimization.service.ts    # Content optimization
│   ├── campaigns/
│   │   ├── campaign.controller.ts     # Campaign management
│   │   ├── template.service.ts        # Template management
│   │   └── scheduler.service.ts       # Campaign scheduling
│   └── queue/
│       ├── intervention.queue.ts      # Intervention processing queue
│       ├── notification.queue.ts      # Notification delivery queue
│       └── retry.service.ts           # Failed delivery retry
```

#### Data Layer
```typescript
// Redis Structures
ws_connections:{storeId}    -> Set of active WebSocket connections
intervention:{id}          -> {details, status, deliveredAt}
user_preferences:{userId}  -> {channels, timezone, optOuts}
delivery_queue            -> Sorted set of pending interventions
template_cache:{templateId} -> {compiled template, variables}

// PostgreSQL Tables
interventions             -> {id, cart_id, type, status, scheduled_at, delivered_at}
intervention_tracking     -> {intervention_id, event_type, timestamp, metadata}
templates                 -> {id, name, channel, content, variables}
campaigns                 -> {id, name, rules, template_id, status}
user_preferences         -> {user_id, channel_preferences, opt_outs}

// Kafka Topics (Consuming)
cart-events-enriched     -> Trigger intervention decisions
prediction-results       -> AI predictions for intervention triggering

// Kafka Topics (Producing)
intervention-events      -> Intervention delivery events
conversion-events        -> Conversion tracking events
```

#### Intervention Decision Logic
```typescript
interface InterventionDecision {
  trigger: boolean;
  channel: 'websocket' | 'email' | 'sms' | 'push';
  template: string;
  timing: 'immediate' | 'delayed';
  delay?: number; // minutes
  personalization: Record<string, any>;
}

// Decision factors:
1. Prediction probability threshold (>0.3 = trigger)
2. User channel preferences
3. Time-based optimization (business hours)
4. Intervention frequency limits (max 1 per hour)
5. Store-specific rules and settings
6. User opt-out status
```

#### WebSocket Connection Management
```typescript
// Connection Registry
interface ConnectionInfo {
  socket: WebSocket;
  storeId: string;
  userId?: string;
  connectedAt: Date;
  lastActivity: Date;
}

// Connection pooling per store
const storeConnections = new Map<string, Set<ConnectionInfo>>();

// Message types
interface WebSocketMessage {
  type: 'intervention' | 'heartbeat' | 'tracking' | 'config';
  payload: any;
  timestamp: string;
  messageId: string;
}
```

#### API Endpoints
```typescript
// WebSocket
WS     /ws/store/:storeId    # Store connection for real-time delivery
WS     /ws/user/:userId      # User connection for direct messaging

// Intervention Management
POST   /interventions        # Trigger intervention
GET    /interventions/:id    # Get intervention details
PUT    /interventions/:id    # Update intervention
DELETE /interventions/:id    # Cancel intervention

// Batch Operations
POST   /interventions/batch  # Batch intervention triggering
POST   /interventions/schedule # Schedule future interventions

// Tracking
POST   /track/:interventionId # Track intervention events
GET    /track/:interventionId # Get intervention tracking
POST   /conversions          # Record conversion events

// Templates & Campaigns
GET    /templates            # List templates
POST   /templates            # Create template
PUT    /templates/:id        # Update template
GET    /campaigns            # List campaigns
POST   /campaigns            # Create campaign

// Analytics
GET    /analytics/performance # Intervention performance
GET    /analytics/channels   # Channel effectiveness
GET    /analytics/conversion # Conversion funnel
```

---

## 5. Data Intelligence Service

### Functional Responsibilities
- **Feature Store**: Centralized feature management and serving
- **Data Reconciliation**: Cross-system data consistency validation
- **Business Intelligence**: Analytics, reporting, dashboards
- **Data Export**: API for external systems, data lake integration
- **GDPR Compliance**: Data retention, right-to-be-forgotten
- **Data Quality**: Monitoring, validation, anomaly detection

### Technical Implementation

#### Module Structure
```
data-platform/
├── src/
│   ├── features/
│   │   ├── store.controller.ts       # Feature store API
│   │   ├── store.service.ts          # Feature storage logic
│   │   ├── computation.service.ts    # Feature computation
│   │   ├── serving.service.ts        # Real-time feature serving
│   │   └── offline.service.ts        # Offline feature processing
│   ├── reconciliation/
│   │   ├── reconciliation.service.ts # Data consistency checks
│   │   ├── repair.service.ts         # Automated data repair
│   │   ├── validator.service.ts      # Data validation rules
│   │   └── scheduler.service.ts      # Reconciliation scheduling
│   ├── analytics/
│   │   ├── analytics.controller.ts   # Analytics API
│   │   ├── reporting.service.ts      # Report generation
│   │   ├── dashboard.service.ts      # Dashboard data
│   │   └── export.service.ts         # Data export functionality
│   ├── compliance/
│   │   ├── gdpr.controller.ts        # GDPR endpoints
│   │   ├── gdpr.service.ts           # GDPR compliance logic
│   │   ├── retention.service.ts      # Data retention policies
│   │   └── audit.service.ts          # Audit trail management
│   ├── quality/
│   │   ├── quality.service.ts        # Data quality monitoring
│   │   ├── anomaly.service.ts        # Anomaly detection
│   │   └── validation.service.ts     # Data validation
│   └── etl/
│       ├── extraction.service.ts     # Data extraction
│       ├── transformation.service.ts # Data transformation
│       └── loading.service.ts        # Data loading
```

#### Data Layer
```typescript
// ClickHouse Tables (Analytics)
cart_events_aggregated    -> Hourly/daily event aggregations
user_behavior_metrics     -> User behavior analytics
store_performance        -> Store-level performance metrics
intervention_effectiveness -> Intervention success rates
revenue_attribution      -> Revenue attribution to interventions
feature_statistics       -> Feature distribution and drift

// PostgreSQL Tables (Metadata)
feature_definitions      -> {id, name, type, computation, dependencies}
data_quality_rules      -> {id, table, column, rule_type, threshold}
reconciliation_reports  -> {id, date, discrepancies, status}
gdpr_requests          -> {id, user_id, request_type, status, completed_at}

// Redis Structures (Real-time)
features_realtime:{cartId} -> {features, computedAt, ttl}
analytics_cache:{key}     -> {data, computedAt, ttl}
quality_alerts:{table}    -> {alerts, severity, timestamp}
```

#### Feature Store Architecture
```typescript
// Feature Categories
interface FeatureDefinition {
  name: string;
  type: 'realtime' | 'batch' | 'derived';
  computation: 'sql' | 'javascript' | 'python';
  dependencies: string[];
  freshness: number; // TTL in seconds
  source: 'clickhouse' | 'postgresql' | 'redis' | 'api';
}

// Real-time Features (served from Redis)
- Session-based: current_session_duration, pages_viewed
- Cart-based: cart_value, item_count, time_since_last_update
- User-based: recent_purchases, avg_order_value

// Batch Features (computed hourly/daily)
- Historical: purchase_frequency, seasonal_patterns  
- Aggregated: store_conversion_rate, category_popularity
- Derived: customer_lifetime_value, churn_probability
```

#### API Endpoints
```typescript
// Feature Store
GET    /features/:cartId     # Get features for cart
POST   /features/compute     # Trigger feature computation
GET    /features/definitions # Feature schema
POST   /features/batch       # Batch feature requests

// Analytics & Reporting
GET    /analytics/overview   # High-level metrics
GET    /analytics/conversion # Conversion funnel
GET    /analytics/revenue    # Revenue attribution
GET    /analytics/performance # Model performance
POST   /reports/generate    # Generate custom report
GET    /reports/:id         # Download report

// Data Export
GET    /export/events        # Export event data
GET    /export/features      # Export feature data  
GET    /export/predictions   # Export prediction data
POST   /export/custom       # Custom data export

// GDPR Compliance
POST   /gdpr/forget/:userId  # Right to be forgotten
GET    /gdpr/export/:userId  # Data export request
GET    /gdpr/status/:requestId # Request status

// Data Quality
GET    /quality/status       # Data quality overview
GET    /quality/alerts       # Active quality alerts
POST   /quality/validate     # Manual validation trigger
```

---

## 6. Monitoring & Anomaly Detection Service

### Functional Responsibilities
- **System Monitoring**: Service health, performance metrics
- **Anomaly Detection**: Unusual patterns, fraud detection
- **Alerting**: Multi-channel alert delivery
- **Log Aggregation**: Centralized logging and analysis
- **Tracing**: Distributed request tracing
- **Security Monitoring**: Threat detection, access monitoring

### Technical Implementation

#### Module Structure
```
monitoring-service/
├── src/
│   ├── metrics/
│   │   ├── collection.service.ts     # Metrics collection
│   │   ├── aggregation.service.ts    # Metrics aggregation
│   │   ├── prometheus.service.ts     # Prometheus integration
│   │   └── custom.service.ts         # Custom metrics
│   ├── anomaly/
│   │   ├── detection.service.ts      # Anomaly detection algorithms
│   │   ├── fraud.service.ts          # Fraud detection
│   │   ├── pattern.service.ts        # Pattern analysis
│   │   └── scoring.service.ts        # Risk scoring
│   ├── alerts/
│   │   ├── alerts.controller.ts      # Alert management API
│   │   ├── rules.service.ts          # Alert rule engine
│   │   ├── notification.service.ts   # Alert delivery
│   │   └── escalation.service.ts     # Alert escalation
│   ├── logging/
│   │   ├── aggregation.service.ts    # Log aggregation
│   │   ├── analysis.service.ts       # Log analysis
│   │   └── retention.service.ts      # Log retention
│   ├── tracing/
│   │   ├── tracer.service.ts         # Distributed tracing
│   │   ├── span.service.ts           # Span management
│   │   └── correlation.service.ts    # Request correlation
│   └── security/
│       ├── security.service.ts       # Security monitoring
│       ├── threat.service.ts         # Threat detection
│       └── access.service.ts         # Access monitoring
```

#### Monitoring Metrics
```typescript
// Application Metrics
- request_duration_seconds    # Request latency
- request_count_total        # Request count by endpoint
- error_count_total          # Error count by type
- active_connections         # Active WebSocket connections
- queue_size                 # Message queue sizes
- cache_hit_ratio           # Cache effectiveness

// Business Metrics  
- cart_abandonment_rate     # Cart abandonment percentage
- intervention_delivery_rate # Successful delivery rate
- conversion_rate           # Overall conversion rate
- revenue_recovered         # Revenue from interventions
- customer_satisfaction     # NPS scores

// Infrastructure Metrics
- cpu_usage_percent         # CPU utilization
- memory_usage_bytes        # Memory consumption
- disk_usage_percent        # Disk utilization
- network_io_bytes          # Network traffic
- database_connections      # DB connection pool usage
```

#### Anomaly Detection Algorithms
```typescript
// Statistical Anomaly Detection
1. Z-Score Analysis: Detect values >3 standard deviations
2. Moving Average: Detect sudden changes in trends
3. Seasonal Decomposition: Account for periodic patterns
4. Isolation Forest: Multivariate outlier detection

// Business Logic Anomalies
1. Unusual cart values (>$10,000 or <$1)
2. Rapid-fire cart additions (>100 items/minute)
3. Geographic anomalies (purchases from unusual locations)
4. Velocity checks (multiple carts from same IP)
5. Behavioral anomalies (unusual browsing patterns)

// Fraud Detection Patterns
1. Card testing patterns
2. Account takeover indicators
3. Bot-like behavior detection
4. Suspicious email patterns
5. Device fingerprint anomalies
```

#### API Endpoints
```typescript
// Monitoring
GET    /health              # Service health check
GET    /metrics             # Prometheus metrics endpoint
GET    /status              # System status overview
GET    /services/status     # Individual service status

// Anomaly Detection
GET    /anomalies           # Current anomalies
POST   /anomalies/report    # Report manual anomaly
GET    /anomalies/:id       # Anomaly details
PUT    /anomalies/:id       # Update anomaly status

// Alerts
GET    /alerts              # Active alerts
POST   /alerts              # Create alert rule
PUT    /alerts/:id          # Update alert rule
DELETE /alerts/:id          # Delete alert rule
POST   /alerts/:id/silence  # Silence alert

// Security
GET    /security/threats    # Active security threats
GET    /security/access     # Access logs
POST   /security/incident   # Report security incident
```

---

## 7. Scheduler Service

### Functional Responsibilities
- **Job Scheduling**: Cron-like job scheduling
- **Workflow Orchestration**: Multi-step workflow management
- **Model Training**: ML model retraining coordination
- **Data Maintenance**: Database cleanup, archival
- **Report Generation**: Scheduled report creation
- **System Maintenance**: Health checks, cache warming

### Technical Implementation

#### Module Structure
```
scheduler-service/
├── src/
│   ├── jobs/
│   │   ├── job.controller.ts         # Job management API
│   │   ├── job.service.ts            # Job execution logic
│   │   ├── scheduler.service.ts      # Job scheduling
│   │   └── history.service.ts        # Job execution history
│   ├── workflows/
│   │   ├── workflow.service.ts       # Workflow orchestration
│   │   ├── step.service.ts           # Workflow step execution
│   │   └── dependency.service.ts     # Dependency management
│   ├── maintenance/
│   │   ├── cleanup.service.ts        # Data cleanup tasks
│   │   ├── archival.service.ts       # Data archival
│   │   └── optimization.service.ts   # Performance optimization
│   ├── training/
│   │   ├── training.service.ts       # Model training coordination
│   │   ├── pipeline.service.ts       # Training pipeline
│   │   └── evaluation.service.ts     # Model evaluation
│   └── reporting/
│       ├── report.service.ts         # Report generation
│       ├── schedule.service.ts       # Report scheduling
│       └── delivery.service.ts       # Report delivery
```

#### Scheduled Jobs
```typescript
// Data Maintenance Jobs
- reconciliation_check      # Every 15 minutes
- data_quality_validation   # Every hour
- cache_cleanup            # Every 6 hours  
- log_rotation             # Daily at 2 AM
- data_archival            # Weekly

// ML Training Jobs
- feature_computation      # Every