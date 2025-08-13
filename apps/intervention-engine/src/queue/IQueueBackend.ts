import { QueueJob } from "./types";
export interface IQueueBackend {
  addJob(job: QueueJob): Promise<string>;
  getJob(jobId: string): Promise<QueueJob | null>;
  removeJob(jobId: string): Promise<boolean>;
  processBatchJobs(jobs: QueueJob[]): Promise<string[]>;
  setRateLimit(limit: number): void;
  setPriority(priority: number): void;

  getWaitingJobs(limit?: number): Promise<QueueJob[]>;
  getActiveJobs(): Promise<QueueJob[]>;
  getCompletedJobs(limit?: number): Promise<QueueJob[]>;
  getFailedJobs(limit?: number): Promise<QueueJob[]>;
  cleanCompletedJobs(olderThan?: Date): Promise<number>;
  cleanFailedJobs(olderThan?: Date): Promise<number>;
  performCleanup(): Promise<void>;
}
