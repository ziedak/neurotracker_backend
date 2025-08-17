import { PostgreSQLClient } from "./postgress/pgClient";
import { ClickHouseClient } from "./clickhouse/clickhouseClient";
import { RedisClient } from "./redisClient";
import { FeatureQueryBuilder } from "./postgress/query-builder";
import { ClickHouseQueryBuilder } from "./clickhouse/clickhouse-query-builder";
import { Prisma } from "@prisma/client";

/**
 * Database service utilities that provide secure, reusable patterns
 * All methods prevent SQL injection and use parameterized queries
 */
/**
 * Database service utilities that provide secure, reusable patterns
 * All methods prevent SQL injection and use parameterized queries
 * Optimized for strict typing, maintainability, and error handling
 */
export class DatabaseUtils {
  /**
   * Feature Store Operations
   */
  /**
   * Get features for a cart, optionally from cache
   */
  static async getFeatures(
    cartId: string,
    options: {
      featureNames?: string[];
      includeExpired?: boolean;
      fromCache?: boolean;
      cacheKeyPrefix?: string;
    } = {}
  ): Promise<Record<string, unknown>> {
    const {
      featureNames,
      includeExpired = false,
      fromCache = true,
      cacheKeyPrefix = "features",
    } = options;

    // Try cache first if enabled
    if (fromCache) {
      try {
        const cacheKey = `${cacheKeyPrefix}:${cartId}`;
        const cached = await RedisClient.getInstance().get(cacheKey);
        if (cached) {
          const parsedCache = JSON.parse(cached) as Record<string, unknown>;
          if (featureNames?.length) {
            const filtered: Record<string, unknown> = {};
            for (const name of featureNames) {
              if (parsedCache[name] !== undefined)
                filtered[name] = parsedCache[name];
            }
            return filtered;
          }
          return parsedCache;
        }
      } catch (error) {
        console.warn(
          `[DatabaseUtils] Cache retrieval failed for cartId=${cartId}:`,
          error
        );
      }
    }

    // Build safe WHERE conditions
    const where = FeatureQueryBuilder.buildFeatureWhere({
      cartId,
      featureNames,
      includeExpired,
    });

    // Query from PostgreSQL with type safety
    const prisma = PostgreSQLClient.getInstance();
    const features = await prisma.feature.findMany({
      where,
      select: {
        name: true,
        value: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
    });

    // Convert to key-value format
    const result: Record<string, unknown> = {};
    for (const feature of features) {
      result[feature.name] = feature.value;
    }

    // Cache the result
    if (Object.keys(result).length > 0) {
      try {
        const cacheKey = `${cacheKeyPrefix}:${cartId}`;
        await RedisClient.getInstance().setex(
          cacheKey,
          3600,
          JSON.stringify(result)
        );
      } catch (error) {
        console.warn(
          `[DatabaseUtils] Cache storage failed for cartId=${cartId}:`,
          error
        );
      }
    }

    return result;
  }

  /**
   * Store features with upsert logic and caching
   */
  static async storeFeatures(
    cartId: string,
    features: Record<string, Prisma.InputJsonValue>,
    options: {
      version?: string;
      cacheKeyPrefix?: string;
      cacheTTL?: number;
    } = {}
  ): Promise<void> {
    const {
      version = "1.0.0",
      cacheKeyPrefix = "features",
      cacheTTL = 3600,
    } = options;

    const prisma = PostgreSQLClient.getInstance();

    // Use transaction for consistency
    await prisma.$transaction(async (tx) => {
      const upsertPromises = Object.entries(features).map(
        async ([name, value]) => {
          const existing = await tx.feature.findFirst({
            where: { cartId, name },
          });
          if (existing) {
            return tx.feature.update({
              where: { id: existing.id },
              data: {
                value: value as Prisma.InputJsonValue,
                updatedAt: new Date(),
              },
            });
          } else {
            return tx.feature.create({
              data: {
                cartId,
                name,
                value: value as Prisma.InputJsonValue,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            });
          }
        }
      );
      await Promise.all(upsertPromises);
    });

    // Update cache
    try {
      const cacheKey = `${cacheKeyPrefix}:${cartId}`;
      const cacheData = {
        ...features,
        _version: version,
        _cached_at: new Date().toISOString(),
      };
      await RedisClient.getInstance().setex(
        cacheKey,
        cacheTTL,
        JSON.stringify(cacheData)
      );
    } catch (error) {
      console.warn(
        `[DatabaseUtils] Cache update failed for cartId=${cartId}:`,
        error
      );
    }
  }

  /**
   * Analytics query with safe aggregation
   */
  static async getAnalyticsData(
    table: string,
    aggregations: {
      field: string;
      function: "COUNT" | "SUM" | "AVG" | "MIN" | "MAX";
      alias?: string;
    }[],
    filters: Record<
      string,
      string | number | boolean | Date | { operator: string; value: any } | null
    > = {},
    options: {
      groupBy?: string[];
      dateFrom?: string;
      dateTo?: string;
      limit?: number;
    } = {}
  ): Promise<any[]> {
    const allowedTables = [
      "user_events",
      "features",
      "carts",
      "cart_items",
      "user_sessions",
    ];
    const allowedFields = [
      "cartId",
      "userId",
      "sessionId",
      "eventType",
      "timestamp",
      "createdAt",
      "updatedAt",
      "name",
      "value",
      "status",
      "total",
      "quantity",
      "price",
    ];

    const { query, params } = ClickHouseQueryBuilder.buildAggregationQuery(
      table,
      aggregations,
      {
        where: filters,
        groupBy: options.groupBy,
        allowedTables,
        allowedFields,
      }
    );
    if (options.dateFrom || options.dateTo) {
      const dateField = table === "user_events" ? "timestamp" : "createdAt";
      const { query: timeQuery, params: timeParams } =
        ClickHouseQueryBuilder.buildTimeSeriesQuery(table, dateField, "day", {
          where: filters,
          dateFrom: options.dateFrom,
          dateTo: options.dateTo,
          allowedTables,
          allowedFields,
        });
      return await ClickHouseClient.execute(timeQuery, timeParams);
    }
    return await ClickHouseClient.execute(query, params);
  }

  /**
   * Export data with safe pagination and filtering
   */
  static async exportData(
    table: string,
    filters: Record<
      string,
      string | number | boolean | Date | { operator: string; value: any } | null
    > = {},
    options: {
      select?: string[];
      limit?: number;
      offset?: number;
      orderBy?: { field: string; direction: "ASC" | "DESC" }[];
      format?: "json" | "csv";
    } = {}
  ): Promise<any[]> {
    const allowedTables = [
      "features",
      "carts",
      "cart_items",
      "user_events",
      "user_sessions",
      "users",
      "products",
    ];
    const allowedFields = [
      "id",
      "cartId",
      "userId",
      "sessionId",
      "eventType",
      "timestamp",
      "createdAt",
      "updatedAt",
      "name",
      "value",
      "status",
      "total",
      "quantity",
      "price",
      "email",
      "pageUrl",
      "userAgent",
      "productId",
      "description",
      "currency",
      "sku",
      "imageUrl",
      "category",
    ];

    const { query, params } = ClickHouseQueryBuilder.buildSelectQuery(table, {
      select: options.select,
      where: filters,
      orderBy: options.orderBy,
      limit: Math.min(options.limit || 10000, 100000),
      offset: options.offset,
      allowedTables,
      allowedFields,
    });
    return await ClickHouseClient.execute(query, params);
  }

  /**
   * Quality checks with safe validation queries
   */
  static async performQualityChecks(
    table: string,
    checks: {
      type: "uniqueness" | "validity" | "completeness" | "consistency";
      field?: string;
      criteria?: Record<string, unknown>;
    }[]
  ): Promise<
    Array<{ check: string; status: "passed" | "failed"; details?: unknown }>
  > {
    const allowedTables = [
      "features",
      "carts",
      "cart_items",
      "user_events",
      "users",
    ];
    const allowedFields = [
      "id",
      "cartId",
      "userId",
      "email",
      "name",
      "value",
      "eventType",
      "status",
    ];

    if (!allowedTables.includes(table)) {
      throw new Error(`Unauthorized table: ${table}`);
    }

    const results: Array<{
      check: string;
      status: "passed" | "failed";
      details?: unknown;
    }> = [];
    for (const check of checks) {
      try {
        let query: string;
        let params: Record<string, unknown> = {};
        switch (check.type) {
          case "uniqueness":
            if (!check.field || !allowedFields.includes(check.field)) {
              throw new Error(
                `Invalid field for uniqueness check: ${check.field}`
              );
            }
            query = `SELECT COUNT(*) as total, COUNT(DISTINCT ${check.field}) as unique_count FROM ${table}`;
            break;
          case "completeness":
            if (!check.field || !allowedFields.includes(check.field)) {
              throw new Error(
                `Invalid field for completeness check: ${check.field}`
              );
            }
            query = `SELECT COUNT(*) as total, COUNT(${check.field}) as non_null_count FROM ${table}`;
            break;
          case "validity":
            if (check.field === "email") {
              query = `SELECT COUNT(*) as total, COUNT(*) as valid_count FROM ${table} WHERE match(email, '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$')`;
            } else {
              throw new Error(
                `Validity check not implemented for field: ${check.field}`
              );
            }
            break;
          default:
            throw new Error(`Unknown check type: ${check.type}`);
        }
        const result = await ClickHouseClient.execute(query, params);
        let status: "passed" | "failed" = "passed";
        let details: unknown = result[0];
        if (check.type === "uniqueness" && result[0]) {
          status =
            result[0].total === result[0].unique_count ? "passed" : "failed";
        } else if (check.type === "completeness" && result[0]) {
          const completeness = result[0].non_null_count / result[0].total;
          status = completeness >= 0.95 ? "passed" : "failed";
        }
        results.push({
          check: `${check.type}_${check.field || table}`,
          status,
          details,
        });
      } catch (error) {
        results.push({
          check: `${check.type}_${check.field || table}`,
          status: "failed",
          details: { error: (error as Error).message },
        });
      }
    }
    return results;
  }

  /**
   * Reconciliation operations with safe cross-system validation
   */
  static async performReconciliation(
    sourceTable: string,
    targetTable: string,
    reconciliationRules: {
      sourceField: string;
      targetField: string;
      operation: "count" | "sum" | "existence";
      tolerance?: number;
    }[]
  ): Promise<
    Array<{ rule: string; status: "passed" | "failed"; details: unknown }>
  > {
    const allowedTables = [
      "features",
      "carts",
      "cart_items",
      "user_events",
      "users",
      "products",
    ];
    const allowedFields = [
      "id",
      "cartId",
      "userId",
      "total",
      "quantity",
      "price",
      "status",
      "value",
    ];

    if (
      !allowedTables.includes(sourceTable) ||
      !allowedTables.includes(targetTable)
    ) {
      throw new Error("Unauthorized table in reconciliation");
    }

    const results: Array<{
      rule: string;
      status: "passed" | "failed";
      details: unknown;
    }> = [];
    for (const rule of reconciliationRules) {
      try {
        if (
          !allowedFields.includes(rule.sourceField) ||
          !allowedFields.includes(rule.targetField)
        ) {
          throw new Error(
            `Invalid fields in reconciliation rule: ${rule.sourceField}, ${rule.targetField}`
          );
        }
        let sourceQuery: string;
        let targetQuery: string;
        const params: Record<string, unknown> = {};
        switch (rule.operation) {
          case "count":
            sourceQuery = `SELECT COUNT(*) as count FROM ${sourceTable}`;
            targetQuery = `SELECT COUNT(*) as count FROM ${targetTable}`;
            break;
          case "sum":
            sourceQuery = `SELECT SUM(${rule.sourceField}) as sum FROM ${sourceTable}`;
            targetQuery = `SELECT SUM(${rule.targetField}) as sum FROM ${targetTable}`;
            break;
          case "existence":
            sourceQuery = `SELECT DISTINCT ${rule.sourceField} FROM ${sourceTable}`;
            targetQuery = `SELECT DISTINCT ${rule.targetField} FROM ${targetTable}`;
            break;
          default:
            throw new Error(
              `Unknown reconciliation operation: ${rule.operation}`
            );
        }
        const [sourceResult, targetResult] = await Promise.all([
          ClickHouseClient.execute(sourceQuery, params),
          ClickHouseClient.execute(targetQuery, params),
        ]);
        let status: "passed" | "failed" = "passed";
        let details: unknown = {
          source: sourceResult[0],
          target: targetResult[0],
        };
        if (rule.operation === "count" || rule.operation === "sum") {
          const sourceValue = sourceResult[0]?.[rule.operation] || 0;
          const targetValue = targetResult[0]?.[rule.operation] || 0;
          const tolerance = rule.tolerance || 0;
          const difference = Math.abs(sourceValue - targetValue);
          const percentageDiff = sourceValue
            ? (difference / sourceValue) * 100
            : 0;
          status = percentageDiff <= tolerance ? "passed" : "failed";
          (details as any).difference = difference;
          (details as any).percentageDiff = percentageDiff;
        }
        results.push({
          rule: `${rule.operation}_${rule.sourceField}_${rule.targetField}`,
          status,
          details,
        });
      } catch (error) {
        results.push({
          rule: `${rule.operation}_${rule.sourceField}_${rule.targetField}`,
          status: "failed",
          details: { error: (error as Error).message },
        });
      }
    }
    return results;
  }

  /**
   * Business Intelligence report generation
   */
  /**
   * Business Intelligence report generation
   */
  static async generateReport(
    reportType: "user_behavior" | "cart_analytics" | "feature_usage" | "custom",
    filters: Record<
      string,
      string | number | boolean | Date | { operator: string; value: any } | null
    > = {},
    options: {
      dateFrom?: string;
      dateTo?: string;
      groupBy?: string;
      metrics?: string[];
      customQuery?: { table: string; aggregations: any[] };
    } = {}
  ): Promise<any[]> {
    const { dateFrom, dateTo, groupBy, metrics, customQuery } = options;

    switch (reportType) {
      case "user_behavior":
        return this.getUserBehaviorReport(filters, {
          dateFrom,
          dateTo,
          groupBy,
        });

      case "cart_analytics":
        return this.getCartAnalyticsReport(filters, {
          dateFrom,
          dateTo,
          groupBy,
        });

      case "feature_usage":
        return this.getFeatureUsageReport(filters, {
          dateFrom,
          dateTo,
          groupBy,
        });

      case "custom":
        if (!customQuery) {
          throw new Error(
            "Custom query configuration required for custom reports"
          );
        }
        return this.getAnalyticsData(
          customQuery.table,
          customQuery.aggregations,
          filters,
          {
            groupBy: groupBy ? [groupBy] : undefined,
            dateFrom,
            dateTo,
          }
        );

      default:
        throw new Error(`Unknown report type: ${reportType}`);
    }
  }

  // === Private Helper Methods ===

  /**
   * Private: Get user behavior report
   */
  private static async getUserBehaviorReport(
    filters: Record<
      string,
      string | number | boolean | Date | { operator: string; value: any } | null
    >,
    options: { dateFrom?: string; dateTo?: string; groupBy?: string }
  ): Promise<any[]> {
    const aggregations = [
      { field: "userId", function: "COUNT" as const, alias: "unique_users" },
      { field: "eventType", function: "COUNT" as const, alias: "total_events" },
    ];

    return this.getAnalyticsData("user_events", aggregations, filters, {
      groupBy: options.groupBy ? [options.groupBy] : ["eventType"],
      dateFrom: options.dateFrom,
      dateTo: options.dateTo,
    });
  }

  /**
   * Private: Get cart analytics report
   */
  private static async getCartAnalyticsReport(
    filters: Record<
      string,
      string | number | boolean | Date | { operator: string; value: any } | null
    >,
    options: { dateFrom?: string; dateTo?: string; groupBy?: string }
  ): Promise<any[]> {
    const aggregations = [
      { field: "total", function: "SUM" as const, alias: "total_revenue" },
      { field: "id", function: "COUNT" as const, alias: "cart_count" },
      { field: "total", function: "AVG" as const, alias: "avg_cart_value" },
    ];

    return this.getAnalyticsData("carts", aggregations, filters, {
      groupBy: options.groupBy ? [options.groupBy] : ["status"],
      dateFrom: options.dateFrom,
      dateTo: options.dateTo,
    });
  }

  /**
   * Private: Get feature usage report
   */
  private static async getFeatureUsageReport(
    filters: Record<
      string,
      string | number | boolean | Date | { operator: string; value: any } | null
    >,
    options: { dateFrom?: string; dateTo?: string; groupBy?: string }
  ): Promise<any[]> {
    const aggregations = [
      { field: "name", function: "COUNT" as const, alias: "usage_count" },
      { field: "cartId", function: "COUNT" as const, alias: "unique_carts" },
    ];

    return this.getAnalyticsData("features", aggregations, filters, {
      groupBy: options.groupBy ? [options.groupBy] : ["name"],
      dateFrom: options.dateFrom,
      dateTo: options.dateTo,
    });
  }
}
