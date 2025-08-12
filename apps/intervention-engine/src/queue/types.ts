export interface QueueJob {
  id: string;
  type: JobType;
  priority: number; // 1-10, higher = more priority
  payload: any;
  attempts: number;
  maxAttempts: number;
  delay?: number; // milliseconds
  scheduledAt: Date;
  processedAt?: Date;
  completedAt?: Date;
  failedAt?: Date;
  error?: string;
  metadata: Record<string, any>;
}

export type JobType =
  | "intervention_delivery"
  | "email_notification"
  | "sms_notification"
  | "push_notification"
  | "campaign_execution"
  | "analytics_processing"
  | "data_export"
  | "cleanup"
  | "webhook_delivery";

export interface JobResult {
  success: boolean;
  data?: any;
  error?: string;
  duration: number;
  metadata?: Record<string, any>;
}

export interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
}

export interface QueueConfig {
  concurrency: number;
  retryAttempts: number;
  retryDelay: number; // milliseconds
  jobTimeout: number; // milliseconds
  cleanupInterval: number; // milliseconds
  maxCompletedJobs: number;
  maxFailedJobs: number;
}

export interface JobProcessor {
  (job: QueueJob): Promise<JobResult>;
}

export interface QueueService {
  // Job management
  addJob(type: JobType, payload: any, options?: JobOptions): Promise<string>;
  getJob(jobId: string): Promise<QueueJob | null>;
  removeJob(jobId: string): Promise<boolean>;
  retryJob(jobId: string): Promise<boolean>;

  // Queue operations
  start(): Promise<void>;
  stop(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  clear(): Promise<void>;

  // Processing
  registerProcessor(type: JobType, processor: JobProcessor): void;
  process(): Promise<void>;

  // Monitoring
  getStats(): Promise<QueueStats>;
  getWaitingJobs(limit?: number): Promise<QueueJob[]>;
  getActiveJobs(): Promise<QueueJob[]>;
  getCompletedJobs(limit?: number): Promise<QueueJob[]>;
  getFailedJobs(limit?: number): Promise<QueueJob[]>;

  // Cleanup
  cleanCompletedJobs(olderThan?: Date): Promise<number>;
  cleanFailedJobs(olderThan?: Date): Promise<number>;
}

export interface JobOptions {
  priority?: number;
  delay?: number;
  maxAttempts?: number;
  timeout?: number;
  metadata?: Record<string, any>;
}
