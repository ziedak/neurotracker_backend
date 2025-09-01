/**
 * Example: Simple Timing Middleware
 * Demonstrates how to extend BaseMiddleware for Elysia applications
 */

import { type ILogger, type IMetricsCollector } from "@libs/monitoring";
import { BaseMiddleware } from "../base/BaseMiddleware";
import { type MiddlewareContext, type MiddlewareOptions } from "../types";

/**
 * Configuration for timing middleware
 */
export interface TimingConfig extends MiddlewareOptions {
  /** Whether to log slow requests */
  logSlowRequests?: boolean;
  /** Threshold in ms for considering a request slow */
  slowThreshold?: number;
  /** Whether to add timing headers to response */
  addTimingHeaders?: boolean;
  /** Custom header name for timing */
  timingHeaderName?: string;
}

/**
 * Simple timing middleware that measures request duration
 * Demonstrates proper BaseMiddleware usage patterns
 */
export class SimpleTimingMiddleware extends BaseMiddleware<TimingConfig> {
  constructor(
    logger: ILogger,
    metrics: IMetricsCollector,
    config: TimingConfig,
    name: string = "timing"
  ) {
    super(
      logger,
      metrics,
      {
        logSlowRequests: true,
        slowThreshold: 1000, // 1 second
        addTimingHeaders: true,
        timingHeaderName: "X-Response-Time",
        ...config,
      },
      name
    );
  }

  /**
   * Core middleware execution logic
   */
  protected async execute(
    context: MiddlewareContext,
    next: () => Promise<void>
  ): Promise<void> {
    const startTime = Date.now();
    const requestId = this.getRequestId(context);

    this.logger.debug("Request timing started", {
      requestId,
      method: context.request.method,
      path: context.request.url,
    });

    try {
      // Execute downstream middleware/handlers
      await next();

      const duration = Date.now() - startTime;

      // Add timing header if enabled
      if (this.config.addTimingHeaders) {
        context.set.headers[this.config.timingHeaderName!] = `${duration}ms`;
      }

      // Log slow requests if enabled
      if (
        this.config.logSlowRequests &&
        duration > (this.config.slowThreshold || 1000)
      ) {
        this.logger.warn("Slow request detected", {
          requestId,
          method: context.request.method,
          path: context.request.url,
          duration,
          threshold: this.config.slowThreshold,
        });
      }

      // Record metrics
      await this.recordTimer("request_duration", duration, {
        method: context.request.method,
        path: this.sanitizePath(context.request.url),
      });

      await this.recordHistogram("request_duration_histogram", duration, {
        method: context.request.method,
      });

      this.logger.debug("Request completed", {
        requestId,
        duration,
        status: context.response?.status || context.set.status,
      });
    } catch (error) {
      const duration = Date.now() - startTime;

      await this.recordTimer("request_duration_error", duration, {
        method: context.request.method,
        path: this.sanitizePath(context.request.url),
      });

      this.logger.error("Request failed", error as Error, {
        requestId,
        duration,
        method: context.request.method,
        path: context.request.url,
      });

      throw error; // Re-throw to maintain error flow
    }
  }

  /**
   * Create new instance with different configuration
   * Required for proper config isolation in elysia() method
   */
  protected override createInstance(
    config: TimingConfig
  ): SimpleTimingMiddleware {
    return new SimpleTimingMiddleware(
      this.logger,
      this.metrics,
      config,
      this.name
    );
  }

  /**
   * Sanitize path for metrics (remove dynamic segments)
   */
  private sanitizePath(path: string): string {
    if (!path) return "/";

    const basePath = path.split("?")[0];
    if (!basePath) return "/";

    return basePath
      .replace(/\/\d+/g, "/:id") // Replace numeric IDs
      .replace(/\/[a-f0-9\-]{36}/g, "/:uuid") // Replace UUIDs
      .replace(/\/[a-f0-9]{24}/g, "/:objectId"); // Replace ObjectIds
  }
}

/**
 * Factory function for creating timing middleware
 */
export function createTimingMiddleware(config: TimingConfig = {}) {
  const logger =
    require("@libs/monitoring").Logger.getInstance("TimingMiddleware");
  const metrics = require("@libs/monitoring").MetricsCollector.getInstance();

  return new SimpleTimingMiddleware(logger, metrics, config);
}

/**
 * Usage examples
 */
export const timingExamples = {
  /**
   * Basic usage with Elysia
   */
  basic: `
import { Elysia } from 'elysia';
import { createTimingMiddleware } from '@libs/middleware';

const timing = createTimingMiddleware({
  slowThreshold: 500,
  logSlowRequests: true
});

const app = new Elysia()
  .use(timing.elysia())
  .get('/', () => 'Hello World');
  `,

  /**
   * Advanced usage with decorators
   */
  advanced: `
import { Elysia } from 'elysia';
import { createTimingMiddleware } from '@libs/middleware';

const timing = createTimingMiddleware({
  addTimingHeaders: true,
  timingHeaderName: 'X-Custom-Timing'
});

const app = new Elysia()
  .use(timing.plugin())
  .get('/', ({ timing }) => {
    return {
      message: 'Hello World',
      timing: timing.config
    };
  });
  `,

  /**
   * Framework-agnostic usage
   */
  frameworkAgnostic: `
import { createTimingMiddleware } from '@libs/middleware';

const timing = createTimingMiddleware();
const middlewareFunction = timing.middleware();

// Use with any framework that supports middleware functions
export { middlewareFunction };
  `,
};
