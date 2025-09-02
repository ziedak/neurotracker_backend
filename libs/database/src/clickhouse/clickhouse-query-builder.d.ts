/**
 * Usage Example:
 *
 * const { query, params } = ClickHouseQueryBuilder.buildSelectQuery('events', {
 *   select: ['id', 'timestamp'],
 *   where: { status: 'active' },
 *   allowedTables: ['events'],
 *   allowedFields: ['id', 'timestamp', 'status']
 * });
 */
export interface WindowFunctionQueryOptions {
    select: string[];
    where?: Record<string, string | number | boolean | Date | null | {
        operator: string;
        value: any;
    }>;
    orderBy?: {
        field: string;
        direction: "ASC" | "DESC";
    }[];
    limit?: number;
    offset?: number;
    allowedTables?: readonly string[];
    allowedFields?: readonly string[];
}
export interface SubqueryOptions {
    select: string[];
    where?: Record<string, string | number | boolean | Date | null | {
        operator: string;
        value: any;
    }>;
    orderBy?: {
        field: string;
        direction: "ASC" | "DESC";
    }[];
    limit?: number;
    offset?: number;
}
/**
 * Secure ClickHouse Query Builder
 * Prevents SQL injection by using parameterized queries
 * Optimized for strict typing, maintainability, and security
 */
export declare class ClickHouseQueryBuilder {
    /**
     * Centralized validation for allowed tables and fields
     */
    private static validateAllowed;
    /**
     * Build safe parameterized SELECT query for ClickHouse
     */
    static buildSelectQuery(table: string, options?: {
        select?: string[] | undefined;
        where?: Record<string, string | number | boolean | Date | null | {
            operator: string;
            value: any;
        }> | undefined;
        groupBy?: string[] | undefined;
        orderBy?: {
            field: string;
            direction: "ASC" | "DESC";
        }[] | undefined;
        limit?: number | undefined;
        offset?: number | undefined;
        allowedTables?: readonly string[] | undefined;
        allowedFields?: readonly string[] | undefined;
    }): {
        query: string;
        params: Record<string, any>;
    };
    /**
     * Build safe INSERT query for ClickHouse
     */
    static buildInsertQuery(table: string, data: Record<string, any>[], options?: {
        allowedTables?: readonly string[];
        allowedFields?: readonly string[];
    }): {
        table: string;
        data: Record<string, any>[];
    };
    /**
     * Build safe aggregation query
     */
    /**
     * Build safe aggregation query
     */
    static buildAggregationQuery(table: string, aggregations: {
        field: string;
        function: "COUNT" | "SUM" | "AVG" | "MIN" | "MAX" | "STDDEV";
        alias?: string;
    }[], options?: {
        where?: Record<string, string | number | boolean | Date | null | {
            operator: string;
            value: any;
        }> | undefined;
        groupBy?: string[] | undefined;
        having?: Record<string, string | number | boolean | Date | null | {
            operator: string;
            value: any;
        }> | undefined;
        allowedTables?: readonly string[] | undefined;
        allowedFields?: readonly string[] | undefined;
    }): {
        query: string;
        params: Record<string, any>;
    };
    /**
     * Build safe time-series query with date functions
     */
    static buildTimeSeriesQuery(table: string, dateField: string, interval: "minute" | "hour" | "day" | "week" | "month", options?: {
        select?: string[] | undefined;
        where?: Record<string, string | number | boolean | Date | null | {
            operator: string;
            value: any;
        }> | undefined;
        dateFrom?: string | Date | undefined;
        dateTo?: string | Date | undefined;
        allowedTables?: readonly string[] | undefined;
        allowedFields?: readonly string[] | undefined;
    }): {
        query: string;
        params: Record<string, any>;
    };
    /**
     * Build query with window functions and computed fields
     * Example: SELECT value, avg(value) OVER (PARTITION BY name) AS avgValue FROM table
     */
    static buildWindowFunctionQuery(table: string, options: WindowFunctionQueryOptions): {
        query: string;
        params: Record<string, any>;
    };
    /**
     * Build query with subquery support
     * Example: SELECT * FROM (subquery) WHERE ...
     */
    static buildSubquery(subquery: string, options: SubqueryOptions): {
        query: string;
        params: Record<string, any>;
    };
    /**
     * Build SELECT clause
     */
    private static buildSelectClause;
    /**
     * Build WHERE clause
     */
    private static buildWhereClause;
    /**
     * Build WHERE clause with date range
     */
    private static buildWhereClauseWithDateRange;
    /**
     * Build GROUP BY clause
     */
    private static buildGroupByClause;
    /**
     * Build ORDER BY clause
     */
    private static buildOrderByClause;
    /**
     * Build LIMIT and OFFSET clause
     */
    private static buildLimitOffsetClause;
    /**
     * Get ClickHouse interval function for time-series queries
     */
    private static getIntervalFunction;
    /**
     * Validate SQL identifier (table/field)
     */
    private static isValidIdentifier;
    /**
     * Escape SQL identifier
     */
    private static escapeIdentifier;
    /**
     * Validate SQL operator
     */
    private static validateOperator;
    /**
     * Sanitize value for SQL query
     */
    private static sanitizeValue;
}
//# sourceMappingURL=clickhouse-query-builder.d.ts.map