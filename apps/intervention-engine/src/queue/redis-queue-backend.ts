import { RedisClient } from "@libs/database";
import { QueueJob } from "./types";

export class RedisQueueBackend {
  async addJob(job: QueueJob): Promise<string> {
    await this.hset("jobs:data", job.id, JSON.stringify(job));
    await this.zadd("jobs:waiting", Date.now(), job.id);
    return job.id;
  }

  async getJob(jobId: string): Promise<QueueJob | null> {
    const data = await this.hget("jobs:data", jobId);
    return data ? JSON.parse(data) : null;
  }

  async removeJob(jobId: string): Promise<boolean> {
    await this.zrem("jobs:waiting", jobId);
    await this.zrem("jobs:active", jobId);
    await this.zrem("jobs:completed", jobId);
    await this.zrem("jobs:failed", jobId);
    await this.redis.hdel("jobs:data", jobId);
    return true;
  }

  async processBatchJobs(jobs: QueueJob[]): Promise<string[]> {
    const pipeline = this.pipeline();
    for (const job of jobs) {
      pipeline.zrem("jobs:waiting", job.id);
      pipeline.zadd("jobs:active", Date.now(), job.id);
    }
    await pipeline.exec();
    return jobs.map((j) => j.id);
  }

  setRateLimit(limit: number): void {
    // No-op for Redis, placeholder for interface
  }

  setPriority(priority: number): void {
    // No-op for Redis, placeholder for interface
  }

  async getWaitingJobs(limit = 10): Promise<QueueJob[]> {
    const ids = await this.zrevrange("jobs:waiting", 0, limit - 1);
    const jobs = await this.hmget("jobs:data", ...ids);
    return jobs
      .map((j: string | null) => (j ? JSON.parse(j) : null))
      .filter(Boolean);
  }

  async getActiveJobs(): Promise<QueueJob[]> {
    const ids = await this.zrevrange("jobs:active", 0, -1);
    const jobs = await this.hmget("jobs:data", ...ids);
    return jobs
      .map((j: string | null) => (j ? JSON.parse(j) : null))
      .filter(Boolean);
  }

  async getCompletedJobs(limit = 10): Promise<QueueJob[]> {
    const ids = await this.zrevrange("jobs:completed", 0, limit - 1);
    const jobs = await this.hmget("jobs:data", ...ids);
    return jobs
      .map((j: string | null) => (j ? JSON.parse(j) : null))
      .filter(Boolean);
  }

  async getFailedJobs(limit = 10): Promise<QueueJob[]> {
    const ids = await this.zrevrange("jobs:failed", 0, limit - 1);
    const jobs = await this.hmget("jobs:data", ...ids);
    return jobs
      .map((j: string | null) => (j ? JSON.parse(j) : null))
      .filter(Boolean);
  }

  async cleanCompletedJobs(olderThan?: Date): Promise<number> {
    const cutoff = olderThan ? olderThan.getTime() : 0;
    const oldJobs = await this.zrangebyscore("jobs:completed", 0, cutoff);
    if (oldJobs.length > 0) {
      const pipeline = this.pipeline();
      for (const jobId of oldJobs) {
        pipeline.hdel("jobs:data", jobId);
        pipeline.zrem("jobs:completed", jobId);
      }
      await pipeline.exec();
    }
    return oldJobs.length;
  }

  async cleanFailedJobs(olderThan?: Date): Promise<number> {
    const cutoff = olderThan ? olderThan.getTime() : 0;
    const oldJobs = await this.zrangebyscore("jobs:failed", 0, cutoff);
    if (oldJobs.length > 0) {
      const pipeline = this.pipeline();
      for (const jobId of oldJobs) {
        pipeline.hdel("jobs:data", jobId);
        pipeline.zrem("jobs:failed", jobId);
      }
      await pipeline.exec();
    }
    return oldJobs.length;
  }

  async performCleanup(): Promise<void> {
    await this.cleanCompletedJobs();
    await this.cleanFailedJobs();
  }
  private redis: any;

  constructor() {
    this.redis = RedisClient.getInstance();
  }

  async hset(key: string, field: string, value: string) {
    return this.redis.hset(key, field, value);
  }

  async hget(key: string, field: string) {
    return this.redis.hget(key, field);
  }

  async zadd(key: string, score: number, member: string) {
    return this.redis.zadd(key, score, member);
  }

  async zrem(key: string, member: string) {
    return this.redis.zrem(key, member);
  }

  async sadd(key: string, member: string) {
    return this.redis.sadd(key, member);
  }

  async incr(key: string) {
    return this.redis.incr(key);
  }

  pipeline() {
    return this.redis.pipeline();
  }

  async zrevrange(key: string, start: number, stop: number) {
    return this.redis.zrevrange(key, start, stop);
  }

  async smembers(key: string) {
    return this.redis.smembers(key);
  }

  async hmget(key: string, ...fields: string[]) {
    return this.redis.hmget(key, ...fields);
  }

  async zcard(key: string) {
    return this.redis.zcard(key);
  }

  async scard(key: string) {
    return this.redis.scard(key);
  }

  async del(key: string) {
    return this.redis.del(key);
  }

  async zrangebyscore(key: string, min: number, max: number) {
    return this.redis.zrangebyscore(key, min, max);
  }

  // Extension: Cluster support
  connectCluster(clusterConfig: any) {
    // TODO: Implement Redis cluster connection
  }

  // Extension: Transactions
  async runTransaction(commands: any[]): Promise<any> {
    // TODO: Implement transactional logic
    return null;
  }

  // Extension: Pluggable serializer
  setSerializer(serializer: any) {
    // TODO: Implement serializer logic
  }
}
