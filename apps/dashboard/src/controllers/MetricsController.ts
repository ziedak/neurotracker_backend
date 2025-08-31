import { Logger } from "@libs/monitoring";
import { MetricsService } from "../services/MetricsService";

export interface MetricsRequest {
  dateFrom?: string;
  dateTo?: string;
  granularity?: "hour" | "day" | "week" | "month";
  metrics?: string[];
  filters?: Record<string, any>;
}

export interface ReportRequest {
  type: string;
  format?: "json" | "csv";
  dateRange?: {
    from: string;
    to: string;
  };
  filters?: Record<string, any>;
}

/**
 * Metrics Controller for Dashboard
 * Handles metrics collection, reporting, and real-time data
 */
export class MetricsController {
  private readonly metricsService: MetricsService;
  private readonly logger: ILogger;

  constructor(metricsService: MetricsService, logger: ILogger) {
    this.metricsService = metricsService;
    this.logger = logger;
  }

  /**
   * Get live metrics
   */
  async getLiveMetrics(): Promise<any> {
    try {
      this.logger.info("Getting live metrics");

      const metrics = await this.metricsService.getRealTimeMetrics();

      return {
        success: true,
        metrics,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to get live metrics", error as Error);
      return {
        success: false,
        error: "Failed to retrieve live metrics",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Get live metrics summary
   */
  async getLiveMetricsSummary(): Promise<any> {
    try {
      this.logger.info("Getting live metrics summary");

      // Use real-time metrics as summary
      const summary = await this.metricsService.getRealTimeMetrics();

      return {
        success: true,
        metrics: summary,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to get live metrics summary", error as Error);
      return {
        success: false,
        error: "Failed to retrieve live metrics summary",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Get dashboard metrics
   */
  async getDashboardMetrics(request: MetricsRequest = {}): Promise<any> {
    try {
      this.logger.info("Getting dashboard metrics", { request });

      const filter = {
        dateFrom: request.dateFrom
          ? new Date(request.dateFrom)
          : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        dateTo: request.dateTo ? new Date(request.dateTo) : new Date(),
        granularity: request.granularity || ("day" as const),
        metrics: request.metrics || [],
      };

      const metrics = await this.metricsService.getDashboardMetrics(filter);

      return {
        success: true,
        metrics,
        filter,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to get dashboard metrics", error as Error);
      return {
        success: false,
        error: "Failed to retrieve dashboard metrics",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Get custom metric
   */
  async getCustomMetric(
    metricName: string,
    request: MetricsRequest = {}
  ): Promise<any> {
    try {
      this.logger.info("Getting custom metric", { metricName, request });

      const filter = {
        dateFrom: request.dateFrom
          ? new Date(request.dateFrom)
          : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        dateTo: request.dateTo ? new Date(request.dateTo) : new Date(),
        granularity: request.granularity || ("day" as const),
        aggregation: "sum" as const,
      };

      const metricData = await this.metricsService.getCustomMetric(
        metricName,
        filter
      );

      return {
        success: true,
        metricName,
        data: metricData,
        filter,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to get custom metric", error as Error, {
        metricName,
      });
      return {
        success: false,
        error: "Failed to retrieve custom metric",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Export metrics data
   */
  async exportMetrics(
    format: "csv" | "json",
    request: MetricsRequest = {}
  ): Promise<any> {
    try {
      this.logger.info("Exporting metrics data", { format, request });

      const filter = {
        dateFrom: request.dateFrom
          ? new Date(request.dateFrom)
          : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        dateTo: request.dateTo ? new Date(request.dateTo) : new Date(),
        granularity: request.granularity || ("day" as const),
        metrics: request.metrics || [],
      };

      const data = await this.metricsService.exportMetrics(format, filter);

      return {
        success: true,
        format,
        data,
        contentType: format === "csv" ? "text/csv" : "application/json",
        filename: `metrics_export_${new Date().toISOString()}.${format}`,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to export metrics", error as Error, {
        format,
        request,
      });
      return {
        success: false,
        error: "Failed to export metrics",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Clear metrics cache
   */
  async clearMetricsCache(): Promise<any> {
    try {
      this.logger.info("Clearing metrics cache");

      await this.metricsService.clearMetricsCache();

      return {
        success: true,
        message: "Metrics cache cleared successfully",
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to clear metrics cache", error as Error);
      return {
        success: false,
        error: "Failed to clear metrics cache",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Get monitoring data
   */
  async getMonitoring(): Promise<any> {
    try {
      this.logger.info("Getting monitoring data");

      const filter = {
        dateFrom: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
        dateTo: new Date(),
        granularity: "hour" as const,
        metrics: [],
      };

      const [dashboardMetrics, realTimeMetrics] = await Promise.all([
        this.metricsService.getDashboardMetrics(filter),
        this.metricsService.getRealTimeMetrics(),
      ]);

      return {
        success: true,
        data: {
          dashboard: dashboardMetrics,
          realTime: realTimeMetrics,
          health: {
            status: "healthy",
            lastCheck: new Date().toISOString(),
          },
          logs: [], // TODO: Implement log retrieval
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to get monitoring data", error as Error);
      return {
        success: false,
        error: "Failed to retrieve monitoring data",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Get metrics service health
   */
  async getMetricsServiceHealth(): Promise<any> {
    try {
      this.logger.info("Getting metrics service health");

      // Simple health check using real-time metrics
      const metrics = await this.metricsService.getRealTimeMetrics();

      const health = {
        status: "healthy",
        metricsCount: Object.keys(metrics).length,
        lastUpdate: new Date().toISOString(),
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
      };

      return {
        success: true,
        data: { health },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to get metrics service health", error as Error);
      return {
        success: false,
        error: "Failed to retrieve metrics service health",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Get notification settings and status
   */
  async getNotifications(): Promise<any> {
    try {
      this.logger.info("Getting notifications");

      // Basic notification system
      const notifications = [
        {
          id: "1",
          type: "alert",
          title: "High CPU Usage",
          message: "System CPU usage is above 80%",
          severity: "warning",
          timestamp: new Date().toISOString(),
          acknowledged: false,
        },
        {
          id: "2",
          type: "info",
          title: "Daily Report Available",
          message: "Your daily metrics report is ready",
          severity: "info",
          timestamp: new Date(Date.now() - 3600000).toISOString(),
          acknowledged: true,
        },
      ];

      return {
        success: true,
        data: { notifications },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to get notifications", error as Error);
      return {
        success: false,
        error: "Failed to retrieve notifications",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Create notification
   */
  async createNotification(notification: any): Promise<any> {
    try {
      this.logger.info("Creating notification", { notification });

      // Basic notification creation
      const newNotification = {
        id: `notification_${Date.now()}`,
        ...notification,
        timestamp: new Date().toISOString(),
        acknowledged: false,
      };

      return {
        success: true,
        data: { notification: newNotification },
        message: "Notification created successfully",
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to create notification", error as Error, {
        notification,
      });
      return {
        success: false,
        error: "Failed to create notification",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Generate basic metrics report
   */
  async generateReport(reportRequest: ReportRequest): Promise<any> {
    try {
      this.logger.info("Generating metrics report", { reportRequest });

      const filter = {
        dateFrom: reportRequest.dateRange?.from
          ? new Date(reportRequest.dateRange.from)
          : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        dateTo: reportRequest.dateRange?.to
          ? new Date(reportRequest.dateRange.to)
          : new Date(),
        granularity: "day" as const,
        metrics: [],
      };

      const [dashboardMetrics, realTimeMetrics] = await Promise.all([
        this.metricsService.getDashboardMetrics(filter),
        this.metricsService.getRealTimeMetrics(),
      ]);

      const report = {
        type: reportRequest.type,
        dashboard: dashboardMetrics,
        realTime: realTimeMetrics,
        summary: {
          totalUsers: realTimeMetrics.activeUsers || 0,
          totalCarts: realTimeMetrics.activeCarts || 0,
          performance: dashboardMetrics.performance || {},
        },
      };

      return {
        success: true,
        report: {
          id: `metrics_report_${Date.now()}`,
          type: reportRequest.type,
          format: reportRequest.format || "json",
          data: report,
          generatedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.logger.error("Failed to generate metrics report", error as Error, {
        reportRequest,
      });
      return {
        success: false,
        error: "Failed to generate metrics report",
        message: (error as Error).message,
      };
    }
  }
}
