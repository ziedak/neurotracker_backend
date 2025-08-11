import { PostgreSQLClient } from "./postgresql";
import { ClickHouseClient } from "./clickhouse";
import { RedisClient } from "./redis";
import {
  QueryBuilder,
  FeatureQueryBuilder,
  CartQueryBuilder,
  UserEventQueryBuilder,
} from "./query-builder";
import { ClickHouseQueryBuilder } from "./clickhouse-query-builder";
import { Prisma } from "../node_modules/.prisma/client";

/**
 * Database service utilities that provide secure, reusable patterns
 * All methods prevent SQL injection and use parameterized queries
 */
export class DatabaseUtils {
  /**
   * Feature Store Operations
   */
  static async getFeatures(
    cartId: string,
    options: {
      featureNames?: string[];
      includeExpired?: boolean;
      fromCache?: boolean;
      cacheKeyPrefix?: string;
    } = {}
  ): Promise<Record<string, any>> {
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
          const parsedCache = JSON.parse(cached);

          // Filter by feature names if specified
          if (featureNames?.length) {
            const filtered: Record<string, any> = {};
            featureNames.forEach((name) => {
              if (parsedCache[name] !== undefined) {
                filtered[name] = parsedCache[name];
              }
            });
            return filtered;
          }

          return parsedCache;
        }
      } catch (error) {
        console.warn("Cache retrieval failed:", error);
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
    const result: Record<string, any> = {};
    features.forEach((feature) => {
      result[feature.name] = feature.value;
    });

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
        console.warn("Cache storage failed:", error);
      }
    }

    return result;
  }

  /**
   * Store features with upsert logic and caching
   */
  static async storeFeatures(
    cartId: string,
    features: Record<string, any>,
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
          // First try to find existing feature
          const existing = await tx.feature.findFirst({
            where: {
              cartId: cartId,
              name: name,
            },
          });

          if (existing) {
            // Update existing feature
            return tx.feature.update({
              where: { id: existing.id },
              data: {
                value: value,
                updatedAt: new Date(),
              },
            });
          } else {
            // Create new feature
            return tx.feature.create({
              data: {
                cartId: cartId,
                name: name,
                value: value,
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
      console.warn("Cache update failed:", error);
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
    filters: Record<string, any> = {},
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

    // Add date range if specified
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
    filters: Record<string, any> = {},
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
      limit: Math.min(options.limit || 10000, 100000), // Max 100k records per export
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
      criteria?: Record<string, any>;
    }[]
  ): Promise<
    Array<{ check: string; status: "passed" | "failed"; details?: any }>
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

    const results = [];

    for (const check of checks) {
      try {
        let query: string;
        let params: Record<string, any> = {};

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
            // Example: Check if all emails are valid format
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

        // Determine pass/fail based on check type
        let status: "passed" | "failed" = "passed";
        let details: any = result[0];

        if (check.type === "uniqueness" && result[0]) {
          status =
            result[0].total === result[0].unique_count ? "passed" : "failed";
        } else if (check.type === "completeness" && result[0]) {
          const completeness = result[0].non_null_count / result[0].total;
          status = completeness >= 0.95 ? "passed" : "failed"; // 95% completeness threshold
        }

        results.push({
          check: `${check.type}_${check.field || table}`,
          status,
          details,
        });
      } catch (error) {
        results.push({
          check: `${check.type}_${check.field || table}`,
          status: "failed" as const,
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
    Array<{ rule: string; status: "passed" | "failed"; details: any }>
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

    const results = [];

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
        const params = {};

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

        // Compare results
        let status: "passed" | "failed" = "passed";
        let details: any = {
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
          details.difference = difference;
          details.percentageDiff = percentageDiff;
        }

        results.push({
          rule: `${rule.operation}_${rule.sourceField}_${rule.targetField}`,
          status,
          details,
        });
      } catch (error) {
        results.push({
          rule: `${rule.operation}_${rule.sourceField}_${rule.targetField}`,
          status: "failed" as const,
          details: { error: (error as Error).message },
        });
      }
    }

    return results;
  }

  /**
   * Business Intelligence report generation
   */
  static async generateReport(
    reportType: "user_behavior" | "cart_analytics" | "feature_usage" | "custom",
    filters: Record<string, any> = {},
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

  private static async getUserBehaviorReport(
    filters: Record<string, any>,
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

  private static async getCartAnalyticsReport(
    filters: Record<string, any>,
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

  private static async getFeatureUsageReport(
    filters: Record<string, any>,
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
