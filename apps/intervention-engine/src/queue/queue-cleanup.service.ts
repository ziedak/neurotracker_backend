import { RedisClient } from "@libs/database";
import { Logger } from "@libs/monitoring";

export class QueueCleanupService {
  /**
   * Clean any queue (including cancelled, archived)
   */
  async cleanQueue(
    queueKey: string,
    cutoff: number,
    maxJobs: number
  ): Promise<number> {
    const oldJobs = await this.redis.zrangebyscore(queueKey, 0, cutoff);
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
    // Metrics/reporting
    // TODO: Integrate with metrics system if available
    return jobsToRemove.length;
  }

  /**
   * Advanced retention: clean by job type or user
   */
  async cleanByTypeOrUser(
    queueKey: string,
    cutoff: number,
    maxJobs: number,
    filter: { type?: string; userId?: string }
  ): Promise<number> {
    const jobIds = await this.redis.zrange(queueKey, 0, -1);
    let jobsToRemove: string[] = [];
    for (const jobId of jobIds) {
      const data = await this.redis.hget("jobs:data", jobId);
      if (!data) continue;
      const job = JSON.parse(data);
      if (
        (filter.type && job.type === filter.type) ||
        (filter.userId && job.userId === filter.userId)
      ) {
        if (job.scheduledAt && new Date(job.scheduledAt).getTime() < cutoff) {
          jobsToRemove.push(jobId);
        }
      }
    }
    if (jobsToRemove.length > maxJobs) {
      jobsToRemove = jobsToRemove.slice(0, maxJobs);
    }
    if (jobsToRemove.length > 0) {
      const pipeline = this.redis.pipeline();
      for (const jobId of jobsToRemove) {
        pipeline.hdel("jobs:data", jobId);
        pipeline.zrem(queueKey, jobId);
      }
      await pipeline.exec();
      this.logger.info("Advanced cleanup", {
        queue: queueKey,
        removed: jobsToRemove.length,
        filter,
      });
    }
    // Metrics/reporting
    // TODO: Integrate with metrics system if available
    return jobsToRemove.length;
  }

  /**
   * Schedule cleanup based on external triggers/events
   */
  async scheduleCleanup(
    queueKey: string,
    cutoff: number,
    maxJobs: number,
    trigger: () => boolean
  ): Promise<number> {
    if (trigger()) {
      return this.cleanQueue(queueKey, cutoff, maxJobs);
    }
    this.logger.info("Cleanup skipped: trigger not met", { queue: queueKey });
    return 0;
  }
  private redis: any;
  private retentionPolicy: {
    maxCompletedAge?: number;
    maxFailedAge?: number;
    maxCompletedJobs?: number;
    maxFailedJobs?: number;
  } = {};
  constructor(private logger: Logger) {
    this.redis = RedisClient.getInstance();
  }

  async cleanJobQueue(
    queueKey: string,
    cutoff: number,
    maxJobs: number
  ): Promise<number> {
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
  }
  // Extension: Retention policy
  setRetentionPolicy(policy: {
    maxCompletedAge?: number;
    maxFailedAge?: number;
    maxCompletedJobs?: number;
    maxFailedJobs?: number;
  }) {
    this.retentionPolicy = { ...this.retentionPolicy, ...policy };
    this.logger.info("Retention policy updated", {
      policy: this.retentionPolicy,
    });
  }

  // Extension: Archiving
  async archiveJobs(queueKey: string): Promise<void> {
    // Example: move jobs to external archive (stub)
    const jobs = await this.redis.zrange(queueKey, 0, -1);
    for (const jobId of jobs) {
      const data = await this.redis.hget("jobs:data", jobId);
      if (data) {
        // await externalArchive.save(jobId, data);
        this.logger.info("Archived job", { jobId });
      }
      await this.redis.hdel("jobs:data", jobId);
      await this.redis.zrem(queueKey, jobId);
    }
    this.logger.info("Archiving complete", {
      queue: queueKey,
      count: jobs.length,
    });
  }

  // Extension: Metrics export
  exportMetrics() {
    // Example: export metrics to external system (stub)
    const metrics = {
      timestamp: new Date().toISOString(),
      completedJobs: this.retentionPolicy.maxCompletedJobs,
      failedJobs: this.retentionPolicy.maxFailedJobs,
      // Add more metrics as needed
    };
    this.logger.info("Exporting queue metrics", metrics);
    // await externalMetrics.export(metrics);
    return metrics;
  }
}
