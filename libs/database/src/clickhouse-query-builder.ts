/**
 * Secure ClickHouse Query Builder
 * Prevents SQL injection by using parameterized queries
 */
export class ClickHouseQueryBuilder {
  /**
   * Build safe parameterized SELECT query for ClickHouse
   */
  static buildSelectQuery(
    table: string,
    options: {
      select?: string[];
      where?: Record<string, any>;
      groupBy?: string[];
      orderBy?: { field: string; direction: "ASC" | "DESC" }[];
      limit?: number;
      offset?: number;
      allowedTables?: string[];
      allowedFields?: string[];
    } = {}
  ): { query: string; params: Record<string, any> } {
    const {
      select = ["*"],
      where = {},
      groupBy = [],
      orderBy = [],
      limit,
      offset,
      allowedTables = [],
      allowedFields = [],
    } = options;

    // Validate table name
    if (
      !this.isValidIdentifier(table) ||
      (allowedTables.length > 0 && !allowedTables.includes(table))
    ) {
      throw new Error(`Invalid or unauthorized table name: ${table}`);
    }

    // Validate and build SELECT clause
    const selectClause = this.buildSelectClause(select, allowedFields);

    // Build WHERE clause with parameters
    const { whereClause, params } = this.buildWhereClause(where);

    // Build GROUP BY clause
    const groupByClause = this.buildGroupByClause(groupBy, allowedFields);

    // Build ORDER BY clause
    const orderByClause = this.buildOrderByClause(orderBy, allowedFields);

    // Build LIMIT and OFFSET
    const limitOffsetClause = this.buildLimitOffsetClause(limit, offset);

    // Construct final query
    let query = `SELECT ${selectClause} FROM ${table}`;

    if (whereClause) {
      query += ` WHERE ${whereClause}`;
    }

    if (groupByClause) {
      query += ` GROUP BY ${groupByClause}`;
    }

    if (orderByClause) {
      query += ` ORDER BY ${orderByClause}`;
    }

    if (limitOffsetClause) {
      query += ` ${limitOffsetClause}`;
    }

    return { query, params };
  }

  /**
   * Build safe INSERT query for ClickHouse
   */
  static buildInsertQuery(
    table: string,
    data: Record<string, any>[],
    options: {
      allowedTables?: string[];
      allowedFields?: string[];
    } = {}
  ): { table: string; data: Record<string, any>[] } {
    const { allowedTables = [], allowedFields = [] } = options;

    // Validate table name
    if (
      !this.isValidIdentifier(table) ||
      (allowedTables.length > 0 && !allowedTables.includes(table))
    ) {
      throw new Error(`Invalid or unauthorized table name: ${table}`);
    }

    // Validate and sanitize data
    const sanitizedData = data.map((row) => {
      const sanitizedRow: Record<string, any> = {};

      Object.entries(row).forEach(([key, value]) => {
        // Validate field name
        if (
          !this.isValidIdentifier(key) ||
          (allowedFields.length > 0 && !allowedFields.includes(key))
        ) {
          throw new Error(`Invalid or unauthorized field name: ${key}`);
        }

        // Sanitize value
        sanitizedRow[key] = this.sanitizeValue(value);
      });

      return sanitizedRow;
    });

    return { table, data: sanitizedData };
  }

  /**
   * Build safe aggregation query
   */
  static buildAggregationQuery(
    table: string,
    aggregations: {
      field: string;
      function: "COUNT" | "SUM" | "AVG" | "MIN" | "MAX" | "STDDEV";
      alias?: string;
    }[],
    options: {
      where?: Record<string, any>;
      groupBy?: string[];
      having?: Record<string, any>;
      allowedTables?: string[];
      allowedFields?: string[];
    } = {}
  ): { query: string; params: Record<string, any> } {
    const {
      where = {},
      groupBy = [],
      having = {},
      allowedTables = [],
      allowedFields = [],
    } = options;

    // Validate table name
    if (
      !this.isValidIdentifier(table) ||
      (allowedTables.length > 0 && !allowedTables.includes(table))
    ) {
      throw new Error(`Invalid or unauthorized table name: ${table}`);
    }

    // Build aggregation SELECT clause
    const selectParts = aggregations.map((agg) => {
      if (
        !this.isValidIdentifier(agg.field) ||
        (allowedFields.length > 0 && !allowedFields.includes(agg.field))
      ) {
        throw new Error(`Invalid or unauthorized field name: ${agg.field}`);
      }

      const alias = agg.alias ? ` AS ${this.escapeIdentifier(agg.alias)}` : "";
      return `${agg.function}(${this.escapeIdentifier(agg.field)})${alias}`;
    });

    const selectClause = selectParts.join(", ");

    // Build WHERE clause
    const { whereClause, params } = this.buildWhereClause(where);

    // Build GROUP BY clause
    const groupByClause = this.buildGroupByClause(groupBy, allowedFields);

    // Build HAVING clause
    const { whereClause: havingClause, params: havingParams } =
      this.buildWhereClause(having, "having_");

    // Merge parameters
    const allParams = { ...params, ...havingParams };

    // Construct query
    let query = `SELECT ${selectClause} FROM ${table}`;

    if (whereClause) {
      query += ` WHERE ${whereClause}`;
    }

    if (groupByClause) {
      query += ` GROUP BY ${groupByClause}`;
    }

    if (havingClause) {
      query += ` HAVING ${havingClause}`;
    }

    return { query, params: allParams };
  }

  /**
   * Build safe time-series query with date functions
   */
  static buildTimeSeriesQuery(
    table: string,
    dateField: string,
    interval: "minute" | "hour" | "day" | "week" | "month",
    options: {
      select?: string[];
      where?: Record<string, any>;
      dateFrom?: string | Date;
      dateTo?: string | Date;
      allowedTables?: string[];
      allowedFields?: string[];
    } = {}
  ): { query: string; params: Record<string, any> } {
    const {
      select = ["*"],
      where = {},
      dateFrom,
      dateTo,
      allowedTables = [],
      allowedFields = [],
    } = options;

    // Validate inputs
    if (
      !this.isValidIdentifier(table) ||
      (allowedTables.length > 0 && !allowedTables.includes(table))
    ) {
      throw new Error(`Invalid or unauthorized table name: ${table}`);
    }

    if (
      !this.isValidIdentifier(dateField) ||
      (allowedFields.length > 0 && !allowedFields.includes(dateField))
    ) {
      throw new Error(`Invalid or unauthorized date field: ${dateField}`);
    }

    // Build time interval function
    const intervalFunction = this.getIntervalFunction(interval, dateField);

    // Build SELECT clause with time grouping
    const selectClause = [
      `${intervalFunction} AS time_interval`,
      ...select.filter(
        (field) =>
          this.isValidIdentifier(field) &&
          (allowedFields.length === 0 || allowedFields.includes(field))
      ),
    ].join(", ");

    // Add date range to WHERE conditions
    const whereWithDate = { ...where };
    if (dateFrom) {
      whereWithDate[`${dateField}_from`] = dateFrom;
    }
    if (dateTo) {
      whereWithDate[`${dateField}_to`] = dateTo;
    }

    // Build WHERE clause
    const { whereClause, params } = this.buildWhereClauseWithDateRange(
      whereWithDate,
      dateField
    );

    // Construct query
    let query = `SELECT ${selectClause} FROM ${table}`;

    if (whereClause) {
      query += ` WHERE ${whereClause}`;
    }

    query += ` GROUP BY time_interval ORDER BY time_interval`;

    return { query, params };
  }

  // === Private Helper Methods ===

  private static buildSelectClause(
    select: string[],
    allowedFields: string[]
  ): string {
    if (select.includes("*")) {
      return "*";
    }

    const validFields = select.filter((field) => {
      return (
        this.isValidIdentifier(field) &&
        (allowedFields.length === 0 || allowedFields.includes(field))
      );
    });

    if (validFields.length === 0) {
      throw new Error("No valid fields specified in SELECT clause");
    }

    return validFields.map((field) => this.escapeIdentifier(field)).join(", ");
  }

  private static buildWhereClause(
    where: Record<string, any>,
    paramPrefix: string = ""
  ): { whereClause: string; params: Record<string, any> } {
    const conditions: string[] = [];
    const params: Record<string, any> = {};

    Object.entries(where).forEach(([key, value]) => {
      if (!this.isValidIdentifier(key)) {
        throw new Error(`Invalid field name: ${key}`);
      }

      const paramKey = `${paramPrefix}${key}`;

      if (Array.isArray(value)) {
        conditions.push(
          `${this.escapeIdentifier(key)} IN {${paramKey}:Array(String)}`
        );
        params[paramKey] = value.map((v) => this.sanitizeValue(v));
      } else if (value === null) {
        conditions.push(`${this.escapeIdentifier(key)} IS NULL`);
      } else if (typeof value === "object" && value.operator) {
        // Handle operators like >, <, >=, <=, LIKE
        const operator = this.validateOperator(value.operator);
        conditions.push(
          `${this.escapeIdentifier(key)} ${operator} {${paramKey}:String}`
        );
        params[paramKey] = this.sanitizeValue(value.value);
      } else {
        conditions.push(`${this.escapeIdentifier(key)} = {${paramKey}:String}`);
        params[paramKey] = this.sanitizeValue(value);
      }
    });

    return {
      whereClause: conditions.length > 0 ? conditions.join(" AND ") : "",
      params,
    };
  }

  private static buildWhereClauseWithDateRange(
    where: Record<string, any>,
    dateField: string
  ): { whereClause: string; params: Record<string, any> } {
    const conditions: string[] = [];
    const params: Record<string, any> = {};

    Object.entries(where).forEach(([key, value]) => {
      if (key === `${dateField}_from`) {
        conditions.push(
          `${this.escapeIdentifier(dateField)} >= {dateFrom:DateTime}`
        );
        params.dateFrom = new Date(value).toISOString();
      } else if (key === `${dateField}_to`) {
        conditions.push(
          `${this.escapeIdentifier(dateField)} <= {dateTo:DateTime}`
        );
        params.dateTo = new Date(value).toISOString();
      } else if (this.isValidIdentifier(key)) {
        if (Array.isArray(value)) {
          conditions.push(
            `${this.escapeIdentifier(key)} IN {${key}:Array(String)}`
          );
          params[key] = value.map((v) => this.sanitizeValue(v));
        } else {
          conditions.push(`${this.escapeIdentifier(key)} = {${key}:String}`);
          params[key] = this.sanitizeValue(value);
        }
      }
    });

    return {
      whereClause: conditions.length > 0 ? conditions.join(" AND ") : "",
      params,
    };
  }

  private static buildGroupByClause(
    groupBy: string[],
    allowedFields: string[]
  ): string {
    const validFields = groupBy.filter((field) => {
      return (
        this.isValidIdentifier(field) &&
        (allowedFields.length === 0 || allowedFields.includes(field))
      );
    });

    return validFields.length > 0
      ? validFields.map((field) => this.escapeIdentifier(field)).join(", ")
      : "";
  }

  private static buildOrderByClause(
    orderBy: { field: string; direction: "ASC" | "DESC" }[],
    allowedFields: string[]
  ): string {
    const validOrders = orderBy.filter((order) => {
      return (
        this.isValidIdentifier(order.field) &&
        (allowedFields.length === 0 || allowedFields.includes(order.field)) &&
        ["ASC", "DESC"].includes(order.direction)
      );
    });

    return validOrders.length > 0
      ? validOrders
          .map(
            (order) =>
              `${this.escapeIdentifier(order.field)} ${order.direction}`
          )
          .join(", ")
      : "";
  }

  private static buildLimitOffsetClause(
    limit?: number,
    offset?: number
  ): string {
    const parts: string[] = [];

    if (limit !== undefined) {
      const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 100000); // Max 100k records
      parts.push(`LIMIT ${safeLimit}`);
    }

    if (offset !== undefined) {
      const safeOffset = Math.max(0, Math.floor(offset));
      parts.push(`OFFSET ${safeOffset}`);
    }

    return parts.join(" ");
  }

  private static getIntervalFunction(
    interval: string,
    dateField: string
  ): string {
    const escapedField = this.escapeIdentifier(dateField);

    switch (interval) {
      case "minute":
        return `toStartOfMinute(${escapedField})`;
      case "hour":
        return `toStartOfHour(${escapedField})`;
      case "day":
        return `toStartOfDay(${escapedField})`;
      case "week":
        return `toStartOfWeek(${escapedField})`;
      case "month":
        return `toStartOfMonth(${escapedField})`;
      default:
        throw new Error(`Invalid time interval: ${interval}`);
    }
  }

  private static isValidIdentifier(identifier: string): boolean {
    // Check if identifier contains only valid characters (alphanumeric, underscore)
    return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier);
  }

  private static escapeIdentifier(identifier: string): string {
    if (!this.isValidIdentifier(identifier)) {
      throw new Error(`Invalid identifier: ${identifier}`);
    }
    return `"${identifier}"`;
  }

  private static validateOperator(operator: string): string {
    const allowedOperators = [
      "=",
      "!=",
      "<>",
      ">",
      "<",
      ">=",
      "<=",
      "LIKE",
      "NOT LIKE",
      "IN",
      "NOT IN",
    ];

    if (!allowedOperators.includes(operator.toUpperCase())) {
      throw new Error(`Invalid operator: ${operator}`);
    }

    return operator;
  }

  private static sanitizeValue(value: any): any {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === "string") {
      // Remove potential SQL injection patterns
      return value
        .replace(/['"`;\\]/g, "") // Remove quotes, semicolons, backslashes
        .replace(/--/g, "") // Remove SQL comments
        .replace(/\/\*/g, "") // Remove /* comments
        .replace(/\*\//g, "") // Remove */ comments
        .trim();
    }

    if (typeof value === "number") {
      return isNaN(value) ? 0 : value;
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    return value;
  }
}
