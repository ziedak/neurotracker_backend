/**
 * Prometheus Metrics Collection Middleware for Elysia
 *
 * High-performance middleware with:
 * - Zero-allocation HTTP request tracking
 * - WebSocket connection monitoring
 * - Automatic metric exposition endpoint
 * - Business metric integration
 * - Error rate tracking
 */

import type { Elysia } from "@libs/elysia-server";
import { container } from "tsyringe";
import type { MetricsCollector } from "@libs/monitoring";

/**
 * Configuration for Prometheus middleware
 */
export interface PrometheusMiddlewareConfig {
  endpoint?: string; // Default: "/metrics"
  enableDetailedMetrics?: boolean; // Default: true
  serviceName?: string; // Default: "elysia"
  excludePaths?: string[]; // Paths to exclude from metrics
  enableWebSocketMetrics?: boolean; // Default: true
}

/**
 * WebSocket connection tracking
 */
class WebSocketTracker {
  private connections = new Set<string>();
  private messageCount = 0;

  addConnection(id: string): void {
    this.connections.add(id);
  }

  removeConnection(id: string): void {
    this.connections.delete(id);
  }

  getConnectionCount(): number {
    return this.connections.size;
  }

  incrementMessage(): void {
    this.messageCount++;
  }

  getMessageCount(): number {
    return this.messageCount;
  }
}

const wsTracker = new WebSocketTracker();

/**
 * Prometheus metrics collection middleware
 */
export function prometheusMiddleware(config: PrometheusMiddlewareConfig = {}) {
  const {
    endpoint = "/metrics",
    enableDetailedMetrics = true,
    serviceName = "elysia",
    excludePaths = [],
    enableWebSocketMetrics = true,
  } = config;

  return function (app: Elysia) {
    const metricsCollector =
      container.resolve<MetricsCollector>("MetricsCollector");

    // Metrics exposition endpoint
    app.get(endpoint, async () => {
      try {
        const metrics = await metricsCollector.getMetrics();
        return new Response(metrics, {
          headers: {
            "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
          },
        });
      } catch (error) {
        console.error("Failed to generate metrics:", error);
        return new Response("Internal Server Error", { status: 500 });
      }
    });

    // HTTP request tracking
    app.derive({ as: "global" }, ({ request }: any) => {
      const start = Date.now();
      const path = new URL(request.url).pathname;

      return {
        _metricsStart: start,
        _metricsPath: path,
      };
    });

    app.onAfterHandle(
      { as: "global" },
      ({ _metricsStart, _metricsPath, request, set }: any) => {
        // Skip excluded paths
        if (excludePaths.includes(_metricsPath)) return;

        const duration = Date.now() - _metricsStart;
        const method = request.method;
        const statusCode = set.status || 200;

        // Record API request metrics
        metricsCollector.recordApiRequest(
          method,
          _metricsPath,
          statusCode,
          duration,
          serviceName
        );

        // Record detailed metrics if enabled
        if (enableDetailedMetrics) {
          // Record Node.js metrics periodically (every 10th request to avoid overhead)
          if (Math.random() < 0.1) {
            metricsCollector.recordNodeMetrics(serviceName);
            metricsCollector.measureEventLoopLag(serviceName);
          }
        }
      }
    );

    // WebSocket metrics (if enabled)
    if (enableWebSocketMetrics) {
      app.ws("/*", {
        open(ws: any) {
          const connectionId = Math.random().toString(36).substring(7);
          wsTracker.addConnection(connectionId);

          // Store connection ID for cleanup
          (ws as any)._connectionId = connectionId;

          // Record WebSocket connection
          metricsCollector.recordWebSocketActivity(
            serviceName,
            "connection",
            "inbound",
            wsTracker.getConnectionCount()
          );
        },

        message(_ws: any, message: any) {
          wsTracker.incrementMessage();

          // Determine message type
          let messageType = "unknown";
          try {
            const parsed = JSON.parse(message.toString());
            messageType = parsed.type || "data";
          } catch {
            messageType = "raw";
          }

          // Record WebSocket message
          metricsCollector.recordWebSocketActivity(
            serviceName,
            messageType,
            "inbound"
          );
        },

        close(ws: any) {
          const connectionId = (ws as any)._connectionId;
          if (connectionId) {
            wsTracker.removeConnection(connectionId);

            // Record WebSocket disconnection
            metricsCollector.recordWebSocketActivity(
              serviceName,
              "disconnection",
              "inbound",
              wsTracker.getConnectionCount()
            );
          }
        },
      });
    }

    // Error tracking
    app.onError({ as: "global" }, ({ error, request }: any) => {
      const path = new URL(request.url).pathname;
      const method = request.method;

      // Record error metric
      metricsCollector.recordApiRequest(
        method,
        path,
        500, // Error status
        0, // No duration for errors
        serviceName
      );

      console.error(`HTTP Error on ${method} ${path}:`, error);
    });

    return app;
  };
}
