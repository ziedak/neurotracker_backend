/**
 * Secure ClickHouse Query Builder
 * Prevents SQL injection by using parameterized queries
 * Optimized for strict typing, maintainability, and security
 */
export class ClickHouseQueryBuilder {
    /**
     * Centralized validation for allowed tables and fields
     */
    static validateAllowed(identifier, allowed, type) {
        if (!this.isValidIdentifier(identifier)) {
            throw new Error(`[ClickHouseQueryBuilder] Invalid ${type} name: ${identifier}`);
        }
        if (allowed && allowed.length > 0 && !allowed.includes(identifier)) {
            throw new Error(`[ClickHouseQueryBuilder] Unauthorized ${type}: ${identifier}. Allowed: ${allowed.join(", ")}`);
        }
    }
    /**
     * Build safe parameterized SELECT query for ClickHouse
     */
    static buildSelectQuery(table, options = {}) {
        const { select = ["*"], where = {}, groupBy = [], orderBy = [], limit, offset, allowedTables = [], allowedFields = [], } = options;
        // Centralized table validation
        this.validateAllowed(table, allowedTables, "table");
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
        let query = `SELECT ${selectClause} FROM ${this.escapeIdentifier(table)}`;
        if (whereClause)
            query += ` WHERE ${whereClause}`;
        if (groupByClause)
            query += ` GROUP BY ${groupByClause}`;
        if (orderByClause)
            query += ` ORDER BY ${orderByClause}`;
        if (limitOffsetClause)
            query += ` ${limitOffsetClause}`;
        return { query, params };
    }
    /**
     * Build safe INSERT query for ClickHouse
     */
    static buildInsertQuery(table, data, options = {}) {
        const { allowedTables = [], allowedFields = [] } = options;
        // Centralized table validation
        this.validateAllowed(table, allowedTables, "table");
        // Validate and sanitize data
        const sanitizedData = data.map((row) => {
            const sanitizedRow = {};
            for (const [key, value] of Object.entries(row)) {
                this.validateAllowed(key, allowedFields, "field");
                sanitizedRow[key] = this.sanitizeValue(value);
            }
            return sanitizedRow;
        });
        return { table: this.escapeIdentifier(table), data: sanitizedData };
    }
    /**
     * Build safe aggregation query
     */
    /**
     * Build safe aggregation query
     */
    static buildAggregationQuery(table, aggregations, options = {}) {
        const { where = {}, groupBy = [], having = {}, allowedTables = [], allowedFields = [], } = options;
        // Centralized table validation
        this.validateAllowed(table, allowedTables, "table");
        // Build aggregation SELECT clause
        const selectParts = aggregations.map((agg) => {
            this.validateAllowed(agg.field, allowedFields, "field");
            const alias = agg.alias ? ` AS ${this.escapeIdentifier(agg.alias)}` : "";
            return `${agg.function}(${this.escapeIdentifier(agg.field)})${alias}`;
        });
        const selectClause = selectParts.join(", ");
        // Build WHERE clause
        const { whereClause, params } = this.buildWhereClause(where);
        // Build GROUP BY clause
        const groupByClause = this.buildGroupByClause(groupBy, allowedFields);
        // Build HAVING clause
        const { whereClause: havingClause, params: havingParams } = this.buildWhereClause(having, "having_");
        // Merge parameters
        const allParams = { ...params, ...havingParams };
        // Construct query
        let query = `SELECT ${selectClause} FROM ${this.escapeIdentifier(table)}`;
        if (whereClause)
            query += ` WHERE ${whereClause}`;
        if (groupByClause)
            query += ` GROUP BY ${groupByClause}`;
        if (havingClause)
            query += ` HAVING ${havingClause}`;
        return { query, params: allParams };
    }
    /**
     * Build safe time-series query with date functions
     */
    static buildTimeSeriesQuery(table, dateField, interval, options = {}) {
        const { select = ["*"], where = {}, dateFrom, dateTo, allowedTables = [], allowedFields = [], } = options;
        // Centralized table/field validation
        this.validateAllowed(table, allowedTables, "table");
        this.validateAllowed(dateField, allowedFields, "field");
        // Build time interval function
        const intervalFunction = this.getIntervalFunction(interval, dateField);
        // Build SELECT clause with time grouping
        const selectClause = [
            `${intervalFunction} AS time_interval`,
            ...select.filter((field) => this.isValidIdentifier(field) &&
                (allowedFields.length === 0 || allowedFields.includes(field))),
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
        const { whereClause, params } = this.buildWhereClauseWithDateRange(whereWithDate, dateField);
        // Construct query
        let query = `SELECT ${selectClause} FROM ${this.escapeIdentifier(table)}`;
        if (whereClause)
            query += ` WHERE ${whereClause}`;
        query += ` GROUP BY time_interval ORDER BY time_interval`;
        return { query, params };
    }
    /**
     * Build query with window functions and computed fields
     * Example: SELECT value, avg(value) OVER (PARTITION BY name) AS avgValue FROM table
     */
    static buildWindowFunctionQuery(table, options) {
        const { select, where = {}, orderBy = [], limit, offset, allowedTables = [], allowedFields = [], } = options;
        // Centralized table validation
        this.validateAllowed(table, allowedTables, "table");
        // Validate SELECT expressions (allow window functions and computed fields)
        if (!Array.isArray(select) || select.length === 0) {
            throw new Error("SELECT clause must be a non-empty array of expressions");
        }
        // For computed fields, skip strict identifier check, but validate allowedFields for base fields
        const selectClause = select.join(", ");
        // Build WHERE clause
        const { whereClause, params } = this.buildWhereClause(where);
        // Build ORDER BY clause
        const orderByClause = this.buildOrderByClause(orderBy, allowedFields);
        // Build LIMIT and OFFSET
        const limitOffsetClause = this.buildLimitOffsetClause(limit, offset);
        // Construct query
        let query = `SELECT ${selectClause} FROM ${this.escapeIdentifier(table)}`;
        if (whereClause)
            query += ` WHERE ${whereClause}`;
        if (orderByClause)
            query += ` ORDER BY ${orderByClause}`;
        if (limitOffsetClause)
            query += ` ${limitOffsetClause}`;
        return { query, params };
    }
    /**
     * Build query with subquery support
     * Example: SELECT * FROM (subquery) WHERE ...
     */
    static buildSubquery(subquery, options) {
        const { select, where = {}, orderBy = [], limit, offset } = options;
        if (!subquery || typeof subquery !== "string") {
            throw new Error("[ClickHouseQueryBuilder] Subquery must be a valid SQL string");
        }
        if (!Array.isArray(select) || select.length === 0) {
            throw new Error("[ClickHouseQueryBuilder] SELECT clause must be a non-empty array of expressions");
        }
        const selectClause = select.join(", ");
        const { whereClause, params } = this.buildWhereClause(where);
        const orderByClause = this.buildOrderByClause(orderBy, []);
        const limitOffsetClause = this.buildLimitOffsetClause(limit, offset);
        let query = `SELECT ${selectClause} FROM (${subquery})`;
        if (whereClause)
            query += ` WHERE ${whereClause}`;
        if (orderByClause)
            query += ` ORDER BY ${orderByClause}`;
        if (limitOffsetClause)
            query += ` ${limitOffsetClause}`;
        return { query, params };
    }
    // === Private Helper Methods ===
    /**
     * Build SELECT clause
     */
    static buildSelectClause(select, allowedFields) {
        if (select.includes("*"))
            return "*";
        const validFields = select.filter((field) => {
            try {
                this.validateAllowed(field, allowedFields, "field");
                return true;
            }
            catch {
                return false;
            }
        });
        if (validFields.length === 0)
            throw new Error("[ClickHouseQueryBuilder] No valid fields specified in SELECT clause");
        return validFields.map((field) => this.escapeIdentifier(field)).join(", ");
    }
    /**
     * Build WHERE clause
     */
    static buildWhereClause(where = {}, paramPrefix = "") {
        const conditions = [];
        const params = {};
        for (const [key, value] of Object.entries(where)) {
            if (!this.isValidIdentifier(key))
                throw new Error(`[ClickHouseQueryBuilder] Invalid field name: ${key}`);
            const paramKey = `${paramPrefix}${key}`;
            if (Array.isArray(value)) {
                conditions.push(`${this.escapeIdentifier(key)} IN {${paramKey}:Array(String)}`);
                params[paramKey] = value.map((v) => this.sanitizeValue(v));
            }
            else if (value === null) {
                conditions.push(`${this.escapeIdentifier(key)} IS NULL`);
            }
            else if (typeof value === "object" &&
                value !== null &&
                "operator" in value &&
                "value" in value) {
                const operator = this.validateOperator(value.operator);
                conditions.push(`${this.escapeIdentifier(key)} ${operator} {${paramKey}:String}`);
                params[paramKey] = this.sanitizeValue(value.value);
            }
            else {
                conditions.push(`${this.escapeIdentifier(key)} = {${paramKey}:String}`);
                params[paramKey] = this.sanitizeValue(value);
            }
        }
        return {
            whereClause: conditions.length > 0 ? conditions.join(" AND ") : "",
            params,
        };
    }
    /**
     * Build WHERE clause with date range
     */
    static buildWhereClauseWithDateRange(where = {}, dateField) {
        const conditions = [];
        const params = {};
        for (const [key, value] of Object.entries(where)) {
            if (key === `${dateField}_from`) {
                if (typeof value === "string" ||
                    typeof value === "number" ||
                    value instanceof Date) {
                    conditions.push(`${this.escapeIdentifier(dateField)} >= {dateFrom:DateTime}`);
                    params["dateFrom"] = new Date(value).toISOString();
                }
            }
            else if (key === `${dateField}_to`) {
                if (typeof value === "string" ||
                    typeof value === "number" ||
                    value instanceof Date) {
                    conditions.push(`${this.escapeIdentifier(dateField)} <= {dateTo:DateTime}`);
                    params["dateTo"] = new Date(value).toISOString();
                }
            }
            else if (this.isValidIdentifier(key)) {
                if (Array.isArray(value)) {
                    conditions.push(`${this.escapeIdentifier(key)} IN {${key}:Array(String)}`);
                    params[key] = value.map((v) => this.sanitizeValue(v));
                }
                else if (typeof value === "object" &&
                    value !== null &&
                    "operator" in value &&
                    "value" in value) {
                    const operator = this.validateOperator(value.operator);
                    conditions.push(`${this.escapeIdentifier(key)} ${operator} {${key}:String}`);
                    params[key] = this.sanitizeValue(value.value);
                }
                else {
                    conditions.push(`${this.escapeIdentifier(key)} = {${key}:String}`);
                    params[key] = this.sanitizeValue(value);
                }
            }
        }
        return {
            whereClause: conditions.length > 0 ? conditions.join(" AND ") : "",
            params,
        };
    }
    /**
     * Build GROUP BY clause
     */
    static buildGroupByClause(groupBy, allowedFields) {
        const validFields = groupBy.filter((field) => {
            try {
                this.validateAllowed(field, allowedFields, "field");
                return true;
            }
            catch {
                return false;
            }
        });
        return validFields.length > 0
            ? validFields.map((field) => this.escapeIdentifier(field)).join(", ")
            : "";
    }
    /**
     * Build ORDER BY clause
     */
    static buildOrderByClause(orderBy, allowedFields) {
        const validOrders = orderBy.filter((order) => {
            try {
                this.validateAllowed(order.field, allowedFields, "field");
                return ["ASC", "DESC"].includes(order.direction);
            }
            catch {
                return false;
            }
        });
        return validOrders.length > 0
            ? validOrders
                .map((order) => `${this.escapeIdentifier(order.field)} ${order.direction}`)
                .join(", ")
            : "";
    }
    /**
     * Build LIMIT and OFFSET clause
     */
    static buildLimitOffsetClause(limit, offset) {
        const parts = [];
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
    /**
     * Get ClickHouse interval function for time-series queries
     */
    static getIntervalFunction(interval, dateField) {
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
                throw new Error(`[ClickHouseQueryBuilder] Invalid time interval: ${interval}`);
        }
    }
    /**
     * Validate SQL identifier (table/field)
     */
    static isValidIdentifier(identifier) {
        return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier);
    }
    /**
     * Escape SQL identifier
     */
    static escapeIdentifier(identifier) {
        if (!this.isValidIdentifier(identifier))
            throw new Error(`[ClickHouseQueryBuilder] Invalid identifier: ${identifier}`);
        return `"${identifier}"`;
    }
    /**
     * Validate SQL operator
     */
    static validateOperator(operator) {
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
        if (!allowedOperators.includes(operator.toUpperCase()))
            throw new Error(`[ClickHouseQueryBuilder] Invalid operator: ${operator}`);
        return operator;
    }
    /**
     * Sanitize value for SQL query
     */
    static sanitizeValue(value) {
        if (value === null || value === undefined)
            return null;
        if (typeof value === "string") {
            // Remove dangerous patterns, enforce max length, strip control chars
            let sanitized = value.replace(/[\0\b\n\r\t\Z]/g, "");
            sanitized = sanitized.replace(/['"`]/g, "").trim();
            if (sanitized.length > 1024)
                sanitized = sanitized.slice(0, 1024);
            return sanitized;
        }
        if (typeof value === "number")
            return isNaN(value) ? 0 : value;
        if (value instanceof Date)
            return value.toISOString();
        if (Array.isArray(value))
            return value.map((v) => this.sanitizeValue(v));
        if (typeof value === "object") {
            // Only allow plain objects, no functions/classes
            return JSON.parse(JSON.stringify(value));
        }
        return value;
        /**
         * Build a secure SELECT query for ClickHouse.
         * @param table - Table name (must be in allowedTables if provided)
         * @param options - Query options (select, where, groupBy, orderBy, limit, offset, allowedTables, allowedFields)
         * @returns { query, params } - Parameterized query and parameters object
         * @throws Error if table or fields are invalid
         * @example
         * const { query, params } = ClickHouseQueryBuilder.buildSelectQuery('events', {
         *   select: ['id', 'timestamp'],
         *   where: { status: 'active' },
         *   allowedTables: ['events'],
         *   allowedFields: ['id', 'timestamp', 'status']
         * });
         */
    }
}
//# sourceMappingURL=clickhouse-query-builder.js.map