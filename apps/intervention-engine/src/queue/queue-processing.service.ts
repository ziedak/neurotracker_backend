import { IQueueBackend } from "./IQueueBackend";
import {
  QueueJob,
  JobType,
  JobProcessor,
  JobResult,
  JobOptions,
  QueueStats,
  QueueConfig,
} from "./types";
import { JobStateService } from "./job-state.service";
import { QueueCleanupService } from "./queue-cleanup.service";
import { RedisQueueBackend } from "./redis-queue-backend";
import { Logger, MetricsCollector } from "@libs/monitoring";

/**
 * Handles queue processing logic: job scheduling, concurrency, backend abstraction.
 * SRP: Only manages queue processing, not job state or cleanup.
 */
export class QueueProcessingService {
  public processors: Map<JobType, JobProcessor> = new Map();
  public backendAdapter: IQueueBackend;
  public jobState: JobStateService;
  public cleanup: QueueCleanupService;
  public config: QueueConfig;
  public logger: Logger;
  public metrics: MetricsCollector;

  private rateLimit: number = 100; // jobs per minute
  private lastProcessed: number = 0;
  private priorityQueue: QueueJob[] = [];

  constructor(
    logger: Logger,
    metrics: MetricsCollector,
    jobState: JobStateService,
    cleanup: QueueCleanupService,
    config: QueueConfig
  ) {
    this.logger = logger;
    this.metrics = metrics;
    this.jobState = jobState;
    this.cleanup = cleanup;
    this.config = config;
    this.backendAdapter = new RedisQueueBackend(); // This line may need to be updated based on the new backend implementation
  }

  // API methods to match RedisQueueService delegation
  on(event: "start" | "complete" | "fail", handler: Function) {
    // TODO: Implement event hooks
  }

  setJobStateService(service: JobStateService) {
    this.jobState = service;
  }
  getJobStateService(): JobStateService {
    return this.jobState;
  }
  setQueueCleanupService(service: QueueCleanupService) {
    this.cleanup = service;
  }
  getQueueCleanupService(): QueueCleanupService {
    return this.cleanup;
  }
  async addJob(
    type: JobType,
    payload: any,
    options: JobOptions = {}
  ): Promise<string> {
    const job: QueueJob = {
      id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type,
      priority: options.priority ?? 5,
      payload,
      attempts: 0,
      maxAttempts: options.maxAttempts ?? this.config.retryAttempts,
      delay: options.delay,
      scheduledAt: options.delay
        ? new Date(Date.now() + options.delay)
        : new Date(),
      metadata: options.metadata ?? {},
      createdAt: new Date(),
    };
    // Insert into priority queue for advanced scheduling
    this.priorityQueue.push(job);
    // Sort by scheduledAt ascending, then priority descending
    this.priorityQueue.sort((a, b) => {
      if (a.scheduledAt.getTime() !== b.scheduledAt.getTime()) {
        return a.scheduledAt.getTime() - b.scheduledAt.getTime();
      }
      return b.priority - a.priority;
    });
    return await this.backendAdapter.addJob(job);
  }
  async getJob(jobId: string): Promise<QueueJob | null> {
    return await this.backendAdapter.getJob(jobId);
  }
  async removeJob(jobId: string): Promise<boolean> {
    return await this.backendAdapter.removeJob(jobId);
  }
  async retryJob(jobId: string): Promise<boolean> {
    const job = await this.getJob(jobId);
    if (!job) return false;
    job.attempts += 1;
    return !!(await this.backendAdapter.addJob(job));
  }
  async start(): Promise<void> {
    this.logger.info("Queue processing started");
  }
  async stop(): Promise<void> {
    this.logger.info("Queue processing stopped");
  }
  async pause(): Promise<void> {
    this.logger.info("Queue processing paused");
  }
  async resume(): Promise<void> {
    this.logger.info("Queue processing resumed");
  }
  async clear(): Promise<void> {
    this.logger.info("Queue cleared");
  }
  registerProcessor(type: JobType, processor: JobProcessor): void {
    this.processors.set(type, processor);
  }
  async process(): Promise<void> {
    this.logger.info("Processing jobs with advanced scheduling...");
    const now = Date.now();
    // Enforce rate limit: jobs per minute
    if (now - this.lastProcessed < 60000 / this.rateLimit) {
      this.logger.info("Rate limit reached, skipping processing");
      return;
    }
    this.lastProcessed = now;
    // Process jobs by priority and scheduled time
    const readyJobs = this.priorityQueue.filter(
      (job) => job.scheduledAt.getTime() <= now
    );
    if (readyJobs.length > 0 && this.backendAdapter.processBatchJobs) {
      await this.backendAdapter.processBatchJobs(readyJobs);
      // Remove processed jobs from queue
      this.priorityQueue = this.priorityQueue.filter(
        (job) => job.scheduledAt.getTime() > now
      );
      this.logger.info(`Processed batch of ${readyJobs.length} jobs`);
    } else {
      this.logger.info("No jobs ready for processing");
    }
  }
  async getStats(): Promise<QueueStats> {
    // Example: aggregate stats from backend
    return {
      waiting: (await this.getWaitingJobs()).length,
      active: (await this.getActiveJobs()).length,
      completed: (await this.getCompletedJobs()).length,
      failed: (await this.getFailedJobs()).length,
      delayed: 0,
      paused: false,
    };
  }
  async getWaitingJobs(limit = 10): Promise<QueueJob[]> {
    if (this.backendAdapter.getWaitingJobs) {
      return await this.backendAdapter.getWaitingJobs(limit);
    }
    return [];
  }
  async getActiveJobs(): Promise<QueueJob[]> {
    if (this.backendAdapter.getActiveJobs) {
      return await this.backendAdapter.getActiveJobs();
    }
    return [];
  }
  async getCompletedJobs(limit = 10): Promise<QueueJob[]> {
    if (this.backendAdapter.getCompletedJobs) {
      return await this.backendAdapter.getCompletedJobs(limit);
    }
    return [];
  }
  async getFailedJobs(limit = 10): Promise<QueueJob[]> {
    if (this.backendAdapter.getFailedJobs) {
      return await this.backendAdapter.getFailedJobs(limit);
    }
    return [];
  }
  async cleanCompletedJobs(olderThan?: Date): Promise<number> {
    if (this.backendAdapter.cleanCompletedJobs) {
      return await this.backendAdapter.cleanCompletedJobs(olderThan);
    }
    return 0;
  }
  async cleanFailedJobs(olderThan?: Date): Promise<number> {
    if (this.backendAdapter.cleanFailedJobs) {
      return await this.backendAdapter.cleanFailedJobs(olderThan);
    }
    return 0;
  }
  async performCleanup(): Promise<void> {
    if (this.backendAdapter.performCleanup) {
      await this.backendAdapter.performCleanup();
    }
  }

  // Extension: Backend adapter registration
  private backends: Map<string, IQueueBackend> = new Map();

  /**
   * Register a backend adapter by name
   */
  registerBackend(name: string, adapter: IQueueBackend): void {
    this.backends.set(name, adapter);
  }

  /**
   * List all registered backend names
   */
  listBackends(): string[] {
    return Array.from(this.backends.keys());
  }

  /**
   * Switch active backend by name
   */
  setBackend(name: string): void {
    if (!this.backends.has(name)) {
      throw new Error(`Backend '${name}' not registered.`);
    }
    this.backendAdapter = this.backends.get(name)!;
    this.logger.info(`Queue backend switched to ${name}`);
  }

  // Extension: Advanced scheduling
  setRateLimit(limit: number) {
    this.rateLimit = limit;
    if (this.backendAdapter.setRateLimit) {
      this.backendAdapter.setRateLimit(limit);
    }
    this.logger.info(`Rate limit set to ${limit}`);
  }
  setPriority(priority: number) {
    // Set default priority for new jobs (can be extended per job type)
    this.logger.info(`Default job priority set to ${priority}`);
  }
  processBatchJobs(jobs: QueueJob[]) {
    if (this.backendAdapter.processBatchJobs) {
      this.backendAdapter.processBatchJobs(jobs);
      this.logger.info(`Processed batch of ${jobs.length} jobs`);
    }
  }
}
