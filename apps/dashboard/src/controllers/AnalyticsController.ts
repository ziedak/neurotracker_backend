import { Logger } from "@libs/monitoring";
import { AnalyticsService } from "../services/AnalyticsService";
import { MetricsService } from "../services/MetricsService";

export interface AnalyticsRequest {
  type?: string;
  dateFrom?: string;
  dateTo?: string;
  filters?: Record<string, any>;
  cartId?: string;
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
 * Analytics Controller for Dashboard
 * Simplified to use available service methods
 */
export class AnalyticsController {
  private readonly analyticsService: AnalyticsService;
  private readonly metricsService: MetricsService;
  private readonly logger: Logger;

  constructor(
    analyticsService: AnalyticsService,
    metricsService: MetricsService,
    logger: Logger
  ) {
    this.analyticsService = analyticsService;
    this.metricsService = metricsService;
    this.logger = logger;
  }

  /**
   * Get analytics overview
   */
  async getOverview(request: AnalyticsRequest): Promise<any> {
    try {
      this.logger.info("Getting analytics overview", { request });

      const dateFrom = request.dateFrom
        ? new Date(request.dateFrom)
        : undefined;
      const dateTo = request.dateTo ? new Date(request.dateTo) : undefined;

      const overview = await this.analyticsService.getOverview(
        dateFrom,
        dateTo
      );

      return {
        success: true,
        data: overview,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to get analytics overview", error as Error);
      return {
        success: false,
        error: "Failed to retrieve analytics overview",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Get analytics by type
   */
  async getAnalyticsByType(
    type: string,
    request: AnalyticsRequest
  ): Promise<any> {
    try {
      this.logger.info("Getting analytics by type", { type, request });

      const dateFrom = request.dateFrom
        ? new Date(request.dateFrom)
        : undefined;
      const dateTo = request.dateTo ? new Date(request.dateTo) : undefined;

      let data: any;

      switch (type) {
        case "conversion":
          data = await this.analyticsService.getConversion(dateFrom, dateTo);
          break;
        case "revenue":
          data = await this.analyticsService.getRevenue(dateFrom, dateTo);
          break;
        case "performance":
          data = await this.analyticsService.getPerformance(dateFrom, dateTo);
          break;
        case "analytics":
          data = await this.analyticsService.getAnalytics({
            type: "overview",
            dateFrom,
            dateTo,
            ...request.filters,
          });
          break;
        case "real-time":
          data = await this.metricsService.getRealTimeMetrics();
          break;
        default:
          throw new Error(`Unsupported analytics type: ${type}`);
      }

      return {
        success: true,
        type,
        data,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to get analytics by type", error as Error, {
        type,
      });
      return {
        success: false,
        error: `Failed to retrieve ${type} analytics`,
        message: (error as Error).message,
      };
    }
  }

  /**
   * Get cart features for prediction
   */
  async getCartFeatures(cartId: string): Promise<any> {
    try {
      this.logger.info("Getting cart features", { cartId });

      const features = await this.analyticsService.getAnalytics({
        type: "cart-features",
        filters: { cartId },
      });

      return {
        success: true,
        cartId,
        features,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to get cart features", error as Error, {
        cartId,
      });
      return {
        success: false,
        error: "Failed to retrieve cart features",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Get real-time analytics
   */
  async getRealTimeAnalytics(): Promise<any> {
    try {
      this.logger.info("Getting real-time analytics");

      const [realTimeMetrics, analyticsMetrics] = await Promise.all([
        this.metricsService.getRealTimeMetrics(),
        this.analyticsService.getRealTimeMetrics(),
      ]);

      return {
        success: true,
        data: {
          metrics: realTimeMetrics,
          analytics: analyticsMetrics,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to get real-time analytics", error as Error);
      return {
        success: false,
        error: "Failed to retrieve real-time analytics",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Get dashboard analytics
   */
  async getDashboardAnalytics(): Promise<any> {
    try {
      this.logger.info("Getting dashboard analytics");

      const filter = {
        dateFrom: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        dateTo: new Date(),
        granularity: "day" as const,
        metrics: [],
      };

      const metrics = await this.metricsService.getDashboardMetrics(filter);

      return {
        success: true,
        metrics,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to get dashboard analytics", error as Error);
      return {
        success: false,
        error: "Failed to retrieve dashboard analytics",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Generate report
   */
  async generateReport(reportRequest: ReportRequest): Promise<any> {
    try {
      this.logger.info("Generating report", { reportRequest });

      const { type, format = "json", dateRange, filters } = reportRequest;

      const parameters = {
        dateFrom: dateRange?.from,
        dateTo: dateRange?.to,
        ...filters,
      };

      const reportData = await this.analyticsService.generateReport(
        type,
        parameters
      );

      return {
        success: true,
        report: {
          id: `report_${Date.now()}`,
          type,
          format,
          data: reportData,
          generatedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.logger.error("Failed to generate report", error as Error, {
        reportRequest,
      });
      return {
        success: false,
        error: "Failed to generate report",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Get report by ID
   */
  async getReport(reportId: string): Promise<any> {
    try {
      this.logger.info("Getting report", { reportId });

      // Since we don't have persistent reports, generate fresh data
      const reportData = await this.analyticsService.getOverview();

      return {
        success: true,
        report: {
          id: reportId,
          type: "analytics",
          data: reportData,
          generatedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.logger.error("Failed to get report", error as Error, { reportId });
      return {
        success: false,
        error: "Failed to retrieve report",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Export data
   */
  async exportData(type: string, format: "csv" | "json"): Promise<any> {
    try {
      this.logger.info("Exporting data", { type, format });

      let data: any;
      const parameters = {};

      switch (type) {
        case "analytics":
          data = await this.analyticsService.getOverview();
          break;
        case "metrics":
          const filter = {
            dateFrom: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
            dateTo: new Date(),
            granularity: "day" as const,
            metrics: [],
          };
          data = await this.metricsService.getDashboardMetrics(filter);
          break;
        case "performance":
          data = await this.analyticsService.getPerformance();
          break;
        default:
          throw new Error(`Unsupported export type: ${type}`);
      }

      if (format === "csv") {
        // Convert to CSV format
        const csvData = this.convertToCSV(data);
        return {
          success: true,
          format: "csv",
          data: csvData,
          contentType: "text/csv",
        };
      }

      return {
        success: true,
        format: "json",
        data,
        contentType: "application/json",
      };
    } catch (error) {
      this.logger.error("Failed to export data", error as Error, {
        type,
        format,
      });
      return {
        success: false,
        error: "Failed to export data",
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
   * Get admin overview
   */
  async getAdminOverview(): Promise<any> {
    try {
      this.logger.info("Getting admin overview");

      const [overview, metrics, health] = await Promise.all([
        this.analyticsService.getOverview(),
        this.metricsService.getRealTimeMetrics(),
        this.analyticsService.healthCheck(),
      ]);

      return {
        success: true,
        data: {
          analytics: overview,
          metrics,
          health,
          systemStatus: "operational",
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to get admin overview", error as Error);
      return {
        success: false,
        error: "Failed to retrieve admin overview",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Get UI configuration
   */
  async getUIConfig(): Promise<any> {
    try {
      this.logger.info("Getting UI configuration");

      return {
        success: true,
        config: {
          theme: "default",
          features: {
            realTimeMetrics: true,
            analytics: true,
            reporting: true,
            export: true,
          },
          refreshIntervals: {
            metrics: 30000, // 30 seconds
            analytics: 300000, // 5 minutes
          },
          limits: {
            maxExportRows: 10000,
            maxReportDays: 365,
          },
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to get UI configuration", error as Error);
      return {
        success: false,
        error: "Failed to retrieve UI configuration",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Clear analytics cache
   */
  async clearCache(type?: string): Promise<any> {
    try {
      this.logger.info("Clearing analytics cache", { type });

      await this.analyticsService.clearCache(type);

      return {
        success: true,
        message: "Analytics cache cleared successfully",
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to clear analytics cache", error as Error);
      return {
        success: false,
        error: "Failed to clear analytics cache",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Helper method to convert data to CSV format
   */
  private convertToCSV(data: any): string {
    if (!data || typeof data !== "object") {
      return "";
    }

    if (Array.isArray(data)) {
      if (data.length === 0) return "";

      const headers = Object.keys(data[0]);
      const csvHeaders = headers.join(",");
      const csvRows = data.map((row) =>
        headers.map((header) => JSON.stringify(row[header] || "")).join(",")
      );

      return [csvHeaders, ...csvRows].join("\n");
    }

    // Convert object to CSV
    const entries = Object.entries(data);
    const csvData = entries
      .map(([key, value]) => `${JSON.stringify(key)},${JSON.stringify(value)}`)
      .join("\n");

    return `key,value\n${csvData}`;
  }
}
