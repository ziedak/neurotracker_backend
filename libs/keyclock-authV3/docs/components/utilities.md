# Utility Layer

The Utility Layer provides shared utility services that support the authentication and authorization system. These utilities handle cross-cutting concerns like logging, monitoring, configuration, and health checks.

## 3.6.1 AuditLogger

**Purpose:** Provide comprehensive audit logging for security events, authentication activities, and authorization decisions.

**Responsibilities:**

- Log security-relevant events
- Maintain tamper-proof audit trails
- Support compliance requirements
- Provide searchable audit logs
- Handle log retention and archiving
- Support real-time monitoring

**Audit Event Types:**

1. **Authentication Events:** Login, logout, token operations
2. **Authorization Events:** Permission checks, access denials
3. **Security Events:** Failed attempts, suspicious activities
4. **Administrative Events:** Configuration changes, user management
5. **System Events:** Service restarts, configuration loads

**Functions:**

```typescript
logAuthEvent(event: AuthAuditEvent): Promise<void>
```

Log authentication-related events

- Login attempts (success/failure)
- Token operations
- Session management
- **Parameters:** `{ eventType: string, userId?: string, ip: string, userAgent: string, success: boolean, details?: object }`

```typescript
logAuthzEvent(event: AuthzAuditEvent): Promise<void>
```

Log authorization-related events

- Permission checks
- Access grants/denials
- Resource access
- **Parameters:** `{ eventType: string, userId: string, action: string, resource: string, allowed: boolean, reason?: string }`

```typescript
logSecurityEvent(event: SecurityAuditEvent): Promise<void>
```

Log security-relevant events

- Failed authentication attempts
- Suspicious activities
- Security violations
- **Parameters:** `{ eventType: string, severity: 'low'|'medium'|'high'|'critical', details: object, ip: string }`

```typescript
logAdminEvent(event: AdminAuditEvent): Promise<void>
```

Log administrative actions

- User management
- Permission changes
- Configuration updates
- **Parameters:** `{ eventType: string, adminUserId: string, action: string, targetUserId?: string, changes: object }`

```typescript
queryAuditLogs(query: AuditQuery): Promise<AuditLogEntry[]>
```

Query audit logs with filters

- Filter by user, event type, date range
- Support pagination
- **Parameters:** `{ userId?: string, eventType?: string, startDate?: Date, endDate?: Date, limit?: number, offset?: number }`
- **Returns:** array of audit log entries

```typescript
getAuditTrail(userId: string, options?: AuditTrailOptions): Promise<AuditTrail>
```

Get complete audit trail for user

- All events for specific user
- Chronological order
- **Parameters:** userId, options (dateRange, eventTypes, limit)
- **Returns:** `{ userId: string, events: AuditLogEntry[], summary: AuditSummary }`

```typescript
exportAuditLogs(query: AuditQuery, format: 'json'|'csv'): Promise<string>
```

Export audit logs for compliance

- Generate export files
- Support multiple formats
- **Parameters:** query filters, export format
- **Returns:** export data as string

```typescript
archiveAuditLogs(olderThan: Date): Promise<number>
```

Archive old audit logs

- Move to long-term storage
- Compress and encrypt
- **Parameters:** cutoff date
- **Returns:** number of archived entries

```typescript
validateAuditIntegrity(): Promise<IntegrityCheck>
```

Verify audit log integrity

- Check for tampering
- Validate hash chains
- **Returns:** `{ valid: boolean, corruptedEntries?: number, lastValidEntry?: Date }`

```typescript
getAuditMetrics(): Promise<AuditMetrics>
```

Get audit logging statistics

- Event counts by type
- Storage usage
- Query performance
- **Returns:** metrics object

## 3.6.2 MetricsCollector

**Purpose:** Collect and expose metrics for monitoring authentication and authorization system performance and health.

**Responsibilities:**

- Collect performance metrics
- Track error rates and success rates
- Monitor resource usage
- Provide health indicators
- Support alerting and dashboards
- Enable capacity planning

**Metric Categories:**

1. **Performance Metrics:** Response times, throughput
2. **Security Metrics:** Failed auth attempts, suspicious activities
3. **Usage Metrics:** Active users, token issuance
4. **Error Metrics:** Error rates by component
5. **Resource Metrics:** Memory, CPU, database connections

**Functions:**

```typescript
recordAuthMetric(metric: AuthMetric): void
```

Record authentication metrics

- Login success/failure rates
- Token validation times
- Session creation rates
- **Parameters:** `{ metricType: string, value: number, labels: object, timestamp?: Date }`

```typescript
recordAuthzMetric(metric: AuthzMetric): void
```

Record authorization metrics

- Permission check times
- Access denial rates
- Resource access patterns
- **Parameters:** `{ metricType: string, value: number, labels: object }`

```typescript
recordSecurityMetric(metric: SecurityMetric): void
```

Record security-related metrics

- Failed attempt rates
- Suspicious activity counts
- Rate limit hits
- **Parameters:** `{ metricType: string, value: number, severity: string, labels: object }`

```typescript
recordPerformanceMetric(metric: PerformanceMetric): void
```

Record performance metrics

- Response times
- Throughput rates
- Database query times
- **Parameters:** `{ metricType: string, value: number, percentile?: number, labels: object }`

```typescript
getMetricsSnapshot(): Promise<MetricsSnapshot>
```

Get current metrics snapshot

- All active metrics
- Aggregated values
- **Returns:** comprehensive metrics object

```typescript
exportMetrics(format: 'prometheus'|'json'|'statsd'): string
```

Export metrics in standard formats

- Prometheus exposition format
- JSON for custom dashboards
- StatsD for monitoring systems
- **Parameters:** export format
- **Returns:** formatted metrics string

```typescript
resetMetrics(): void
```

Reset all metrics counters

- Clear accumulated values
- Maintain metric definitions
- Used for testing or manual resets

```typescript
createMetricsMiddleware(): ElysiaMiddleware
```

Create middleware for automatic metrics collection

- Track request/response metrics
- Record errors automatically
- **Returns:** Elysia middleware function

```typescript
getHealthMetrics(): Promise<HealthMetrics>
```

Get system health indicators

- Service availability
- Error rates
- Performance thresholds
- **Returns:** `{ status: 'healthy'|'degraded'|'unhealthy', indicators: HealthIndicator[] }`

```typescript
alertOnThreshold(metric: string, threshold: number, condition: 'above'|'below'): void
```

Setup metric-based alerts

- Trigger alerts when metrics cross thresholds
- **Parameters:** metric name, threshold value, condition

## 3.6.3 HealthCheckService

**Purpose:** Provide health check endpoints and monitor system components for availability and performance.

**Responsibilities:**

- Check component availability
- Monitor system resources
- Provide readiness and liveness probes
- Detect and report failures
- Support dependency health checks
- Enable graceful shutdowns

**Health Check Types:**

1. **Liveness Checks:** Is service running?
2. **Readiness Checks:** Is service ready to serve requests?
3. **Dependency Checks:** Are external dependencies healthy?
4. **Resource Checks:** Are system resources adequate?
5. **Custom Checks:** Application-specific health indicators

**Functions:**

```typescript
performHealthCheck(): Promise<HealthStatus>
```

Perform comprehensive health check

- Check all components
- Aggregate results
- **Returns:** `{ status: 'healthy'|'unhealthy', checks: HealthCheckResult[], timestamp: Date }`

```typescript
checkDatabaseHealth(): Promise<HealthCheckResult>
```

Check database connectivity and performance

- Test connection
- Measure query latency
- Check connection pool
- **Returns:** `{ name: 'database', status: 'pass'|'fail', duration: number, details?: object }`

```typescript
checkRedisHealth(): Promise<HealthCheckResult>
```

Check Redis/cache health

- Test connectivity
- Check memory usage
- Verify key operations
- **Returns:** health check result

```typescript
checkIdentityProviderHealth(): Promise<HealthCheckResult>
```

Check identity provider availability

- Test connectivity
- Verify token validation
- Check provider status
- **Returns:** health check result

```typescript
checkResourceHealth(): Promise<HealthCheckResult>
```

Check system resource usage

- Memory usage
- CPU usage
- Disk space
- **Returns:** `{ name: 'resources', status: 'pass'|'warn'|'fail', details: { memory: number, cpu: number, disk: number } }`

```typescript
createHealthEndpoint(): ElysiaHandler
```

Create health check HTTP endpoint

- Expose /health endpoint
- Return JSON health status
- **Returns:** Elysia handler function

```typescript
createReadinessEndpoint(): ElysiaHandler
```

Create readiness probe endpoint

- Check if service can accept traffic
- Include dependency checks
- **Returns:** Elysia handler function

```typescript
createLivenessEndpoint(): ElysiaHandler
```

Create liveness probe endpoint

- Basic service availability check
- Minimal dependency checks
- **Returns:** Elysia handler function

```typescript
registerHealthCheck(name: string, check: HealthCheckFunction): void
```

Register custom health check

- Add application-specific checks
- **Parameters:** check name, check function

```typescript
getHealthHistory(duration: number): Promise<HealthHistory>
```

Get health check history

- Recent health status
- Failure patterns
- **Parameters:** duration in minutes
- **Returns:** array of historical health checks

```typescript
configureHealthChecks(config: HealthConfig): void
```

Configure health check parameters

- Set timeouts, intervals
- Configure failure thresholds
- **Parameters:** health configuration object

## 3.6.4 ConfigManager

**Purpose:** Manage configuration loading, validation, and hot-reloading for the authentication system.

**Responsibilities:**

- Load configuration from multiple sources
- Validate configuration schemas
- Provide typed configuration access
- Support environment-specific configs
- Enable configuration hot-reloading
- Handle configuration secrets securely

**Configuration Sources:**

1. **Environment Variables:** Runtime configuration
2. **Config Files:** JSON/YAML files
3. **Remote Config:** Configuration services
4. **Database Config:** Dynamic configuration
5. **Default Values:** Built-in defaults

**Functions:**

```typescript
loadConfiguration(): Promise<AuthConfig>
```

Load complete configuration

- Merge all sources
- Validate schema
- Apply defaults
- **Returns:** validated configuration object

```typescript
loadFromEnvironment(): Partial<AuthConfig>
```

Load configuration from environment variables

- Parse env vars
- Apply type conversion
- **Returns:** environment configuration

```typescript
loadFromFile(path: string): Promise<Partial<AuthConfig>>
```

Load configuration from file

- Support JSON/YAML formats
- Parse and validate
- **Parameters:** file path
- **Returns:** file configuration

```typescript
validateConfiguration(config: any): ValidationResult
```

Validate configuration against schema

- Check required fields
- Validate field types
- Check value ranges
- **Parameters:** configuration object
- **Returns:** `{ valid: boolean, errors?: ValidationError[] }`

```typescript
getConfigValue<T>(key: string, defaultValue?: T): T
```

Get typed configuration value

- Type-safe access
- Support nested keys
- **Parameters:** config key, optional default
- **Returns:** typed configuration value

```typescript
setConfigValue(key: string, value: any): void
```

Set configuration value

- Runtime configuration updates
- Validate before setting
- **Parameters:** config key, new value

```typescript
watchConfigChanges(callback: ConfigChangeCallback): void
```

Watch for configuration changes

- File changes
- Remote config updates
- **Parameters:** change callback function

```typescript
reloadConfiguration(): Promise<void>
```

Reload configuration from sources

- Hot-reload capability
- Validate new config
- Apply changes gracefully

```typescript
getConfigSchema(): ConfigSchema
```

Get configuration schema

- Field definitions
- Validation rules
- Default values
- **Returns:** schema object

```typescript
maskSecrets(config: AuthConfig): AuthConfig
```

Mask sensitive configuration values

- Hide secrets in logs
- Replace with placeholders
- **Parameters:** configuration object
- **Returns:** masked configuration

```typescript
exportConfiguration(format: 'json'|'yaml'|'env'): string
```

Export configuration in different formats

- For backup or migration
- **Parameters:** export format
- **Returns:** formatted configuration string

```typescript
mergeConfigurations(sources: ConfigSource[]): AuthConfig
```

Merge configurations from multiple sources

- Apply precedence rules
- Handle conflicts
- **Parameters:** array of configuration sources
- **Returns:** merged configuration
