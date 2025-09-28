/**
 * @fileoverview Base Repository Infrastructure for Clean Architecture
 * @module database/repositories/base
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { DatabaseClient } from "../types/DatabaseClient";
import { createLogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";

/**
 * Base repository error class for consistent error handling
 */
export class RepositoryError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly model: string,
    public override readonly cause?: unknown
  ) {
    super(message);
    this.name = "RepositoryError";
  }
}

/**
 * Query options for repository operations
 */
export interface QueryOptions<W = Record<string, unknown>> {
  /** Include related entities */
  include?: Record<string, boolean | object>;
  /** Order by specific fields */
  orderBy?: Record<string, "asc" | "desc">;
  /** Skip records for pagination */
  skip?: number;
  /** Take records for pagination */
  take?: number;
  /** Filter conditions */
  where?: W;
  /** Select specific fields */
  select?: Record<string, boolean>;
}

/**
 * Batch operation result
 */
export interface BatchResult<T> {
  successful: T[];
  failed: Array<{ item: T; error: Error }>;
  stats: {
    total: number;
    successful: number;
    failed: number;
    duration: number;
  };
}

/**
 * Repository metrics for monitoring
 */
export interface RepositoryMetrics {
  operationCount: number;
  errorCount: number;
  averageResponseTime: number;
  lastOperationTime: number;
}

/**
 * Base repository interface defining common CRUD operations
 */
export interface IBaseRepository<
  TModel,
  TCreateInput,
  TUpdateInput,
  TKey = string,
> {
  /**
   * Find entity by primary key
   */
  findById(id: TKey, options?: QueryOptions): Promise<TModel | null>;

  /**
   * Find entities by conditions
   */
  findMany(options?: QueryOptions): Promise<TModel[]>;

  /**
   * Find first entity matching conditions
   */
  findFirst(options?: QueryOptions): Promise<TModel | null>;

  /**
   * Count entities matching conditions
   */
  count(options?: QueryOptions): Promise<number>;

  /**
   * Create new entity
   */
  create(data: TCreateInput): Promise<TModel>;

  /**
   * Create multiple entities
   */
  createMany(data: TCreateInput[]): Promise<TModel[]>;

  /**
   * Update entity by ID
   */
  updateById(id: TKey, data: TUpdateInput): Promise<TModel>;

  /**
   * Update multiple entities
   */
  updateMany(
    where: Record<string, unknown>,
    data: TUpdateInput
  ): Promise<{ count: number }>;

  /**
   * Delete entity by ID
   */
  deleteById(id: TKey): Promise<TModel>;

  /**
   * Delete multiple entities
   */
  deleteMany(where: Record<string, unknown>): Promise<{ count: number }>;

  /**
   * Check if entity exists
   */
  exists(where: Record<string, unknown>): Promise<boolean>;

  /**
   * Execute operation within transaction
   */
  transaction<R>(
    callback: (
      repo: IBaseRepository<TModel, TCreateInput, TUpdateInput, TKey>
    ) => Promise<R>
  ): Promise<R>;

  /**
   * Get repository metrics
   */
  getMetrics(): RepositoryMetrics;
}

/**
 * Abstract base repository implementation with common functionality
 */
export abstract class BaseRepository<
  TModel,
  TCreateInput,
  TUpdateInput,
  TKey = string,
> implements IBaseRepository<TModel, TCreateInput, TUpdateInput, TKey>
{
  protected readonly logger = createLogger(this.constructor.name);
  protected readonly metrics: RepositoryMetrics = {
    operationCount: 0,
    errorCount: 0,
    averageResponseTime: 0,
    lastOperationTime: 0,
  };

  constructor(
    protected readonly db: DatabaseClient,
    protected readonly modelName: string,
    protected readonly metricsCollector?: IMetricsCollector
  ) {}

  /**
   * Execute operation with metrics and error handling
   */
  protected async executeOperation<T>(
    operation: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const startTime = performance.now();

    try {
      this.metrics.operationCount++;
      const result = await fn();

      const duration = performance.now() - startTime;
      this.updateMetrics(duration, false);

      await this.metricsCollector?.recordTimer(
        `repository.${this.modelName}.${operation}.duration`,
        duration
      );
      await this.metricsCollector?.recordCounter(
        `repository.${this.modelName}.${operation}.success`
      );

      return result;
    } catch (error) {
      const duration = performance.now() - startTime;
      this.updateMetrics(duration, true);

      await this.metricsCollector?.recordTimer(
        `repository.${this.modelName}.${operation}.duration`,
        duration
      );
      await this.metricsCollector?.recordCounter(
        `repository.${this.modelName}.${operation}.failure`
      );

      this.logger.error(`Repository operation failed: ${operation}`, error);
      throw new RepositoryError(
        `Failed to ${operation} ${this.modelName}`,
        operation,
        this.modelName,
        error
      );
    }
  }

  /**
   * Update internal metrics
   */
  private updateMetrics(duration: number, isError: boolean): void {
    if (isError) {
      this.metrics.errorCount++;
    }

    // Update rolling average response time
    const totalTime =
      this.metrics.averageResponseTime * (this.metrics.operationCount - 1);
    this.metrics.averageResponseTime =
      (totalTime + duration) / this.metrics.operationCount;
    this.metrics.lastOperationTime = Date.now();
  }

  // Abstract methods to be implemented by concrete repositories
  abstract findById(id: TKey, options?: QueryOptions): Promise<TModel | null>;
  abstract findMany(options?: QueryOptions): Promise<TModel[]>;
  abstract findFirst(options?: QueryOptions): Promise<TModel | null>;
  abstract count(options?: QueryOptions): Promise<number>;
  abstract create(data: TCreateInput): Promise<TModel>;
  abstract createMany(data: TCreateInput[]): Promise<TModel[]>;
  abstract updateById(id: TKey, data: TUpdateInput): Promise<TModel>;
  abstract updateMany(
    where: Record<string, unknown>,
    data: TUpdateInput
  ): Promise<{ count: number }>;
  abstract deleteById(id: TKey): Promise<TModel>;
  abstract deleteMany(
    where: Record<string, unknown>
  ): Promise<{ count: number }>;
  abstract exists(where: Record<string, unknown>): Promise<boolean>;
  abstract transaction<R>(
    callback: (
      repo: BaseRepository<TModel, TCreateInput, TUpdateInput, TKey>
    ) => Promise<R>
  ): Promise<R>;

  /**
   * Get repository metrics
   */
  getMetrics(): RepositoryMetrics {
    return { ...this.metrics };
  }
}
