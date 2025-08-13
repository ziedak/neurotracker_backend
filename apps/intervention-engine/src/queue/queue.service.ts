import { QueueProcessingService } from "./queue-processing.service";
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
import { JobStateService } from "./job-state.service";
import { QueueCleanupService } from "./queue-cleanup.service";

export class RedisQueueService implements QueueService {
  private processingService: QueueProcessingService;
  private queues: Map<string, QueueProcessingService> = new Map();

  constructor(private logger: Logger, private metrics: MetricsCollector) {
    const jobState = new JobStateService(logger, metrics);
    const cleanup = new QueueCleanupService(logger);
    const config: QueueConfig = {
      concurrency: 5,
      retryAttempts: 3,
      retryDelay: 5000,
      jobTimeout: 30000,
      cleanupInterval: 300000,
      maxCompletedJobs: 1000,
      maxFailedJobs: 500,
    };
    this.processingService = new QueueProcessingService(
      logger,
      metrics,
      jobState,
      cleanup,
      config
    );
  }

  // --- Extension Methods ---
  addQueue(
    name: string,
    config?: Partial<QueueConfig>
  ): QueueProcessingService {
    const jobState = new JobStateService(this.logger, this.metrics);
    const cleanup = new QueueCleanupService(this.logger);
    const baseConfig: QueueConfig = {
      concurrency: 5,
      retryAttempts: 3,
      retryDelay: 5000,
      jobTimeout: 30000,
      cleanupInterval: 300000,
      maxCompletedJobs: 1000,
      maxFailedJobs: 500,
    };
    const mergedConfig = { ...baseConfig, ...config };
    const queue = new QueueProcessingService(
      this.logger,
      this.metrics,
      jobState,
      cleanup,
      mergedConfig
    );
    this.queues.set(name, queue);
    return queue;
  }

  getQueueHealth(
    name?: string
  ): Promise<QueueStats> | Record<string, Promise<QueueStats>> {
    if (name) {
      const queue = this.queues.get(name) || this.processingService;
      return queue.getStats();
    }
    // Return health for all queues
    const health: Record<string, Promise<QueueStats>> = {};
    for (const [key, queue] of this.queues.entries()) {
      health[key] = queue.getStats();
    }
    health["default"] = this.processingService.getStats();
    return health;
  }

  reloadConfig(name: string, config: Partial<QueueConfig>): void {
    const queue = this.queues.get(name);
    if (queue) {
      Object.assign(queue.config, config);
    }
  }

  setConcurrency(concurrency: number) {
    this.processingService.config.concurrency = concurrency;
  }
  setRetryAttempts(attempts: number) {
    this.processingService.config.retryAttempts = attempts;
  }
  setRetryDelay(delay: number) {
    this.processingService.config.retryDelay = delay;
  }
  setJobTimeout(timeout: number) {
    this.processingService.config.jobTimeout = timeout;
  }

  on(event: "start" | "complete" | "fail", handler: Function) {
    this.processingService.on(event, handler);
  }

  setBackend(backend: "redis" | "rabbitmq") {
    this.processingService.setBackend(backend);
  }

  setJobStateService(service: JobStateService) {
    this.processingService.setJobStateService(service);
  }
  getJobStateService(): JobStateService {
    return this.processingService.getJobStateService();
  }
  setQueueCleanupService(service: QueueCleanupService) {
    this.processingService.setQueueCleanupService(service);
  }
  getQueueCleanupService(): QueueCleanupService {
    return this.processingService.getQueueCleanupService();
  }

  async addJob(
    type: JobType,
    payload: any,
    options: JobOptions = {}
  ): Promise<string> {
    return this.processingService.addJob(type, payload, options);
  }
  async getJob(jobId: string): Promise<QueueJob | null> {
    return this.processingService.getJob(jobId);
  }
  async removeJob(jobId: string): Promise<boolean> {
    return this.processingService.removeJob(jobId);
  }
  async retryJob(jobId: string): Promise<boolean> {
    return this.processingService.retryJob(jobId);
  }
  async start(): Promise<void> {
    return this.processingService.start();
  }
  async stop(): Promise<void> {
    return this.processingService.stop();
  }
  async pause(): Promise<void> {
    return this.processingService.pause();
  }
  async resume(): Promise<void> {
    return this.processingService.resume();
  }
  async clear(): Promise<void> {
    return this.processingService.clear();
  }
  registerProcessor(type: JobType, processor: JobProcessor): void {
    this.processingService.registerProcessor(type, processor);
  }
  async process(): Promise<void> {
    return this.processingService.process();
  }
  async getStats(): Promise<QueueStats> {
    return this.processingService.getStats();
  }
  async getWaitingJobs(limit = 10): Promise<QueueJob[]> {
    return this.processingService.getWaitingJobs(limit);
  }
  async getActiveJobs(): Promise<QueueJob[]> {
    return this.processingService.getActiveJobs();
  }
  async getCompletedJobs(limit = 10): Promise<QueueJob[]> {
    return this.processingService.getCompletedJobs(limit);
  }
  async getFailedJobs(limit = 10): Promise<QueueJob[]> {
    return this.processingService.getFailedJobs(limit);
  }
  async cleanCompletedJobs(olderThan?: Date): Promise<number> {
    return this.processingService.cleanCompletedJobs(olderThan);
  }
  async cleanFailedJobs(olderThan?: Date): Promise<number> {
    return this.processingService.cleanFailedJobs(olderThan);
  }
  private async performCleanup(): Promise<void> {
    return this.processingService.performCleanup();
  }
}

export { RedisQueueService as QueueService };
