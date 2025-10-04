# Background Jobs & Task Processing

Comprehensive background job processing system for handling asynchronous tasks, scheduled operations, and long-running processes in the authentication library.

## Job Queue Architecture

### Job Manager

```typescript
class JobManager {
  private queues = new Map<string, JobQueue>();
  private workers = new Map<string, WorkerPool>();
  private schedulers = new Map<string, JobScheduler>();

  async enqueueJob<T extends JobData>(
    jobType: string,
    data: T,
    options: JobOptions = {}
  ): Promise<Job<T>> {
    const queue = this.queues.get(jobType);
    if (!queue) {
      throw new UnsupportedJobTypeError(jobType);
    }

    const job: Job<T> = {
      id: crypto.randomUUID(),
      type: jobType,
      data,
      status: "queued",
      priority: options.priority || "normal",
      createdAt: new Date(),
      updatedAt: new Date(),
      maxRetries: options.maxRetries || 3,
      retryCount: 0,
      delay: options.delay || 0,
      timeout: options.timeout || 300000, // 5 minutes
      tags: options.tags || [],
    };

    await queue.enqueue(job);
    await this.metrics.recordJobEnqueued(jobType);

    return job;
  }

  async processJob(jobId: string): Promise<void> {
    const job = await this.findJob(jobId);
    if (!job) {
      throw new JobNotFoundError(jobId);
    }

    const worker = this.workers.get(job.type);
    if (!worker) {
      throw new NoWorkerAvailableError(job.type);
    }

    try {
      job.status = "processing";
      job.startedAt = new Date();
      job.updatedAt = new Date();
      await this.updateJob(job);

      // Execute job with timeout
      const result = await this.executeWithTimeout(
        () => worker.process(job),
        job.timeout
      );

      job.status = "completed";
      job.completedAt = new Date();
      job.result = result;
      await this.updateJob(job);
      await this.metrics.recordJobCompleted(job.type);
    } catch (error) {
      await this.handleJobFailure(job, error);
    }
  }

  private async handleJobFailure(job: Job, error: Error): Promise<void> {
    job.retryCount++;
    job.lastError = {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    };

    if (job.retryCount < job.maxRetries) {
      // Schedule retry with exponential backoff
      const delay = Math.min(1000 * Math.pow(2, job.retryCount), 300000); // Max 5 minutes
      job.status = "retrying";
      job.nextRetryAt = new Date(Date.now() + delay);
      await this.schedulers.get("retry")?.schedule(job, delay);
    } else {
      job.status = "failed";
      await this.metrics.recordJobFailed(job.type);
      await this.alertManager.alertJobFailure(job, error);
    }

    job.updatedAt = new Date();
    await this.updateJob(job);
  }

  async scheduleRecurringJob(
    jobType: string,
    data: any,
    schedule: RecurringSchedule
  ): Promise<string> {
    const scheduler = this.schedulers.get("recurring");
    if (!scheduler) {
      throw new SchedulerNotAvailableError();
    }

    const jobId = await scheduler.scheduleRecurring(jobType, data, schedule);
    await this.metrics.recordRecurringJobScheduled(jobType);

    return jobId;
  }

  getJobStats(): JobStats {
    return {
      queued: this.countJobsByStatus("queued"),
      processing: this.countJobsByStatus("processing"),
      completed: this.countJobsByStatus("completed"),
      failed: this.countJobsByStatus("failed"),
      retrying: this.countJobsByStatus("retrying"),
    };
  }
}
```

### Job Queue Implementations

```typescript
class RedisJobQueue implements JobQueue {
  constructor(private redis: RedisClient) {}

  async enqueue<T>(job: Job<T>): Promise<void> {
    const jobData = JSON.stringify(job);
    const score = this.calculatePriorityScore(job);

    await this.redis.zadd(`queue:${job.type}`, score, jobData);

    // Add to job index
    await this.redis.hset("jobs", job.id, jobData);
  }

  async dequeue(jobType: string): Promise<Job | null> {
    const result = await this.redis.zpopmin(`queue:${jobType}`, 1);

    if (result.length === 0) {
      return null;
    }

    const jobData = result[0];
    const job: Job = JSON.parse(jobData);

    // Mark as processing
    job.status = "processing";
    await this.redis.hset("jobs", job.id, JSON.stringify(job));

    return job;
  }

  async getJob(jobId: string): Promise<Job | null> {
    const jobData = await this.redis.hget("jobs", jobId);
    return jobData ? JSON.parse(jobData) : null;
  }

  private calculatePriorityScore(job: Job): number {
    const priorityWeights = { high: 0, normal: 1, low: 2 };
    const baseScore = priorityWeights[job.priority] * 1000000;
    const timeScore = job.delay > 0 ? Date.now() + job.delay : Date.now();

    return baseScore + timeScore;
  }
}

class DatabaseJobQueue implements JobQueue {
  constructor(private db: DatabaseClient) {}

  async enqueue<T>(job: Job<T>): Promise<void> {
    await this.db.insert("jobs", {
      id: job.id,
      type: job.type,
      data: JSON.stringify(job.data),
      status: job.status,
      priority: job.priority,
      created_at: job.createdAt,
      updated_at: job.updatedAt,
      max_retries: job.maxRetries,
      retry_count: job.retryCount,
      delay: job.delay,
      timeout: job.timeout,
      tags: JSON.stringify(job.tags),
    });
  }

  async dequeue(jobType: string): Promise<Job | null> {
    // Use database transaction to ensure atomicity
    return await this.db.transaction(async (tx) => {
      const job = await tx.queryOne(
        `SELECT * FROM jobs
         WHERE type = $1 AND status = 'queued'
         AND (delay = 0 OR created_at + INTERVAL '1 millisecond' * delay <= NOW())
         ORDER BY
           CASE priority
             WHEN 'high' THEN 1
             WHEN 'normal' THEN 2
             WHEN 'low' THEN 3
           END,
           created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        [jobType]
      );

      if (!job) return null;

      // Mark as processing
      await tx.update("jobs", job.id, {
        status: "processing",
        started_at: new Date(),
        updated_at: new Date(),
      });

      return this.deserializeJob(job);
    });
  }

  private deserializeJob(row: any): Job {
    return {
      id: row.id,
      type: row.type,
      data: JSON.parse(row.data),
      status: row.status,
      priority: row.priority,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      startedAt: row.started_at,
      maxRetries: row.max_retries,
      retryCount: row.retry_count,
      delay: row.delay,
      timeout: row.timeout,
      tags: JSON.parse(row.tags || "[]"),
    };
  }
}
```

## Worker Pool Management

### Worker Pool

```typescript
class WorkerPool {
  private workers: Worker[] = [];
  private availableWorkers: Worker[] = [];
  private jobQueue: Job[] = [];
  private isShutdown = false;

  constructor(
    private jobType: string,
    private processor: JobProcessor,
    private options: WorkerPoolOptions = {}
  ) {
    const {
      minWorkers = 2,
      maxWorkers = 10,
      maxJobsPerWorker = 100,
      idleTimeout = 30000,
    } = options;

    this.minWorkers = minWorkers;
    this.maxWorkers = maxWorkers;
    this.maxJobsPerWorker = maxJobsPerWorker;
    this.idleTimeout = idleTimeout;

    this.initializeWorkers();
  }

  async process(job: Job): Promise<any> {
    if (this.isShutdown) {
      throw new WorkerPoolShutdownError();
    }

    return new Promise((resolve, reject) => {
      this.jobQueue.push({ job, resolve, reject });
      this.assignJob();
    });
  }

  private initializeWorkers(): void {
    for (let i = 0; i < this.minWorkers; i++) {
      this.createWorker();
    }
  }

  private createWorker(): Worker {
    const worker: Worker = {
      id: crypto.randomUUID(),
      status: "idle",
      jobsProcessed: 0,
      createdAt: new Date(),
      lastActiveAt: new Date(),
    };

    worker.process = this.createJobProcessor(worker);
    this.workers.push(worker);
    this.availableWorkers.push(worker);

    return worker;
  }

  private createJobProcessor(worker: Worker) {
    return async (job: Job): Promise<any> => {
      worker.status = "busy";
      worker.lastActiveAt = new Date();

      try {
        const result = await this.processor.process(job);
        worker.jobsProcessed++;
        return result;
      } finally {
        worker.status = "idle";
        worker.lastActiveAt = new Date();

        // Check if worker should be terminated
        if (this.shouldTerminateWorker(worker)) {
          this.terminateWorker(worker);
        } else {
          this.availableWorkers.push(worker);
          this.assignJob();
        }
      }
    };
  }

  private assignJob(): void {
    if (this.jobQueue.length === 0 || this.availableWorkers.length === 0) {
      return;
    }

    const worker = this.availableWorkers.shift()!;
    const { job, resolve, reject } = this.jobQueue.shift()!;

    worker.process(job).then(resolve).catch(reject);
  }

  private shouldTerminateWorker(worker: Worker): boolean {
    const isOverMaxJobs = worker.jobsProcessed >= this.maxJobsPerWorker;
    const isIdleTooLong =
      Date.now() - worker.lastActiveAt.getTime() > this.idleTimeout;
    const hasTooManyWorkers = this.workers.length > this.minWorkers;

    return (isOverMaxJobs || isIdleTooLong) && hasTooManyWorkers;
  }

  private terminateWorker(worker: Worker): void {
    const index = this.workers.indexOf(worker);
    if (index > -1) {
      this.workers.splice(index, 1);
    }

    // Remove from available workers if present
    const availableIndex = this.availableWorkers.indexOf(worker);
    if (availableIndex > -1) {
      this.availableWorkers.splice(availableIndex, 1);
    }
  }

  async shutdown(): Promise<void> {
    this.isShutdown = true;

    // Wait for all jobs to complete
    while (this.jobQueue.length > 0) {
      await this.delay(100);
    }

    // Terminate all workers
    for (const worker of this.workers) {
      this.terminateWorker(worker);
    }
  }

  getStats(): WorkerPoolStats {
    return {
      totalWorkers: this.workers.length,
      availableWorkers: this.availableWorkers.length,
      busyWorkers: this.workers.filter((w) => w.status === "busy").length,
      queuedJobs: this.jobQueue.length,
      totalJobsProcessed: this.workers.reduce(
        (sum, w) => sum + w.jobsProcessed,
        0
      ),
    };
  }
}
```

### Job Schedulers

```typescript
class JobScheduler {
  private scheduledJobs = new Map<string, ScheduledJob>();

  async schedule(job: Job, delay: number): Promise<void> {
    const scheduledJob: ScheduledJob = {
      id: crypto.randomUUID(),
      jobId: job.id,
      executeAt: new Date(Date.now() + delay),
      status: "scheduled",
    };

    this.scheduledJobs.set(scheduledJob.id, scheduledJob);

    // Schedule execution
    setTimeout(() => {
      this.executeScheduledJob(scheduledJob);
    }, delay);
  }

  async scheduleRecurring(
    jobType: string,
    data: any,
    schedule: RecurringSchedule
  ): Promise<string> {
    const recurringJob: RecurringJob = {
      id: crypto.randomUUID(),
      jobType,
      data,
      schedule,
      nextRun: this.calculateNextRun(schedule),
      status: "active",
    };

    this.recurringJobs.set(recurringJob.id, recurringJob);

    // Schedule first run
    this.scheduleNextRun(recurringJob);

    return recurringJob.id;
  }

  private calculateNextRun(schedule: RecurringSchedule): Date {
    const now = new Date();

    switch (schedule.type) {
      case "cron":
        return this.parseCronExpression(schedule.expression);
      case "interval":
        return new Date(now.getTime() + schedule.interval);
      case "daily":
        const next = new Date(now);
        next.setHours(schedule.hour, schedule.minute, 0, 0);
        if (next <= now) {
          next.setDate(next.getDate() + 1);
        }
        return next;
      case "weekly":
        return this.calculateWeekly(schedule);
      default:
        throw new InvalidScheduleError(schedule.type);
    }
  }

  private async executeScheduledJob(scheduledJob: ScheduledJob): Promise<void> {
    try {
      const job = await this.jobManager.getJob(scheduledJob.jobId);
      if (!job) return;

      await this.jobManager.processJob(job.id);
      scheduledJob.status = "executed";
    } catch (error) {
      scheduledJob.status = "failed";
      await this.handleScheduleFailure(scheduledJob, error);
    }
  }

  private scheduleNextRun(recurringJob: RecurringJob): void {
    const delay = recurringJob.nextRun.getTime() - Date.now();

    setTimeout(async () => {
      if (recurringJob.status === "active") {
        // Enqueue the job
        await this.jobManager.enqueueJob(
          recurringJob.jobType,
          recurringJob.data
        );

        // Schedule next run
        recurringJob.nextRun = this.calculateNextRun(recurringJob.schedule);
        this.scheduleNextRun(recurringJob);
      }
    }, delay);
  }
}
```

## Built-in Job Types

### Authentication Jobs

```typescript
class TokenCleanupJob implements JobProcessor<TokenCleanupData> {
  async process(job: Job<TokenCleanupData>): Promise<void> {
    const { userId, tokenTypes } = job.data;

    for (const tokenType of tokenTypes) {
      const expiredTokens = await this.tokenRepo.findExpiredTokens(
        userId,
        tokenType
      );

      for (const token of expiredTokens) {
        await this.tokenRepo.delete(token.id);
        await this.auditLog.log("token_expired", { tokenId: token.id, userId });
      }
    }
  }
}

class SessionCleanupJob implements JobProcessor<SessionCleanupData> {
  async process(job: Job<SessionCleanupData>): Promise<void> {
    const expiredSessions = await this.sessionRepo.findExpiredSessions();

    for (const session of expiredSessions) {
      await this.sessionRepo.delete(session.id);
      await this.cache.invalidate(`session:${session.id}`);

      // Log session expiration
      await this.auditLog.log("session_expired", {
        sessionId: session.id,
        userId: session.userId,
        expiredAt: session.expiresAt,
      });
    }
  }
}

class FailedLoginTrackerJob implements JobProcessor<FailedLoginData> {
  async process(job: Job<FailedLoginData>): Promise<void> {
    const { userId, ipAddress, userAgent } = job.data;

    // Record failed login attempt
    await this.failedLoginRepo.recordAttempt({
      userId,
      ipAddress,
      userAgent,
      attemptedAt: new Date(),
    });

    // Check if account should be locked
    const recentAttempts = await this.failedLoginRepo.getRecentAttempts(
      userId,
      15 * 60 * 1000
    ); // 15 minutes

    if (recentAttempts >= 5) {
      await this.userRepo.lockAccount(userId, "too_many_failed_attempts");
      await this.notificationService.sendAccountLockedEmail(userId);
      await this.auditLog.log("account_locked", {
        userId,
        reason: "too_many_failed_attempts",
      });
    }
  }
}
```

### Maintenance Jobs

```typescript
class DatabaseMaintenanceJob implements JobProcessor<DatabaseMaintenanceData> {
  async process(job: Job<DatabaseMaintenanceData>): Promise<void> {
    const { operations } = job.data;

    for (const operation of operations) {
      switch (operation) {
        case "vacuum":
          await this.db.vacuum();
          break;
        case "reindex":
          await this.db.reindex();
          break;
        case "analyze":
          await this.db.analyze();
          break;
        case "cleanup":
          await this.cleanupOrphanedRecords();
          break;
      }
    }
  }

  private async cleanupOrphanedRecords(): Promise<void> {
    // Clean up orphaned sessions
    await this.db.execute(`
      DELETE FROM sessions
      WHERE user_id NOT IN (SELECT id FROM users)
    `);

    // Clean up orphaned tokens
    await this.db.execute(`
      DELETE FROM tokens
      WHERE user_id NOT IN (SELECT id FROM users)
    `);

    // Clean up old audit logs (keep last 90 days)
    await this.db.execute(`
      DELETE FROM audit_logs
      WHERE created_at < NOW() - INTERVAL '90 days'
    `);
  }
}

class CacheMaintenanceJob implements JobProcessor<CacheMaintenanceData> {
  async process(job: Job<CacheMaintenanceData>): Promise<void> {
    // Clean up expired cache entries
    await this.cache.cleanup();

    // Rebuild frequently accessed data
    await this.rebuildHotDataCache();

    // Update cache statistics
    const stats = await this.cache.getStats();
    await this.metrics.recordCacheStats(stats);
  }

  private async rebuildHotDataCache(): Promise<void> {
    const hotUsers = await this.analytics.getMostActiveUsers(1000);

    for (const user of hotUsers) {
      const userData = await this.userRepo.findById(user.id);
      if (userData) {
        await this.cache.set(`user:${user.id}`, userData, 3600); // 1 hour
      }
    }
  }
}

class MetricsAggregationJob implements JobProcessor<MetricsAggregationData> {
  async process(job: Job<MetricsAggregationData>): Promise<void> {
    const { timeRange, granularity } = job.data;

    // Aggregate authentication metrics
    await this.aggregateAuthMetrics(timeRange, granularity);

    // Aggregate performance metrics
    await this.aggregatePerformanceMetrics(timeRange, granularity);

    // Aggregate error metrics
    await this.aggregateErrorMetrics(timeRange, granularity);

    // Update dashboards
    await this.updateMetricsDashboards();
  }

  private async aggregateAuthMetrics(
    timeRange: TimeRange,
    granularity: Granularity
  ): Promise<void> {
    const metrics = await this.metricsRepo.getAuthMetrics(timeRange);

    const aggregated = this.aggregateByGranularity(metrics, granularity, {
      logins: "sum",
      registrations: "sum",
      token_issuances: "sum",
      failed_auth_attempts: "sum",
    });

    await this.metricsRepo.storeAggregatedMetrics("auth", aggregated);
  }
}
```

### Notification Jobs

```typescript
class EmailNotificationJob implements JobProcessor<EmailNotificationData> {
  async process(job: Job<EmailNotificationData>): Promise<void> {
    const { to, template, data, priority } = job.data;

    // Render email template
    const html = await this.templateEngine.render(template, data);
    const text = await this.templateEngine.renderText(template, data);
    const subject = await this.templateEngine.renderSubject(template, data);

    // Send email
    await this.emailService.send({
      to,
      subject,
      html,
      text,
      priority: priority || "normal",
    });

    // Log notification
    await this.auditLog.log("email_sent", {
      to,
      template,
      jobId: job.id,
    });
  }
}

class WebhookNotificationJob implements JobProcessor<WebhookNotificationData> {
  async process(job: Job<WebhookNotificationData>): Promise<void> {
    const { url, payload, secret, retries } = job.data;

    const signature = crypto
      .createHmac("sha256", secret)
      .update(JSON.stringify(payload))
      .digest("hex");

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": signature,
        "X-Webhook-ID": crypto.randomUUID(),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new WebhookDeliveryError(url, response.status);
    }
  }
}

class PushNotificationJob implements JobProcessor<PushNotificationData> {
  async process(job: Job<PushNotificationData>): Promise<void> {
    const { userId, title, body, data, platforms } = job.data;

    // Get user's push tokens
    const tokens = await this.pushTokenRepo.getUserTokens(userId, platforms);

    // Send to each platform
    const results = await Promise.allSettled(
      tokens.map((token) =>
        this.sendPushNotification(token, { title, body, data })
      )
    );

    // Clean up invalid tokens
    const failedTokens = results
      .map((result, index) => ({ result, token: tokens[index] }))
      .filter(({ result }) => result.status === "rejected")
      .map(({ token }) => token);

    for (const token of failedTokens) {
      await this.pushTokenRepo.removeToken(token.id);
    }
  }

  private async sendPushNotification(
    token: PushToken,
    notification: any
  ): Promise<void> {
    switch (token.platform) {
      case "ios":
        await this.apns.send(token.token, notification);
        break;
      case "android":
        await this.fcm.send(token.token, notification);
        break;
      case "web":
        await this.webPush.send(token.token, notification);
        break;
    }
  }
}
```

## Job Monitoring and Alerting

### Job Metrics Collector

```typescript
class JobMetricsCollector {
  private metrics = new Map<string, JobMetrics>();

  async recordJobEnqueued(jobType: string): Promise<void> {
    const key = `job_enqueued_${jobType}`;
    await this.incrementCounter(key);
  }

  async recordJobCompleted(jobType: string, duration: number): Promise<void> {
    const key = `job_completed_${jobType}`;
    await this.incrementCounter(key);
    await this.recordTimer(`job_duration_${jobType}`, duration);
  }

  async recordJobFailed(jobType: string, error?: Error): Promise<void> {
    const key = `job_failed_${jobType}`;
    await this.incrementCounter(key);

    if (error) {
      await this.incrementCounter(`job_error_${error.name}`);
    }
  }

  async recordWorkerStats(
    jobType: string,
    stats: WorkerPoolStats
  ): Promise<void> {
    await this.gauge(`workers_total_${jobType}`, stats.totalWorkers);
    await this.gauge(`workers_available_${jobType}`, stats.availableWorkers);
    await this.gauge(`workers_busy_${jobType}`, stats.busyWorkers);
    await this.gauge(`jobs_queued_${jobType}`, stats.queuedJobs);
  }

  getJobMetrics(jobType?: string): JobMetrics[] {
    if (jobType) {
      return [this.metrics.get(jobType)].filter(Boolean);
    }

    return Array.from(this.metrics.values());
  }

  private async incrementCounter(key: string): Promise<void> {
    const current = this.metrics.get(key)?.count || 0;
    this.metrics.set(key, { ...this.metrics.get(key), count: current + 1 });
  }

  private async recordTimer(key: string, duration: number): Promise<void> {
    const metrics = this.metrics.get(key) || { timers: [] };
    metrics.timers = metrics.timers || [];
    metrics.timers.push(duration);
  }

  private async gauge(key: string, value: number): Promise<void> {
    const metrics = this.metrics.get(key) || {};
    metrics.gauge = value;
    this.metrics.set(key, metrics);
  }
}
```

### Job Alert Manager

```typescript
class JobAlertManager {
  private alerts = new Map<string, JobAlertRule>();

  async checkJobAlerts(): Promise<void> {
    const jobStats = await this.jobManager.getJobStats();
    const workerStats = await this.workerManager.getAllWorkerStats();

    // Check queue depth
    if (jobStats.queued > 1000) {
      await this.alert("high_queue_depth", {
        queued: jobStats.queued,
        severity: "warning",
      });
    }

    // Check failed jobs
    if (jobStats.failed > 100) {
      await this.alert("high_failure_rate", {
        failed: jobStats.failed,
        severity: "error",
      });
    }

    // Check worker pool health
    for (const [jobType, stats] of Object.entries(workerStats)) {
      if (stats.availableWorkers === 0 && stats.queuedJobs > 50) {
        await this.alert("no_available_workers", {
          jobType,
          queuedJobs: stats.queuedJobs,
          severity: "error",
        });
      }
    }
  }

  async alertJobFailure(job: Job, error: Error): Promise<void> {
    await this.alert("job_failure", {
      jobId: job.id,
      jobType: job.type,
      error: error.message,
      retryCount: job.retryCount,
      maxRetries: job.maxRetries,
      severity: job.retryCount >= job.maxRetries ? "error" : "warning",
    });
  }

  private async alert(alertType: string, data: any): Promise<void> {
    const rule = this.alerts.get(alertType);
    if (!rule) return;

    const alert = {
      id: crypto.randomUUID(),
      type: alertType,
      severity: data.severity,
      message: rule.message(data),
      data,
      timestamp: new Date().toISOString(),
    };

    // Send to alerting system
    await this.alertingService.sendAlert(alert);

    // Log alert
    await this.logger.warn("Job alert triggered", alert);
  }
}
```

## Job Configuration and Management

### Job Configuration

```typescript
interface JobConfiguration {
  queues: {
    [jobType: string]: {
      queue: "redis" | "database" | "memory";
      priority: "high" | "normal" | "low";
      maxRetries: number;
      timeout: number;
      concurrency: number;
      rateLimit?: {
        max: number;
        window: number;
      };
    };
  };

  workers: {
    [jobType: string]: {
      minWorkers: number;
      maxWorkers: number;
      maxJobsPerWorker: number;
      idleTimeout: number;
    };
  };

  schedulers: {
    recurring: {
      enabled: boolean;
      timezone: string;
    };
    retry: {
      enabled: boolean;
      maxDelay: number;
    };
  };

  monitoring: {
    enabled: boolean;
    metrics: {
      enabled: boolean;
      interval: number;
    };
    alerts: {
      enabled: boolean;
      rules: JobAlertRule[];
    };
  };
}
```

### Job Registry

```typescript
class JobRegistry {
  private jobTypes = new Map<string, JobTypeDefinition>();
  private processors = new Map<string, JobProcessor>();

  registerJobType(definition: JobTypeDefinition): void {
    this.jobTypes.set(definition.type, definition);

    // Register processor
    this.processors.set(definition.type, definition.processor);

    // Register with job manager
    this.jobManager.registerJobType(definition);
  }

  getJobType(jobType: string): JobTypeDefinition | undefined {
    return this.jobTypes.get(jobType);
  }

  getProcessor(jobType: string): JobProcessor | undefined {
    return this.processors.get(jobType);
  }

  getAllJobTypes(): JobTypeDefinition[] {
    return Array.from(this.jobTypes.values());
  }

  validateJobData(jobType: string, data: any): ValidationResult {
    const definition = this.jobTypes.get(jobType);
    if (!definition) {
      return { valid: false, errors: [`Unknown job type: ${jobType}`] };
    }

    return definition.schema.validate(data);
  }
}
```
