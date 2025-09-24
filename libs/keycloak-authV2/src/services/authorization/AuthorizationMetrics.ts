/**
 * Authorization metrics collector
 * Handles performance metrics and usage tracking
 */

import type { IMetricsCollector } from "@libs/monitoring";
import type {
  AuthorizationContext,
  Action,
  Subjects,
} from "../../types/authorization.types";

export class AuthorizationMetrics {
  constructor(
    private readonly metrics: IMetricsCollector | undefined,
    private readonly enabled: boolean
  ) {}

  /**
   * Record authorization operation metrics
   */
  recordOperation(
    operation: string,
    context: AuthorizationContext,
    action: Action,
    subject: Subjects,
    duration: number
  ): void {
    if (!this.enabled || !this.metrics) return;

    try {
      this.metrics.recordTimer(
        `authorization.${operation}.duration`,
        duration,
        {
          userId: context.userId,
          action,
          subject,
          rolesCount: (context.roles?.length || 0).toString(),
        }
      );

      this.metrics.recordCounter(`authorization.${operation}.total`, 1, {
        action,
        subject,
      });
    } catch (error) {
      // Metrics failures should not break authorization
      // Silently fail to avoid cascading errors
    }
  }

  /**
   * Record cache hit metrics
   */
  recordCacheHit(
    context: AuthorizationContext,
    action: Action,
    subject: Subjects,
    duration: number
  ): void {
    this.recordOperation("cache_hit", context, action, subject, duration);
  }

  /**
   * Record cache miss metrics
   */
  recordCacheMiss(
    context: AuthorizationContext,
    action: Action,
    subject: Subjects,
    duration: number
  ): void {
    this.recordOperation("cache_miss", context, action, subject, duration);
  }

  /**
   * Record cache pending metrics
   */
  recordCachePending(
    context: AuthorizationContext,
    action: Action,
    subject: Subjects,
    duration: number
  ): void {
    this.recordOperation("cache_pending", context, action, subject, duration);
  }

  /**
   * Record authorization check metrics
   */
  recordAuthorizationCheck(
    context: AuthorizationContext,
    action: Action,
    subject: Subjects,
    duration: number
  ): void {
    this.recordOperation(
      "authorization_check",
      context,
      action,
      subject,
      duration
    );
  }

  /**
   * Record authorization error metrics
   */
  recordAuthorizationError(
    context: AuthorizationContext,
    action: Action,
    subject: Subjects,
    duration: number
  ): void {
    this.recordOperation(
      "authorization_error",
      context,
      action,
      subject,
      duration
    );
  }

  /**
   * Record generic counter metric
   */
  recordCounter(
    metric: string,
    value: number,
    tags?: Record<string, string>
  ): void {
    if (!this.enabled || !this.metrics) return;

    try {
      this.metrics.recordCounter(metric, value, tags);
    } catch (error) {
      // Silent fail for metrics
    }
  }

  /**
   * Record generic timer metric
   */
  recordTimer(
    metric: string,
    duration: number,
    tags?: Record<string, string>
  ): void {
    if (!this.enabled || !this.metrics) return;

    try {
      this.metrics.recordTimer(metric, duration, tags);
    } catch (error) {
      // Silent fail for metrics
    }
  }
}
