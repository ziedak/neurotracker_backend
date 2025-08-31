import { RedisClient } from "@libs/database";
import { Logger, MetricsCollector } from "@libs/monitoring";
import { QueueJob, JobResult } from "./types";

export class JobStateService {
  private redis: any;
  constructor(private logger: ILogger, private metrics: MetricsCollector) {
    this.redis = RedisClient.getInstance();
  }

  // Extension: Custom job states
  async quarantineJob(job: QueueJob): Promise<void> {
    job.metadata.quarantinedAt = new Date();
    await this.redis.hset("jobs:data", job.id, JSON.stringify(job));
    await this.redis.srem("jobs:active", job.id);
    await this.redis.zadd("jobs:quarantined", Date.now(), job.id);
    this.logger.warn("Job quarantined", { jobId: job.id, type: job.type });
    await this.sendAlert(job, "quarantined");
  }

  // Extension: External persistence
  async persistJobState(job: QueueJob): Promise<void> {
    // Example: persist job state to external DB (stub)
    // Replace with actual DB integration
    this.logger.info("Persisting job state to external DB", {
      jobId: job.id,
      state: job,
    });
    // await externalDb.saveJobState(job);
  }
  async fetchJobHistory(jobId: string): Promise<any> {
    // Example: fetch job history from external DB (stub)
    this.logger.info("Fetching job history from external DB", { jobId });
    // return await externalDb.getJobHistory(jobId);
    return null;
  }

  async pauseJob(job: QueueJob): Promise<void> {
    job.pausedAt = new Date();
    await this.redis.hset("jobs:data", job.id, JSON.stringify(job));
    await this.redis.srem("jobs:active", job.id);
    await this.redis.zadd("jobs:paused", Date.now(), job.id);
    this.logger.info("Job paused", { jobId: job.id, type: job.type });
  }

  async cancelJob(job: QueueJob, reason: string): Promise<void> {
    job.cancelledAt = new Date();
    job.cancelReason = reason;
    await this.redis.hset("jobs:data", job.id, JSON.stringify(job));
    await this.redis.srem("jobs:active", job.id);
    await this.redis.zadd("jobs:cancelled", Date.now(), job.id);
    this.logger.warn("Job cancelled", {
      jobId: job.id,
      type: job.type,
      reason,
    });
    // External alerting integration (stub)
    this.sendAlert(job, reason);
  }

  async sendAlert(job: QueueJob, reason: string): Promise<void> {
    // Integrate with external alerting/notification system
    // Example: send to webhook, email, or monitoring system
    this.logger.info("External alert triggered", { jobId: job.id, reason });
    // TODO: Implement actual alert integration
  }

  async customRetry(
    job: QueueJob,
    error: string,
    duration: number,
    config: {
      retryDelay: number;
      backoffStrategy?: (attempt: number) => number;
    }
  ): Promise<void> {
    job.error = error;
    let delay = config.retryDelay;
    if (config.backoffStrategy) {
      delay = config.backoffStrategy(job.attempts);
    }
    if (job.attempts < job.maxAttempts) {
      job.scheduledAt = new Date(Date.now() + delay);
      await this.redis.hset("jobs:data", job.id, JSON.stringify(job));
      await this.redis.srem("jobs:active", job.id);
      await this.redis.zadd("jobs:delayed", Date.now() + delay, job.id);
      this.logger.warn("Job failed, will retry (custom)", {
        jobId: job.id,
        type: job.type,
        attempt: job.attempts,
        maxAttempts: job.maxAttempts,
        retryIn: delay,
      });
    } else {
      job.failedAt = new Date();
      await this.redis.hset("jobs:data", job.id, JSON.stringify(job));
      await this.redis.srem("jobs:active", job.id);
      await this.redis.zadd("jobs:failed", Date.now(), job.id);
      this.logger.error("Job failed permanently (custom)", new Error(error), {
        jobId: job.id,
        type: job.type,
        attempts: job.attempts,
        error,
      });
      this.metrics.recordCounter("queue.jobs.failed", 1, { type: job.type });
      // External alerting integration
      await this.sendAlert(job, error);
    }
    this.metrics.recordHistogram("queue.jobs.duration", duration, {
      type: job.type,
      status: "failed",
    });
  }

  async moveJobToQueue(job: QueueJob, queueName: string): Promise<void> {
    await this.redis.srem("jobs:active", job.id);
    await this.redis.zadd(queueName, Date.now(), job.id);
    this.logger.info("Job moved to queue", { jobId: job.id, queue: queueName });
  }

  async completeJob(
    job: QueueJob,
    result: JobResult,
    duration: number
  ): Promise<void> {
    job.completedAt = new Date();
    await this.redis.hset("jobs:data", job.id, JSON.stringify(job));
    await this.redis.srem("jobs:active", job.id);
    await this.redis.zadd("jobs:completed", Date.now(), job.id);
    this.logger.info("Job completed", {
      jobId: job.id,
      type: job.type,
      duration,
    });
    this.metrics.recordCounter("queue.jobs.completed", 1, { type: job.type });
    this.metrics.recordHistogram("queue.jobs.duration", duration, {
      type: job.type,
      status: "completed",
    });
  }

  async failJob(
    job: QueueJob,
    error: string,
    duration: number,
    config: { retryDelay: number }
  ): Promise<void> {
    job.error = error;
    if (job.attempts < job.maxAttempts) {
      const delay = config.retryDelay * Math.pow(2, job.attempts - 1);
      job.scheduledAt = new Date(Date.now() + delay);
      await this.redis.hset("jobs:data", job.id, JSON.stringify(job));
      await this.redis.srem("jobs:active", job.id);
      await this.redis.zadd("jobs:delayed", Date.now() + delay, job.id);
      this.logger.warn("Job failed, will retry", {
        jobId: job.id,
        type: job.type,
        attempt: job.attempts,
        maxAttempts: job.maxAttempts,
        retryIn: delay,
      });
    } else {
      job.failedAt = new Date();
      await this.redis.hset("jobs:data", job.id, JSON.stringify(job));
      await this.redis.srem("jobs:active", job.id);
      await this.redis.zadd("jobs:failed", Date.now(), job.id);
      this.logger.error("Job failed permanently", new Error(error), {
        jobId: job.id,
        type: job.type,
        attempts: job.attempts,
        error,
      });
      this.metrics.recordCounter("queue.jobs.failed", 1, { type: job.type });
    }
    this.metrics.recordHistogram("queue.jobs.duration", duration, {
      type: job.type,
      status: "failed",
    });
  }
}
