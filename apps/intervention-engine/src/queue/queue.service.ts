import { RedisClient } from "@libs/database";
import { Logger, MetricsCollector } from "@libs/monitoring";
import {
  QueueService,
  QueueJob,
  JobType,
  JobResult,
  JobProcessor,
  JobOptions,
  QueueStats,
  QueueConfig,
} from "./types";

export class RedisQueueService implements QueueService {
  private processors: Map<JobType, JobProcessor> = new Map();
  private isRunning = false;
  private isPaused = false;
  private processingInterval?: NodeJS.Timeout;
  private cleanupInterval?: NodeJS.Timeout;
  private redis: any;

  private readonly config: QueueConfig = {
    concurrency: 5,
    retryAttempts: 3,
    retryDelay: 5000,
    jobTimeout: 30000,
    cleanupInterval: 300000, // 5 minutes
    maxCompletedJobs: 1000,
    maxFailedJobs: 500,
  };

  constructor(private logger: Logger, private metrics: MetricsCollector) {
    this.redis = RedisClient.getInstance();
  }

  async addJob(
    type: JobType,
    payload: any,
    options: JobOptions = {}
  ): Promise<string> {
    try {
      const jobId = `job_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;
      const now = new Date();

      const job: QueueJob = {
        id: jobId,
        type,
        priority: options.priority || 5,
        payload,
        attempts: 0,
        maxAttempts: options.maxAttempts || this.config.retryAttempts,
        delay: options.delay,
        scheduledAt: options.delay
          ? new Date(now.getTime() + options.delay)
          : now,
        metadata: options.metadata || {},
      };

      // Store job data
      await this.redis.hset("jobs:data", jobId, JSON.stringify(job));

      if (options.delay && options.delay > 0) {
        // Add to delayed queue
        await this.redis.zadd(
          "jobs:delayed",
          now.getTime() + options.delay,
          jobId
        );
      } else {
        // Add to priority queue
        await this.redis.zadd("jobs:waiting", job.priority, jobId);
      }

      // Update stats
      await this.redis.incr("queue:stats:total");

      this.logger.info("Job added to queue", {
        jobId,
        type,
        priority: job.priority,
        delay: options.delay,
      });

      this.metrics.recordCounter("queue.jobs.added", 1, {
        type,
        priority: job.priority.toString(),
      });

      return jobId;
    } catch (error) {
      this.logger.error("Failed to add job to queue", error as Error);
      throw error;
    }
  }

  async getJob(jobId: string): Promise<QueueJob | null> {
    try {
      const data = await this.redis.hget("jobs:data", jobId);

      if (!data) return null;

      return JSON.parse(data) as QueueJob;
    } catch (error) {
      this.logger.error("Failed to get job", error as Error);
      throw error;
    }
  }

  async removeJob(jobId: string): Promise<boolean> {
    try {
      const pipeline = this.redis.pipeline();

      // Remove from all possible queues
      pipeline.hdel("jobs:data", jobId);
      pipeline.zrem("jobs:waiting", jobId);
      pipeline.zrem("jobs:delayed", jobId);
      pipeline.srem("jobs:active", jobId);
      pipeline.zrem("jobs:completed", jobId);
      pipeline.zrem("jobs:failed", jobId);

      const results = await pipeline.exec();

      return (
        results?.some(
          ([err, result]: [Error | null, any]) => !err && result === 1
        ) || false
      );
    } catch (error) {
      this.logger.error("Failed to remove job", error as Error);
      throw error;
    }
  }

  async retryJob(jobId: string): Promise<boolean> {
    try {
      const job = await this.getJob(jobId);
      if (!job) return false;

      // Reset job state
      job.attempts = 0;
      job.processedAt = undefined;
      job.completedAt = undefined;
      job.failedAt = undefined;
      job.error = undefined;

      // Update job data
      await this.redis.hset("jobs:data", jobId, JSON.stringify(job));

      // Move from failed to waiting
      await this.redis.zrem("jobs:failed", jobId);
      await this.redis.zadd("jobs:waiting", job.priority, jobId);

      this.logger.info("Job retried", { jobId });
      this.metrics.recordCounter("queue.jobs.retried", 1, {
        type: job.type,
      });

      return true;
    } catch (error) {
      this.logger.error("Failed to retry job", error as Error);
      throw error;
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    this.isRunning = true;
    this.isPaused = false;

    // Start processing loop
    this.processingInterval = setInterval(() => {
      if (!this.isPaused) {
        this.process().catch((error) => {
          this.logger.error("Processing error", error as Error);
        });
      }
    }, 1000); // Check every second

    // Start cleanup loop
    this.cleanupInterval = setInterval(() => {
      this.performCleanup().catch((error) => {
        this.logger.error("Cleanup error", error as Error);
      });
    }, this.config.cleanupInterval);

    this.logger.info("Queue service started");
  }

  async stop(): Promise<void> {
    this.isRunning = false;

    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = undefined;
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    // Wait for active jobs to complete
    const activeJobs = await this.getActiveJobs();
    if (activeJobs.length > 0) {
      this.logger.info(
        `Waiting for ${activeJobs.length} active jobs to complete`
      );

      // Wait up to 30 seconds for jobs to complete
      let waited = 0;
      while (waited < 30000) {
        const stillActive = await this.getActiveJobs();
        if (stillActive.length === 0) break;

        await new Promise((resolve) => setTimeout(resolve, 1000));
        waited += 1000;
      }
    }

    this.logger.info("Queue service stopped");
  }

  async pause(): Promise<void> {
    this.isPaused = true;
    this.logger.info("Queue service paused");
  }

  async resume(): Promise<void> {
    this.isPaused = false;
    this.logger.info("Queue service resumed");
  }

  async clear(): Promise<void> {
    try {
      const pipeline = this.redis.pipeline();

      pipeline.del("jobs:data");
      pipeline.del("jobs:waiting");
      pipeline.del("jobs:delayed");
      pipeline.del("jobs:active");
      pipeline.del("jobs:completed");
      pipeline.del("jobs:failed");
      pipeline.del("queue:stats:total");

      await pipeline.exec();

      this.logger.info("Queue cleared");
    } catch (error) {
      this.logger.error("Failed to clear queue", error as Error);
      throw error;
    }
  }

  registerProcessor(type: JobType, processor: JobProcessor): void {
    this.processors.set(type, processor);
    this.logger.info("Processor registered", { type });
  }

  async process(): Promise<void> {
    try {
      // Move delayed jobs to waiting if ready
      await this.moveDelayedJobs();

      // Get current active job count
      const activeCount = await this.redis.scard("jobs:active");

      if (activeCount >= this.config.concurrency) {
        return; // At capacity
      }

      // Get next job from waiting queue (highest priority first)
      const jobIds = await this.redis.zrevrange("jobs:waiting", 0, 0);

      if (jobIds.length === 0) {
        return; // No jobs waiting
      }

      const jobId = jobIds[0];

      // Move job to active
      await this.redis.zrem("jobs:waiting", jobId);
      await this.redis.sadd("jobs:active", jobId);

      // Process the job
      await this.processJob(jobId);
    } catch (error) {
      this.logger.error("Processing failed", error as Error);
    }
  }

  private async processJob(jobId: string): Promise<void> {
    let job: QueueJob | null = null;

    try {
      job = await this.getJob(jobId);
      if (!job) {
        this.logger.warn("Job not found during processing", { jobId });
        await this.redis.srem("jobs:active", jobId);
        return;
      }

      const processor = this.processors.get(job.type);
      if (!processor) {
        throw new Error(`No processor registered for job type: ${job.type}`);
      }

      // Update job state
      job.attempts++;
      job.processedAt = new Date();
      await this.redis.hset("jobs:data", jobId, JSON.stringify(job));

      this.logger.info("Processing job", {
        jobId,
        type: job.type,
        attempt: job.attempts,
      });

      // Execute processor with timeout
      const startTime = Date.now();
      const result = await Promise.race([
        processor(job),
        this.createTimeoutPromise(this.config.jobTimeout),
      ]);

      const duration = Date.now() - startTime;

      if (result.success) {
        await this.completeJob(job, result, duration);
      } else {
        await this.failJob(job, result.error || "Job failed", duration);
      }
    } catch (error) {
      const duration = job?.processedAt
        ? Date.now() - job.processedAt.getTime()
        : 0;
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await this.failJob(job!, errorMessage, duration);
    }
  }

  private async completeJob(
    job: QueueJob,
    result: JobResult,
    duration: number
  ): Promise<void> {
    job.completedAt = new Date();

    // Store final job state
    await this.redis.hset("jobs:data", job.id, JSON.stringify(job));

    // Move from active to completed
    await this.redis.srem("jobs:active", job.id);
    await this.redis.zadd("jobs:completed", Date.now(), job.id);

    this.logger.info("Job completed", {
      jobId: job.id,
      type: job.type,
      duration,
    });

    this.metrics.recordCounter("queue.jobs.completed", 1, {
      type: job.type,
    });

    this.metrics.recordHistogram("queue.jobs.duration", duration, {
      type: job.type,
      status: "completed",
    });
  }

  private async failJob(
    job: QueueJob,
    error: string,
    duration: number
  ): Promise<void> {
    job.error = error;

    if (job.attempts < job.maxAttempts) {
      // Retry with exponential backoff
      const delay = this.config.retryDelay * Math.pow(2, job.attempts - 1);
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
      // Max attempts reached, move to failed
      job.failedAt = new Date();

      await this.redis.hset("jobs:data", job.id, JSON.stringify(job));
      await this.redis.srem("jobs:active", job.id);
      await this.redis.zadd("jobs:failed", Date.now(), job.id);

      this.logger.error("Job failed permanently", new Error(error), {
        jobId: job.id,
        type: job.type,
        attempts: job.attempts,
        error: error,
      });

      this.metrics.recordCounter("queue.jobs.failed", 1, {
        type: job.type,
      });
    }

    this.metrics.recordHistogram("queue.jobs.duration", duration, {
      type: job.type,
      status: "failed",
    });
  }

  private async moveDelayedJobs(): Promise<void> {
    const now = Date.now();
    const readyJobs = await this.redis.zrangebyscore("jobs:delayed", 0, now);

    for (const jobId of readyJobs) {
      const job = await this.getJob(jobId);
      if (job) {
        await this.redis.zrem("jobs:delayed", jobId);
        await this.redis.zadd("jobs:waiting", job.priority, jobId);
      }
    }
  }

  private createTimeoutPromise(timeout: number): Promise<JobResult> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Job timed out after ${timeout}ms`));
      }, timeout);
    });
  }

  async getStats(): Promise<QueueStats> {
    try {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        this.redis.zcard("jobs:waiting"),
        this.redis.scard("jobs:active"),
        this.redis.zcard("jobs:completed"),
        this.redis.zcard("jobs:failed"),
        this.redis.zcard("jobs:delayed"),
      ]);

      return {
        waiting,
        active,
        completed,
        failed,
        delayed,
        paused: this.isPaused,
      };
    } catch (error) {
      this.logger.error("Failed to get queue stats", error as Error);
      throw error;
    }
  }

  async getWaitingJobs(limit = 10): Promise<QueueJob[]> {
    return this.getJobsByQueue("jobs:waiting", limit);
  }

  async getActiveJobs(): Promise<QueueJob[]> {
    const jobIds = await this.redis.smembers("jobs:active");
    return this.getJobsById(jobIds);
  }

  async getCompletedJobs(limit = 10): Promise<QueueJob[]> {
    return this.getJobsByQueue("jobs:completed", limit);
  }

  async getFailedJobs(limit = 10): Promise<QueueJob[]> {
    return this.getJobsByQueue("jobs:failed", limit);
  }

  private async getJobsByQueue(
    queueKey: string,
    limit: number
  ): Promise<QueueJob[]> {
    const jobIds = await this.redis.zrevrange(queueKey, 0, limit - 1);
    return this.getJobsById(jobIds);
  }

  private async getJobsById(jobIds: string[]): Promise<QueueJob[]> {
    if (jobIds.length === 0) return [];

    const jobData = await this.redis.hmget("jobs:data", ...jobIds);

    return jobData
      .filter((data: any) => data !== null)
      .map((data: any) => JSON.parse(data!) as QueueJob);
  }

  async cleanCompletedJobs(olderThan?: Date): Promise<number> {
    const cutoff = olderThan
      ? olderThan.getTime()
      : Date.now() - 24 * 60 * 60 * 1000; // 24 hours ago
    return this.cleanJobQueue(
      "jobs:completed",
      cutoff,
      this.config.maxCompletedJobs
    );
  }

  async cleanFailedJobs(olderThan?: Date): Promise<number> {
    const cutoff = olderThan
      ? olderThan.getTime()
      : Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days ago
    return this.cleanJobQueue("jobs:failed", cutoff, this.config.maxFailedJobs);
  }

  private async cleanJobQueue(
    queueKey: string,
    cutoff: number,
    maxJobs: number
  ): Promise<number> {
    try {
      // Remove jobs older than cutoff
      const oldJobs = await this.redis.zrangebyscore(queueKey, 0, cutoff);

      // Remove excess jobs beyond maxJobs limit
      const totalJobs = await this.redis.zcard(queueKey);
      const excessJobs =
        totalJobs > maxJobs
          ? await this.redis.zrange(queueKey, 0, totalJobs - maxJobs - 1)
          : [];

      const jobsToRemove = [...new Set([...oldJobs, ...excessJobs])];

      if (jobsToRemove.length > 0) {
        const pipeline = this.redis.pipeline();

        for (const jobId of jobsToRemove) {
          pipeline.hdel("jobs:data", jobId);
          pipeline.zrem(queueKey, jobId);
        }

        await pipeline.exec();

        this.logger.info("Cleaned up jobs", {
          queue: queueKey,
          removed: jobsToRemove.length,
        });
      }

      return jobsToRemove.length;
    } catch (error) {
      this.logger.error("Failed to clean job queue", error as Error);
      throw error;
    }
  }

  private async performCleanup(): Promise<void> {
    try {
      const [completed, failed] = await Promise.all([
        this.cleanCompletedJobs(),
        this.cleanFailedJobs(),
      ]);

      if (completed > 0 || failed > 0) {
        this.logger.info("Queue cleanup completed", {
          completedJobsRemoved: completed,
          failedJobsRemoved: failed,
        });
      }
    } catch (error) {
      this.logger.error("Queue cleanup failed", error as Error);
    }
  }
}

export { RedisQueueService as QueueService };
