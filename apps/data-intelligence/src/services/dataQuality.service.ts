import {
  ClickHouseClient,
  PostgreSQLClient,
  RedisClient,
  DatabaseUtils,
  ClickHouseQueryBuilder,
} from "@libs/database";
import { Logger, MetricsCollector } from "@libs/monitoring";
import { performance } from "perf_hooks";
import { Parser as CsvParser } from "json2csv";

export interface QualityCheck {
  name: string;
  status: "passed" | "failed" | "warning";
  message?: string;
  threshold?: number;
  actualValue?: number;
}

export interface QualityReport {
  timestamp: string;
  overallStatus: "healthy" | "warning" | "critical";
  checks: QualityCheck[];
  score: number; // 0-100
}

export interface GDPRRequest {
  userId: string;
  requestType: "forget" | "export" | "rectify";
  requestId: string;
  status: "pending" | "processing" | "completed" | "failed";
}

export interface AnomalyDetectionResult {
  anomalies: Array<{
    type: string;
    value: number;
    threshold: number;
    zscore: number;
    timestamp: string;
  }>;
  summary: {
    totalChecked: number;
    anomaliesFound: number;
    severity: "low" | "medium" | "high";
  };
}

/**
 * Data Quality & GDPR Compliance Service
 * Handles data quality monitoring, validation, anomaly detection, and GDPR compliance
 * Uses secure database utilities to prevent SQL injection
 * Strict TypeScript, Clean Architecture, SOLID, DRY, KISS, YAGNI principles
 */
export class DataQualityService {
  private readonly logger: ILogger;
  private readonly metrics: MetricsCollector;

  // Magic values as constants
  private static readonly FAILURE_SCORE_DECREMENT = 30;
  private static readonly WARNING_SCORE_DECREMENT = 10;
  private static readonly WARNING_SCORE_MIN = 70;
  private static readonly ZSCORE_OUTLIER_THRESHOLD = 3;
  private static readonly ANOMALY_LIMIT = 1000;
  private static readonly RECENT_DAYS = 7;

  constructor(logger: ILogger, metrics: MetricsCollector) {
    this.logger = logger;
    this.metrics = metrics;
  }

  /**
   * Get overall data quality status
   * @returns {Promise<QualityReport>} Quality report with status, checks, and score
   */
  async getQualityStatus(): Promise<QualityReport> {
    const startTime = performance.now();
    try {
      this.logger.info("Generating data quality report");
      const checks: QualityCheck[] = await Promise.all([
        this.checkDataCompleteness(),
        this.checkDataFreshness(),
        this.checkDataConsistency(),
        this.checkDataAccuracy(),
      ]);
      const failedChecks = checks.filter(
        (check) => check.status === "failed"
      ).length;
      const warningChecks = checks.filter(
        (check) => check.status === "warning"
      ).length;
      let overallStatus: "healthy" | "warning" | "critical";
      let score: number;
      if (failedChecks > 0) {
        overallStatus = "critical";
        score = Math.max(
          0,
          100 -
            failedChecks * DataQualityService.FAILURE_SCORE_DECREMENT -
            warningChecks * DataQualityService.WARNING_SCORE_DECREMENT
        );
      } else if (warningChecks > 0) {
        overallStatus = "warning";
        score = Math.max(
          DataQualityService.WARNING_SCORE_MIN,
          100 - warningChecks * 15
        );
      } else {
        overallStatus = "healthy";
        score = 100;
      }
      const report: QualityReport = {
        timestamp: new Date().toISOString(),
        overallStatus,
        checks,
        score,
      };
      const duration = performance.now() - startTime;
      await this.metrics.recordTimer("quality_check_duration", duration);
      await this.metrics.recordCounter("quality_checks_completed", 1);
      this.logger.info("Data quality report generated", {
        overallStatus,
        score,
        duration: Math.round(duration),
      });
      return report;
    } catch (error) {
      this.logger.error("Quality status check failed", error as Error);
      await this.metrics.recordCounter("quality_check_error", 1);
      throw error;
    }
  }

  /**
   * Get quality alerts (failed or warning checks)
   * @returns {Promise<{ alerts: QualityCheck[] }>} Alerts array
   */
  async getQualityAlerts(): Promise<{ alerts: QualityCheck[] }> {
    try {
      const qualityReport = await this.getQualityStatus();
      const alerts = qualityReport.checks.filter(
        (check) => check.status === "failed" || check.status === "warning"
      );
      return { alerts };
    } catch (error) {
      this.logger.error("Failed to get quality alerts", error as Error);
      throw error;
    }
  }

  /**
   * Validate data quality for specific dataset
   * @param request - validation request
   * @returns {Promise<{ status: string; results: QualityCheck[] }>}
   */
  async validateQuality(request: {
    table: string;
    checks: string[];
    threshold?: number;
  }): Promise<{ status: string; results: QualityCheck[] }> {
    const { table, checks, threshold = 0.95 } = request;
    try {
      this.logger.info("Validating data quality", { table, checks });
      const results: QualityCheck[] = [];
      for (const checkType of checks) {
        let check: QualityCheck;
        switch (checkType) {
          case "completeness":
            check = await this.checkTableCompleteness(table, threshold);
            break;
          case "uniqueness":
            check = await this.checkTableUniqueness(table, threshold);
            break;
          case "validity":
            check = await this.checkTableValidity(table, threshold);
            break;
          default:
            check = {
              name: checkType,
              status: "failed",
              message: `Unknown check type: ${checkType}`,
            };
        }
        results.push(check);
      }
      const status = results.every((r) => r.status === "passed")
        ? "passed"
        : "failed";
      return { status, results };
    } catch (error) {
      this.logger.error("Data quality validation failed", error as Error, {
        table,
      });
      throw error;
    }
  }

  /**
   * Detect anomalies in data using statistical methods with secure queries
   */
  async detectAnomalies(params: {
    type?: "features" | "events";
    threshold?: number;
  }): Promise<AnomalyDetectionResult> {
    const {
      type = "features",
      threshold = DataQualityService.ZSCORE_OUTLIER_THRESHOLD,
    } = params;

    try {
      this.logger.info("Detecting anomalies", { type, threshold });
      const recentWindowMs =
        DataQualityService.RECENT_DAYS * 24 * 60 * 60 * 1000;
      const anomalyLimit = DataQualityService.ANOMALY_LIMIT;
      const dateFrom = new Date(Date.now() - recentWindowMs).toISOString();

      let subQuery: string;
      let mainQuery: string;
      let queryParams: Record<string, any>;

      if (type === "features") {
        // Build subquery for window functions
        const sub = ClickHouseQueryBuilder.buildWindowFunctionQuery(
          "features",
          {
            select: [
              "cartId",
              "name",
              "value",
              "avg(value) OVER (PARTITION BY name) AS avgValue",
              "stddevPop(value) OVER (PARTITION BY name) AS stddev",
              "timestamp",
            ],
            where: { timestamp_from: dateFrom },
            allowedTables: ["features"],
            allowedFields: ["cartId", "name", "value", "timestamp"],
          }
        );
        subQuery = sub.query;
        // Build main query as subquery
        const main = ClickHouseQueryBuilder.buildSubquery(subQuery, {
          select: [
            "cartId",
            "name",
            "value",
            "(value - avgValue) / nullIf(stddev, 0) AS zscore",
            "timestamp",
          ],
          where: { threshold },
          orderBy: [{ field: "zscore", direction: "DESC" }],
          limit: anomalyLimit,
        });
        mainQuery = main.query + " WHERE abs(zscore) > {threshold:Float64}";
        queryParams = {
          ...sub.params,
          threshold: Number(threshold),
          limit: anomalyLimit,
        };
      } else {
        const sub = ClickHouseQueryBuilder.buildWindowFunctionQuery("events", {
          select: [
            "eventType",
            "value",
            "avg(value) OVER (PARTITION BY eventType) AS avgValue",
            "stddevPop(value) OVER (PARTITION BY eventType) AS stddev",
            "timestamp",
          ],
          where: { timestamp_from: dateFrom },
          allowedTables: ["events"],
          allowedFields: ["eventType", "value", "timestamp"],
        });
        subQuery = sub.query;
        const main = ClickHouseQueryBuilder.buildSubquery(subQuery, {
          select: [
            "eventType",
            "value",
            "(value - avgValue) / nullIf(stddev, 0) AS zscore",
            "timestamp",
          ],
          where: { threshold },
          orderBy: [{ field: "zscore", direction: "DESC" }],
          limit: anomalyLimit,
        });
        mainQuery = main.query + " WHERE abs(zscore) > {threshold:Float64}";
        queryParams = {
          ...sub.params,
          threshold: Number(threshold),
          limit: anomalyLimit,
        };
      }

      const results = await ClickHouseClient.execute(mainQuery, queryParams);

      const anomalies = results.map((row: any) => ({
        type: type === "features" ? `${row.cartId}:${row.name}` : row.eventType,
        value: row.value,
        threshold,
        zscore: row.zscore,
        timestamp: row.timestamp,
      }));

      const severity =
        anomalies.length > 50
          ? "high"
          : anomalies.length > 10
          ? "medium"
          : "low";

      const result: AnomalyDetectionResult = {
        anomalies,
        summary: {
          totalChecked: results.length,
          anomaliesFound: anomalies.length,
          severity,
        },
      };

      await this.metrics.recordCounter("anomalies_detected", anomalies.length, {
        type,
      });

      this.logger.info("Anomaly detection completed", {
        type,
        anomaliesFound: anomalies.length,
        severity,
      });

      return result;
    } catch (error) {
      this.logger.error("Anomaly detection failed", error as Error, { type });
      return {
        anomalies: [],
        summary: {
          totalChecked: 0,
          anomaliesFound: 0,
          severity: "low",
        },
      };
    }
  }

  // === GDPR Compliance Methods ===

  /**
   * Process user data deletion request (Right to be Forgotten)
   */
  async forgetUser(
    userId: string
  ): Promise<{ userId: string; status: string; requestId?: string }> {
    const requestId = `gdpr-forget-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    try {
      this.logger.info("Processing GDPR forget request", { userId, requestId });

      // Create GDPR request record
      const gdprRequest: GDPRRequest = {
        userId,
        requestType: "forget",
        requestId,
        status: "processing",
      };

      await this.storeGDPRRequest(gdprRequest);

      // Delete from PostgreSQL
      const prisma = PostgreSQLClient.getInstance();
      await prisma.$transaction(async (tx) => {
        // First delete features for carts belonging to this user
        const userCarts = await tx.cart.findMany({
          where: { userId },
          select: { id: true },
        });
        const cartIds = userCarts.map((cart) => cart.id);

        if (cartIds.length > 0) {
          await tx.feature.deleteMany({ where: { cartId: { in: cartIds } } });
        }

        // Delete user and related data (cascades will handle carts, sessions, events)
        await tx.user.deleteMany({ where: { id: userId } });
      });

      // Delete from ClickHouse (if supported by your schema)
      try {
        await ClickHouseClient.execute(
          `DELETE FROM events WHERE userId = {userId:String}`,
          { userId }
        );
        await ClickHouseClient.execute(
          `DELETE FROM features WHERE userId = {userId:String}`,
          { userId }
        );
      } catch (error) {
        this.logger.warn("ClickHouse deletion failed", {
          userId,
          error: (error as Error).message,
        });
      }

      // Clear Redis cache
      try {
        const keys = await RedisClient.getInstance().keys(`*${userId}*`);
        if (keys.length > 0) {
          await RedisClient.getInstance().del(...keys);
        }
      } catch (error) {
        this.logger.warn("Redis cache cleanup failed", {
          userId,
          error: (error as Error).message,
        });
      }

      // Update request status
      gdprRequest.status = "completed";
      await this.storeGDPRRequest(gdprRequest);

      await this.metrics.recordCounter("gdpr_forget_requests", 1);

      this.logger.info("GDPR forget request completed", { userId, requestId });

      return { userId, status: "forgotten", requestId };
    } catch (error) {
      this.logger.error("GDPR forget request failed", error as Error, {
        userId,
        requestId,
      });
      await this.metrics.recordCounter("gdpr_forget_errors", 1);

      // Update request status to failed
      try {
        await this.storeGDPRRequest({
          userId,
          requestType: "forget",
          requestId,
          status: "failed",
        });
      } catch (storeError) {
        this.logger.error(
          "Failed to update GDPR request status",
          storeError as Error
        );
      }

      return { userId, status: "error" };
    }
  }

  /**
   * Export user data (GDPR Data Portability)
   */
  async exportUserData(
    userId: string
  ): Promise<{ userId: string; data?: any; error?: string }> {
    try {
      this.logger.info("Exporting user data for GDPR", { userId });

      // Get user data from PostgreSQL
      const prisma = PostgreSQLClient.getInstance();
      const userData = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          sessions: true,
          events: true,
          carts: {
            include: {
              items: {
                include: {
                  product: true,
                },
              },
              features: true,
            },
          },
        },
      });

      if (!userData) {
        return { userId, error: "User not found" };
      }

      // Get events from ClickHouse
      let eventData: any[] = [];
      try {
        eventData = await ClickHouseClient.execute(
          `SELECT * FROM events WHERE userId = {userId:String} ORDER BY timestamp DESC`,
          { userId }
        );
      } catch (error) {
        this.logger.warn("Failed to export events from ClickHouse", {
          userId,
          error: (error as Error).message,
        });
      }

      const exportData = {
        user: userData,
        events: eventData,
        exportedAt: new Date().toISOString(),
      };

      await this.metrics.recordCounter("gdpr_export_requests", 1);

      this.logger.info("User data export completed", {
        userId,
        eventCount: eventData.length,
      });

      return { userId, data: exportData };
    } catch (error) {
      this.logger.error("User data export failed", error as Error, { userId });
      await this.metrics.recordCounter("gdpr_export_errors", 1);
      return { userId, error: (error as Error).message };
    }
  }

  /**
   * Get GDPR request status
   */
  async getGdprStatus(
    requestId: string
  ): Promise<{ requestId: string; status: string }> {
    try {
      const request = await this.getGDPRRequest(requestId);
      return {
        requestId,
        status: request?.status || "not_found",
      };
    } catch (error) {
      this.logger.error("Failed to get GDPR status", error as Error, {
        requestId,
      });
      return { requestId, status: "error" };
    }
  }

  /**
   * Generate quality report (JSON, CSV, PDF)
   */
  async generateReport({ format }: { format: string }): Promise<any> {
    // Example: aggregate metrics from PostgreSQL
    const prisma = PostgreSQLClient.getInstance();
    const failedValidations = await prisma.qualityValidation.findMany({
      where: { status: "failed" },
      select: { id: true, table: true, check: true, timestamp: true },
    });
    const anomalyCounts = await prisma.qualityAnomaly.groupBy({
      by: ["type"],
      _count: { id: true },
    });

    // Aggregate results
    const report = {
      failedValidations,
      anomalyCounts,
      generatedAt: new Date().toISOString(),
    };

    if (format === "csv") {
      const parser = new CsvParser();
      return parser.parse(report.failedValidations);
    }
    if (format === "pdf") {
      // TODO: Implement PDF generation (stub)
      return Buffer.from("PDF generation not implemented");
    }
    return report;
  }

  /**
   * Get historical quality trends (time series)
   */
  async getQualityTrends({
    from,
    to,
  }: {
    from?: string;
    to?: string;
  }): Promise<any[]> {
    // Example: query ClickHouse for daily anomaly counts
    const table = "quality_anomaly";
    const dateField = "timestamp";
    const interval = "day";
    const { query, params } = ClickHouseQueryBuilder.buildTimeSeriesQuery(
      table,
      dateField,
      interval,
      {
        select: ["type"],
        dateFrom: from,
        dateTo: to,
        allowedTables: [table],
        allowedFields: [dateField, "type"],
      }
    );
    const rows = await ClickHouseClient.execute(query, params);
    // Format: [{ time_interval, type, count }]
    return rows;
  }

  /**
   * Get aggregated quality metrics for dashboard API
   * @param from - start date
   * @param to - end date
   * @returns {Promise<{ dailyFailures: any[]; anomalyTypes: any[] }>}
   */
  async getAggregatedQualityMetrics({
    from,
    to,
  }: {
    from?: string;
    to?: string;
  }): Promise<{ dailyFailures: any[]; anomalyTypes: any[] }> {
    const prisma = PostgreSQLClient.getInstance();
    const dailyFailures = await prisma.qualityValidation.groupBy({
      by: ["timestamp"],
      where: {
        status: "failed",
        timestamp: {
          gte: from ? new Date(from) : undefined,
          lte: to ? new Date(to) : undefined,
        },
      },
      _count: { id: true },
      orderBy: { timestamp: "asc" },
    });
    const anomalyTypes = await prisma.qualityAnomaly.groupBy({
      by: ["type"],
      where: {
        timestamp: {
          gte: from ? new Date(from) : undefined,
          lte: to ? new Date(to) : undefined,
        },
      },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    });
    return { dailyFailures, anomalyTypes };
  }
  /**
   * Detect outliers in daily failure rates using Z-score
   * @param threshold - Z-score threshold
   * @param from - start date
   * @param to - end date
   * @returns {Promise<Array<{ day: string; failures: number; zscore: number }>>}
   */
  async detectOutliers({
    threshold = DataQualityService.ZSCORE_OUTLIER_THRESHOLD,
    from,
    to,
  }: {
    threshold?: number;
    from?: string;
    to?: string;
  }): Promise<Array<{ day: string; failures: number; zscore: number }>> {
    const prisma = PostgreSQLClient.getInstance();
    const daily = await prisma.qualityValidation.groupBy({
      by: ["timestamp"],
      where: {
        status: "failed",
        timestamp: {
          gte: from ? new Date(from) : undefined,
          lte: to ? new Date(to) : undefined,
        },
      },
      _count: { id: true },
      orderBy: { timestamp: "asc" },
    });
    const counts = daily.map((d) => d._count.id);
    const zScores = calculateZScores(counts);
    const outliers = daily
      .map((d, i) => ({
        day:
          typeof d.timestamp === "string"
            ? d.timestamp
            : d.timestamp instanceof Date
            ? d.timestamp.toISOString()
            : String(d.timestamp),
        failures: d._count.id,
        zscore: zScores[i]?.zscore ?? 0,
      }))
      .filter((d) => Math.abs(d.zscore) > threshold);
    return outliers;
  }

  // === Private Helper Methods ===

  private async checkDataCompleteness(): Promise<QualityCheck> {
    try {
      const oneDayAgo = new Date(
        Date.now() - 24 * 60 * 60 * 1000
      ).toISOString();
      const { query, params } = ClickHouseQueryBuilder.buildSelectQuery(
        "events",
        {
          select: [
            "count(*) as total",
            "countIf(isNull(userId)) as nullUsers",
            "countIf(isNull(timestamp)) as nullTimestamps",
          ],
          where: { timestamp_from: oneDayAgo },
          allowedTables: ["events"],
          allowedFields: ["userId", "timestamp"],
        }
      );
      const result = await ClickHouseClient.execute(query, params);
      const data = result[0];
      const completeness =
        1 - (data.nullUsers + data.nullTimestamps) / (data.total * 2);
      return {
        name: "Data Completeness",
        status:
          completeness > 0.95
            ? "passed"
            : completeness > 0.9
            ? "warning"
            : "failed",
        threshold: 0.95,
        actualValue: completeness,
        message: `${Math.round(completeness * 100)}% complete`,
      };
    } catch (error) {
      return {
        name: "Data Completeness",
        status: "failed",
        message: "Check failed: " + (error as Error).message,
      };
    }
  }

  private async checkDataFreshness(): Promise<QualityCheck> {
    try {
      const { query, params } = ClickHouseQueryBuilder.buildSelectQuery(
        "events",
        {
          select: ["max(timestamp) as latestTimestamp"],
          allowedTables: ["events"],
          allowedFields: ["timestamp"],
        }
      );
      const result = await ClickHouseClient.execute(query, params);
      const latestTimestamp = new Date(result[0].latestTimestamp);
      const now = new Date();
      const hoursSinceLatest =
        (now.getTime() - latestTimestamp.getTime()) / (1000 * 60 * 60);
      return {
        name: "Data Freshness",
        status:
          hoursSinceLatest < 2
            ? "passed"
            : hoursSinceLatest < 6
            ? "warning"
            : "failed",
        threshold: 2,
        actualValue: hoursSinceLatest,
        message: `Latest data is ${Math.round(hoursSinceLatest)} hours old`,
      };
    } catch (error) {
      return {
        name: "Data Freshness",
        status: "failed",
        message: "Check failed: " + (error as Error).message,
      };
    }
  }

  private async checkDataConsistency(): Promise<QualityCheck> {
    try {
      // Check cross-system consistency using secure DatabaseUtils
      const results = await DatabaseUtils.performReconciliation(
        "carts",
        "features",
        [
          {
            sourceField: "id",
            targetField: "cartId",
            operation: "count",
            tolerance: 5, // 5% tolerance
          },
        ]
      );

      const consistencyResult = results[0];
      const isConsistent = consistencyResult.status === "passed";
      let percentageDiff = 0;
      if (
        consistencyResult.details &&
        typeof consistencyResult.details === "object" &&
        "percentageDiff" in consistencyResult.details &&
        typeof (consistencyResult.details as any).percentageDiff === "number"
      ) {
        percentageDiff = (consistencyResult.details as any).percentageDiff;
      }
      return {
        name: "Cross-System Consistency",
        status: isConsistent ? "passed" : "failed",
        threshold: 95,
        actualValue: isConsistent ? 100 : 100 - percentageDiff,
        message: isConsistent
          ? "Data is consistent across systems"
          : `Inconsistency detected: ${percentageDiff}% difference`,
      };
    } catch (error) {
      return {
        name: "Cross-System Consistency",
        status: "failed",
        message: "Check failed: " + (error as Error).message,
      };
    }
  }

  private async checkDataAccuracy(): Promise<QualityCheck> {
    try {
      const oneDayAgo = new Date(
        Date.now() - 24 * 60 * 60 * 1000
      ).toISOString();
      const { query, params } = ClickHouseQueryBuilder.buildSelectQuery(
        "features",
        {
          select: [
            "count(*) as total",
            "countIf(value < 0 OR value > 1000000) as outliers",
          ],
          where: { timestamp_from: oneDayAgo },
          allowedTables: ["features"],
          allowedFields: ["value", "timestamp"],
        }
      );
      const result = await ClickHouseClient.execute(query, params);
      const data = result[0];
      const accuracy = 1 - data.outliers / data.total;
      return {
        name: "Data Accuracy",
        status:
          accuracy > 0.98 ? "passed" : accuracy > 0.95 ? "warning" : "failed",
        threshold: 0.98,
        actualValue: accuracy,
        message: `${Math.round(
          accuracy * 100
        )}% of data within expected ranges`,
      };
    } catch (error) {
      return {
        name: "Data Accuracy",
        status: "failed",
        message: "Check failed: " + (error as Error).message,
      };
    }
  }

  private async checkTableCompleteness(
    table: string,
    threshold: number
  ): Promise<QualityCheck> {
    try {
      const { query, params } = ClickHouseQueryBuilder.buildSelectQuery(table, {
        select: ["count(*) as total", "countIf(isNull(*)) as nullCount"],
        allowedTables: [table],
        allowedFields: ["*"],
      });
      const result = await ClickHouseClient.execute(query, params);
      const completeness = 1 - result[0].nullCount / result[0].total;
      return {
        name: `${table} Completeness`,
        status: completeness >= threshold ? "passed" : "failed",
        threshold,
        actualValue: completeness,
        message: `${Math.round(completeness * 100)}% complete`,
      };
    } catch (error) {
      return {
        name: `${table} Completeness`,
        status: "failed",
        message: "Check failed: " + (error as Error).message,
      };
    }
  }

  private async checkTableUniqueness(
    table: string,
    threshold: number
  ): Promise<QualityCheck> {
    try {
      // Use secure DatabaseUtils for quality checks
      const results = await DatabaseUtils.performQualityChecks(table, [
        {
          type: "uniqueness",
          field: "id", // Most tables should have unique IDs
        },
      ]);

      const uniquenessResult = results.find((r) =>
        r.check.includes("uniqueness")
      );

      let uniqueCount: number | undefined = undefined;
      let errorMsg: string | undefined = undefined;
      if (
        uniquenessResult &&
        uniquenessResult.details &&
        typeof uniquenessResult.details === "object"
      ) {
        if (
          "unique_count" in uniquenessResult.details &&
          typeof (uniquenessResult.details as any).unique_count === "number"
        ) {
          uniqueCount = (uniquenessResult.details as any).unique_count;
        }
        if (
          "error" in uniquenessResult.details &&
          typeof (uniquenessResult.details as any).error === "string"
        ) {
          errorMsg = (uniquenessResult.details as any).error;
        }
      }
      if (uniquenessResult && uniquenessResult.status === "passed") {
        return {
          name: `${table} Uniqueness`,
          status: "passed",
          message: "All records have unique identifiers",
          actualValue: uniqueCount,
          threshold,
        };
      } else {
        return {
          name: `${table} Uniqueness`,
          status: "failed",
          message: errorMsg || "Uniqueness constraint violation detected",
          actualValue: uniqueCount,
          threshold,
        };
      }
    } catch (error) {
      this.logger.error("Table uniqueness check failed", error as Error, {
        table,
      });
      return {
        name: `${table} Uniqueness`,
        status: "failed",
        message: "Check failed: " + (error as Error).message,
      };
    }
  }

  private async checkTableValidity(
    table: string,
    threshold: number
  ): Promise<QualityCheck> {
    try {
      // Perform different validity checks based on table type
      const checks = [];

      if (table === "users") {
        checks.push({
          type: "validity" as const,
          field: "email",
        });
      }

      // Add completeness check for all tables
      checks.push({
        type: "completeness" as const,
        field: "id",
      });

      const results = await DatabaseUtils.performQualityChecks(table, checks);

      const failedChecks = results.filter((r) => r.status === "failed");

      if (failedChecks.length === 0) {
        return {
          name: `${table} Validity`,
          status: "passed",
          message: "All validity checks passed",
          actualValue: 100,
          threshold,
        };
      } else {
        return {
          name: `${table} Validity`,
          status: "failed",
          message: `${failedChecks.length} validity check(s) failed`,
          actualValue:
            ((results.length - failedChecks.length) / results.length) * 100,
          threshold,
        };
      }
    } catch (error) {
      this.logger.error("Table validity check failed", error as Error, {
        table,
      });
      return {
        name: `${table} Validity`,
        status: "failed",
        message: "Check failed: " + (error as Error).message,
      };
    }
  }

  private async storeGDPRRequest(request: GDPRRequest): Promise<void> {
    try {
      await RedisClient.getInstance().setex(
        `gdpr:${request.requestId}`,
        7 * 24 * 3600, // 7 days TTL
        JSON.stringify(request)
      );
    } catch (error) {
      this.logger.error("Failed to store GDPR request", error as Error);
    }
  }

  private async getGDPRRequest(requestId: string): Promise<GDPRRequest | null> {
    try {
      const cached = await RedisClient.getInstance().get(`gdpr:${requestId}`);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      this.logger.error("Failed to get GDPR request", error as Error);
      return null;
    }
  }
}

/**
 * Utility: Calculate Z-scores for an array of numbers
 */
function calculateZScores(
  values: number[]
): { value: number; zscore: number }[] {
  if (!values.length) return [];
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const stddev = Math.sqrt(
    values.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / values.length
  );
  return values.map((value) => ({
    value,
    zscore: stddev ? (value - avg) / stddev : 0,
  }));
}
