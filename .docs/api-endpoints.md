# Complete API Endpoints List - Cart Recovery Platform

## 1. Core Platform Service (Port 3000)

### **External API Gateway Endpoints**

#### Authentication & User Management
```
POST   /api/auth/login              # User login
POST   /api/auth/logout             # User logout
POST   /api/auth/refresh            # Token refresh
GET    /api/auth/me                 # Current user info
POST   /api/auth/register           # User registration
POST   /api/auth/forgot-password    # Password reset request
POST   /api/auth/reset-password     # Password reset confirmation
```

#### API Key Management
```
GET    /api/keys                    # List API keys
POST   /api/keys                    # Create API key
PUT    /api/keys/:id                # Update API key
DELETE /api/keys/:id                # Revoke API key
GET    /api/keys/:id                # Get API key details
```

#### Store Management
```
GET    /api/stores                  # List stores (admin only)
POST   /api/stores                  # Create store
GET    /api/stores/:id              # Get store details
PUT    /api/stores/:id              # Update store
DELETE /api/stores/:id              # Delete store
GET    /api/stores/:id/settings     # Get store settings
PUT    /api/stores/:id/settings     # Update store settings
```

#### Configuration Management
```
GET    /api/config                  # Get configuration
PUT    /api/config                  # Update configuration
GET    /api/feature-flags           # Get feature flags
PUT    /api/feature-flags/:flag     # Toggle feature flag
GET    /api/config/stores/:storeId  # Store-specific config
PUT    /api/config/stores/:storeId  # Update store config
```

### **Internal Service Endpoints**

#### Service Authentication
```
POST   /internal/auth/validate      # Validate service tokens
POST   /internal/auth/service-token # Generate service tokens
GET    /internal/auth/permissions   # Get service permissions
```

#### Service Configuration
```
GET    /internal/config/:serviceId  # Get service config
PUT    /internal/config/:serviceId  # Update service config
GET    /internal/services/discover/:name # Service discovery
```

#### Health & Monitoring
```
GET    /health                      # Basic health check
GET    /health/detailed             # Detailed health status
GET    /internal/health/detailed    # Internal health check
GET    /metrics                     # Prometheus metrics
GET    /status                      # System status overview
```

---

## 2. Event Pipeline Service (Port 3001)

### **External Event Ingestion**
```
WS     /events/stream               # WebSocket event ingestion
POST   /api/events                  # Single event (REST fallback)
POST   /api/events/batch            # Batch event processing
GET    /api/events/stats            # Ingestion statistics
```

### **Internal Service Endpoints**

#### Event Processing
```
POST   /internal/events/process     # Internal event processing
GET    /internal/events/status      # Processing status
POST   /internal/events/reprocess   # Reprocess failed events
GET    /internal/events/metrics     # Processing metrics
```

#### Schema Management
```
GET    /internal/schemas            # List available schemas
POST   /internal/schemas            # Register new schema
GET    /internal/schemas/:version   # Get specific schema
PUT    /internal/schemas/:version   # Update schema
DELETE /internal/schemas/:version   # Delete schema
```

#### Dead Letter Queue
```
GET    /internal/dlq/events         # List DLQ events
POST   /internal/dlq/retry/:id      # Retry failed event
DELETE /internal/dlq/events/:id     # Delete DLQ event
GET    /internal/dlq/stats          # DLQ statistics
```

#### Health & Monitoring
```
GET    /health                      # Service health
GET    /internal/health/detailed    # Detailed health check
GET    /metrics                     # Prometheus metrics
GET    /pipeline/status             # Pipeline health status
```

---

## 3. AI Engine Service (Port 3002)

### **External Prediction API**
```
POST   /api/predict                 # Single prediction
POST   /api/predict/batch           # Batch predictions
GET    /api/predict/:cartId         # Get cached prediction
POST   /api/features/compute        # Trigger feature computation
GET    /api/models                  # List available models
```

### **Internal Service Endpoints**

#### Core Prediction
```
POST   /internal/predict/single     # Single cart prediction
POST   /internal/predict/batch      # Batch prediction processing
GET    /internal/predict/:cartId    # Get prediction by cart ID
POST   /internal/predict/features   # Predict with custom features
```

#### Feature Management
```
GET    /internal/features/:cartId   # Get computed features
POST   /internal/features/compute   # Trigger feature computation
GET    /internal/features/definitions # Feature schema
POST   /internal/features/validate  # Validate features
GET    /internal/features/stats     # Feature statistics
```

#### Model Management
```
GET    /internal/models             # List available models
POST   /internal/models/:version/load   # Load model version
POST   /internal/models/:version/unload # Unload model version
GET    /internal/models/:version/status # Model status
PUT    /internal/models/:version/config # Update model config
GET    /internal/models/performance # Model performance metrics
```

#### A/B Testing
```
GET    /internal/experiments        # List active experiments
POST   /internal/experiments        # Create A/B test
PUT    /internal/experiments/:id    # Update experiment
DELETE /internal/experiments/:id    # End experiment
GET    /internal/experiments/:id/results # Experiment results
```

#### Training & MLOps
```
POST   /internal/training/trigger   # Trigger model training
GET    /internal/training/status    # Training job status
POST   /internal/training/deploy    # Deploy trained model
GET    /internal/training/history   # Training history
GET    /internal/drift              # Model drift detection
```

#### Health & Monitoring
```
GET    /health                      # Service health
GET    /internal/health/detailed    # Detailed health check
GET    /metrics                     # Prometheus metrics
GET    /models/health               # Model health status
```

---

## 4. Intervention Engine Service (Port 3003)

### **External WebSocket & API**
```
WS     /ws/store/:storeId           # Store WebSocket connection
WS     /ws/user/:userId             # User WebSocket connection
GET    /api/interventions/performance # Intervention analytics
GET    /api/templates               # List available templates
```

### **Internal Service Endpoints**

#### Core Interventions
```
POST   /internal/interventions/trigger        # Trigger intervention
POST   /internal/interventions/bulk-trigger   # Bulk intervention trigger
GET    /internal/interventions/:id            # Get intervention details
PUT    /internal/interventions/:id            # Update intervention
DELETE /internal/interventions/:id            # Cancel intervention
GET    /internal/interventions/queue          # View intervention queue
```

#### Delivery Management
```
POST   /internal/delivery/websocket  # WebSocket delivery
POST   /internal/delivery/email      # Email delivery
POST   /internal/delivery/sms        # SMS delivery
POST   /internal/delivery/push       # Push notification delivery
GET    /internal/delivery/status/:id # Delivery status
POST   /internal/delivery/retry/:id  # Retry failed delivery
```

#### Tracking & Analytics
```
POST   /internal/track/:interventionId # Track intervention events
GET    /internal/track/:interventionId # Get intervention tracking
POST   /internal/conversions           # Record conversion events
GET    /internal/analytics/performance # Intervention performance
GET    /internal/analytics/channels    # Channel effectiveness
GET    /internal/analytics/conversion  # Conversion funnel
```

#### Templates & Campaigns
```
GET    /internal/templates            # List templates
POST   /internal/templates            # Create template
PUT    /internal/templates/:id        # Update template
DELETE /internal/templates/:id        # Delete template
GET    /internal/campaigns            # List campaigns
POST   /internal/campaigns            # Create campaign
PUT    /internal/campaigns/:id        # Update campaign
DELETE /internal/campaigns/:id        # Delete campaign
```

#### User Preferences
```
GET    /internal/preferences/:userId  # Get user preferences
PUT    /internal/preferences/:userId  # Update user preferences
POST   /internal/optout/:userId       # Opt user out
POST   /internal/optin/:userId        # Opt user back in
```

#### Health & Monitoring
```
GET    /health                       # Service health
GET    /internal/health/detailed     # Detailed health check
GET    /metrics                      # Prometheus metrics
GET    /connections/status           # WebSocket connection status
```

---

## 5. Data Platform Service (Port 3004)

### **External Analytics API**
```
GET    /api/analytics/overview       # High-level metrics
GET    /api/analytics/conversion     # Conversion funnel
GET    /api/analytics/revenue        # Revenue attribution
GET    /api/analytics/performance    # Model performance
POST   /api/reports/generate         # Generate custom report
GET    /api/reports/:id              # Download report
GET    /api/export/events            # Export event data
```

### **Internal Service Endpoints**

#### Feature Store
```
GET    /internal/features/:cartId           # Get features for cart
GET    /internal/features/realtime/:cartId  # Get real-time features
POST   /internal/features/compute           # Trigger feature computation
GET    /internal/features/definitions       # Feature definitions
POST   /internal/features/batch             # Batch feature requests
PUT    /internal/features/update/:cartId    # Update cart features
```

#### Analytics & Reporting
```
GET    /internal/analytics/store/:storeId   # Store analytics
GET    /internal/analytics/user/:userId     # User analytics
GET    /internal/analytics/campaign/:id     # Campaign analytics
POST   /internal/analytics/query            # Custom analytics query
GET    /internal/analytics/realtime         # Real-time analytics
POST   /internal/reports/schedule           # Schedule report
GET    /internal/reports/status/:id         # Report generation status
```

#### Data Quality
```
GET    /internal/quality/status            # Data quality overview
GET    /internal/quality/alerts            # Active quality alerts
POST   /internal/quality/validate          # Manual validation trigger
GET    /internal/quality/metrics           # Quality metrics
POST   /internal/quality/rules             # Create quality rule
GET    /internal/anomalies                 # Data anomalies
```

#### Data Reconciliation
```
POST   /internal/reconciliation/trigger    # Trigger reconciliation
GET    /internal/reconciliation/status     # Reconciliation status
GET    /internal/reconciliation/reports    # Reconciliation reports
POST   /internal/reconciliation/repair     # Repair data inconsistencies
GET    /internal/reconciliation/schedule   # Reconciliation schedule
```

#### GDPR Compliance
```
POST   /internal/gdpr/forget/:userId       # Right to be forgotten
GET    /internal/gdpr/export/:userId       # Data export request
GET    /internal/gdpr/status/:requestId    # Request status
POST   /internal/gdpr/consent/:userId      # Update consent
GET    /internal/gdpr/audit                # GDPR audit trail
```

#### ETL & Data Processing
```
POST   /internal/etl/jobs                  # Create ETL job
GET    /internal/etl/jobs/:id              # Get ETL job status
DELETE /internal/etl/jobs/:id              # Cancel ETL job
GET    /internal/etl/pipelines             # List data pipelines
POST   /internal/etl/pipelines             # Create data pipeline
PUT    /internal/etl/pipelines/:id         # Update pipeline
```

#### Health & Monitoring
```
GET    /health                             # Service health
GET    /internal/health/detailed           # Detailed health check
GET    /metrics                            # Prometheus metrics
GET    /storage/usage                      # Storage usage statistics
```

---

## 6. Monitoring & Anomaly Detection Service (Port 3005)

### **External Monitoring API**
```
GET    /api/dashboard/overview       # Monitoring dashboard data
GET    /api/alerts                   # Active alerts
POST   /api/alerts/acknowledge/:id   # Acknowledge alert
GET    /api/metrics/custom           # Custom metrics query
GET    /api/health/system            # System-wide health
```

### **Internal Service Endpoints**

#### Metrics Collection
```
GET    /internal/metrics/collect     # Trigger metrics collection
POST   /internal/metrics/custom      # Submit custom metrics
GET    /internal/metrics/services    # Service-specific metrics
GET    /internal/metrics/aggregate   # Aggregated metrics
POST   /internal/metrics/export      # Export metrics data
```

#### Anomaly Detection
```
GET    /internal/anomalies           # Current anomalies
POST   /internal/anomalies/report    # Report manual anomaly
GET    /internal/anomalies/:id       # Anomaly details
PUT    /internal/anomalies/:id       # Update anomaly status
POST   /internal/anomalies/rules     # Create detection rule
GET    /internal/fraud/patterns      # Fraud detection patterns
```

#### Alerting System
```
GET    /internal/alerts              # Active alerts
POST   /internal/alerts              # Create alert rule
PUT    /internal/alerts/:id          # Update alert rule
DELETE /internal/alerts/:id          # Delete alert rule
POST   /internal/alerts/:id/silence  # Silence alert
GET    /internal/alerts/history      # Alert history
POST   /internal/alerts/test         # Test alert rule
```

#### Log Management
```
GET    /internal/logs/search         # Search logs
GET    /internal/logs/aggregate      # Log aggregation
POST   /internal/logs/export         # Export logs
GET    /internal/logs/patterns       # Log pattern analysis
GET    /internal/logs/errors         # Error log analysis
```

#### Distributed Tracing
```
GET    /internal/traces/:traceId     # Get trace details
GET    /internal/traces/search       # Search traces
GET    /internal/traces/performance  # Performance analysis
GET    /internal/traces/errors       # Error trace analysis
POST   /internal/traces/analyze      # Analyze trace patterns
```

#### Security Monitoring
```
GET    /internal/security/threats    # Active security threats
GET    /internal/security/access     # Access logs
POST   /internal/security/incident   # Report security incident
GET    /internal/security/audit      # Security audit trail
GET    /internal/security/violations # Policy violations
```

#### Health & System Status
```
GET    /health                       # Service health
GET    /internal/health/detailed     # Detailed health check
GET    /metrics                      # Prometheus metrics endpoint
GET    /status/services              # All services status
GET    /status/infrastructure        # Infrastructure status
```

---

## 7. Scheduler Service (Port 3006)

### **External Scheduler API**
```
GET    /api/jobs                     # List scheduled jobs
POST   /api/jobs                     # Create scheduled job
GET    /api/jobs/:id                 # Get job details
PUT    /api/jobs/:id                 # Update job
DELETE /api/jobs/:id                 # Delete job
POST   /api/jobs/:id/trigger         # Manually trigger job
```

### **Internal Service Endpoints**

#### Job Management
```
GET    /internal/jobs                # List all jobs
POST   /internal/jobs/trigger        # Trigger job on service
GET    /internal/jobs/:id/status     # Get job status
POST   /internal/jobs/:id/cancel     # Cancel running job
GET    /internal/jobs/history        # Job execution history
POST   /internal/jobs/schedule       # Schedule new job
```

#### Workflow Orchestration
```
GET    /internal/workflows           # List workflows
POST   /internal/workflows           # Create workflow
GET    /internal/workflows/:id       # Get workflow details
PUT    /internal/workflows/:id       # Update workflow
DELETE /internal/workflows/:id       # Delete workflow
POST   /internal/workflows/:id/execute # Execute workflow
GET    /internal/workflows/:id/status  # Workflow status
```

#### ML Training Coordination
```
POST   /internal/training/schedule   # Schedule model training
GET    /internal/training/queue      # Training job queue
POST   /internal/training/trigger/:modelId # Trigger training
GET    /internal/training/status/:jobId    # Training job status
POST   /internal/training/cancel/:jobId    # Cancel training job
```

#### System Maintenance
```
POST   /internal/maintenance/cleanup     # Trigger cleanup jobs
POST   /internal/maintenance/backup      # Trigger backup jobs
POST   /internal/maintenance/optimize    # Trigger optimization
GET    /internal/maintenance/schedule    # Maintenance schedule
PUT    /internal/maintenance/schedule    # Update schedule
```

#### Report Scheduling
```
GET    /internal/reports/scheduled       # List scheduled reports
POST   /internal/reports/schedule        # Schedule report generation
PUT    /internal/reports/schedule/:id    # Update report schedule
DELETE /internal/reports/schedule/:id    # Cancel scheduled report
POST   /internal/reports/trigger/:id     # Trigger report generation
```

#### Health & Monitoring
```
GET    /health                          # Service health
GET    /internal/health/detailed        # Detailed health check
GET    /metrics                         # Prometheus metrics
GET    /scheduler/status                # Scheduler status
GET    /jobs/statistics                 # Job execution statistics
```

---

## Global Health & Status Endpoints

### **System-wide Health Checks**
```
GET    /health                          # Individual service health
GET    /health/detailed                 # Detailed service health
GET    /status                          # Service status overview
GET    /metrics                         # Prometheus metrics (all services)
GET    /version                         # Service version info
```

## API Endpoint Summary by Category

### **Authentication & Authorization** (17 endpoints)
- User management: login, logout, register, password reset
- API key management: CRUD operations
- Service-to-service authentication
- Permission management

### **Event Processing** (12 endpoints)  
- Event ingestion: WebSocket, REST, batch
- Schema management and validation
- Dead letter queue handling
- Processing status and metrics

### **AI & Machine Learning** (23 endpoints)
- Prediction services: single, batch, cached
- Feature engineering and serving
- Model management and deployment
- A/B testing framework
- MLOps and training coordination

### **Interventions & Delivery** (28 endpoints)
- Real-time intervention triggering
- Multi-channel delivery (WebSocket, email, SMS, push)
- Tracking and analytics
- Template and campaign management
- User preference management

### **Data & Analytics** (31 endpoints)
- Feature store operations
- Business intelligence and reporting
- Data quality and reconciliation
- GDPR compliance
- ETL and data pipeline management

### **Monitoring & Observability** (24 endpoints)
- Metrics collection and analysis
- Anomaly and fraud detection
- Alerting and notification
- Log management and tracing
- Security monitoring

### **Scheduling & Orchestration** (18 endpoints)
- Job scheduling and execution
- Workflow orchestration
- ML training coordination
- System maintenance automation
- Report scheduling

### **Health & System Status** (7 endpoints per service = 49 total)
- Individual service health checks
- Detailed system status
- Prometheus metrics
- Performance monitoring

## **Total: 202 API Endpoints**

### **Breakdown by Service:**
- **Core Platform**: 29 endpoints
- **Event Pipeline**: 16 endpoints  
- **AI Engine**: 30 endpoints
- **Intervention Engine**: 35 endpoints
- **Data Platform**: 38 endpoints
- **Monitoring Service**: 31 endpoints
- **Scheduler Service**: 23 endpoints

### **Breakdown by Access Level:**
- **External APIs** (via API Gateway): 47 endpoints
- **Internal Service-to-Service**: 155 endpoints
- **Health & Monitoring**: 49 endpoints (accessible both internally and externally)

This comprehensive API specification provides clear contracts for all service interactions while maintaining security through proper authentication and authorization mechanisms.