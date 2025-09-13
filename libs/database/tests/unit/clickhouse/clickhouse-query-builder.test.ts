import { ClickHouseQueryBuilder } from "../../../src/clickhouse/clickhouse-query-builder";

describe("ClickHouseQueryBuilder", () => {
  describe("buildSelectQuery", () => {
    it("should build basic SELECT query", () => {
      const { query, params } = ClickHouseQueryBuilder.buildSelectQuery(
        "users",
        {
          select: ["id", "name"],
        }
      );

      expect(query).toBe('SELECT "id", "name" FROM "users"');
      expect(params).toEqual({});
    });

    it("should build SELECT query with WHERE clause", () => {
      const { query, params } = ClickHouseQueryBuilder.buildSelectQuery(
        "users",
        {
          select: ["id", "name"],
          where: { status: "active", age: { operator: ">", value: 18 } },
        }
      );

      expect(query).toBe(
        'SELECT "id", "name" FROM "users" WHERE "status" = {status:String} AND "age" > {age:String}'
      );
      expect(params).toEqual({ status: "active", age: 18 });
    });

    it("should build SELECT query with GROUP BY and ORDER BY", () => {
      const { query, params } = ClickHouseQueryBuilder.buildSelectQuery(
        "events",
        {
          select: ["category"],
          groupBy: ["category"],
          orderBy: [{ field: "category", direction: "DESC" }],
        }
      );

      expect(query).toBe(
        'SELECT "category" FROM "events" GROUP BY "category" ORDER BY "category" DESC'
      );
      expect(params).toEqual({});
    });

    it("should build SELECT query with LIMIT and OFFSET", () => {
      const { query, params } = ClickHouseQueryBuilder.buildSelectQuery(
        "users",
        {
          select: ["id", "name"],
          limit: 10,
          offset: 20,
        }
      );

      expect(query).toBe('SELECT "id", "name" FROM "users" LIMIT 10 OFFSET 20');
      expect(params).toEqual({});
    });

    it("should handle SELECT *", () => {
      const { query, params } = ClickHouseQueryBuilder.buildSelectQuery(
        "users",
        {
          select: ["*"],
        }
      );

      expect(query).toBe('SELECT * FROM "users"');
      expect(params).toEqual({});
    });

    it("should validate allowed tables", () => {
      expect(() => {
        ClickHouseQueryBuilder.buildSelectQuery("unauthorized_table", {
          select: ["id"],
          allowedTables: ["users", "posts"],
        });
      }).toThrow("Unauthorized table: unauthorized_table");
    });

    it("should validate allowed fields", () => {
      expect(() => {
        ClickHouseQueryBuilder.buildSelectQuery("users", {
          select: ["unauthorized_field"],
          allowedFields: ["id", "name"],
        });
      }).toThrow("No valid fields specified in SELECT clause");
    });

    it("should handle IN operator with arrays", () => {
      const { query, params } = ClickHouseQueryBuilder.buildSelectQuery(
        "users",
        {
          select: ["id", "name"],
          // @ts-expect-error Testing array input for IN operator
          where: { status: ["active", "pending"] },
        }
      );

      expect(query).toBe(
        'SELECT "id", "name" FROM "users" WHERE "status" IN {status:Array(String)}'
      );
      expect(params).toEqual({ status: ["active", "pending"] });
    });

    it("should handle NULL values", () => {
      const { query, params } = ClickHouseQueryBuilder.buildSelectQuery(
        "users",
        {
          select: ["id", "name"],
          where: { deleted_at: null },
        }
      );

      expect(query).toBe(
        'SELECT "id", "name" FROM "users" WHERE "deleted_at" IS NULL'
      );
      expect(params).toEqual({});
    });
  });

  describe("buildInsertQuery", () => {
    it("should build INSERT query", () => {
      const data = [
        { id: 1, name: "John" },
        { id: 2, name: "Jane" },
      ];

      const result = ClickHouseQueryBuilder.buildInsertQuery("users", data);

      expect(result.table).toBe('"users"');
      expect(result.data).toEqual(data);
    });

    it("should validate table permissions", () => {
      expect(() => {
        ClickHouseQueryBuilder.buildInsertQuery("unauthorized", [{ id: 1 }], {
          allowedTables: ["users"],
        });
      }).toThrow("Unauthorized table: unauthorized");
    });

    it("should validate field permissions", () => {
      expect(() => {
        ClickHouseQueryBuilder.buildInsertQuery(
          "users",
          [{ unauthorized: "field" }],
          {
            allowedFields: ["id", "name"],
          }
        );
      }).toThrow("Unauthorized field: unauthorized");
    });
  });

  describe("buildAggregationQuery", () => {
    it("should build aggregation query with COUNT", () => {
      const { query, params } = ClickHouseQueryBuilder.buildAggregationQuery(
        "events",
        [{ field: "id", function: "COUNT", alias: "total" }],
        {
          where: { category: "click" },
        }
      );

      expect(query).toBe(
        'SELECT COUNT("id") AS "total" FROM "events" WHERE "category" = {category:String}'
      );
      expect(params).toEqual({ category: "click" });
    });

    it("should build aggregation query with multiple functions", () => {
      const { query, params } = ClickHouseQueryBuilder.buildAggregationQuery(
        "metrics",
        [
          { field: "value", function: "SUM", alias: "total" },
          { field: "value", function: "AVG", alias: "average" },
          { field: "id", function: "COUNT", alias: "count" },
        ],
        {
          groupBy: ["category"],
          having: { total: { operator: ">", value: 100 } },
        }
      );

      expect(query).toBe(
        'SELECT SUM("value") AS "total", AVG("value") AS "average", COUNT("id") AS "count" FROM "metrics" GROUP BY "category" HAVING "total" > {having_total:String}'
      );
      expect(params).toEqual({ having_total: 100 });
    });
  });

  describe("buildTimeSeriesQuery", () => {
    it("should build time-series query with minute intervals", () => {
      const { query, params } = ClickHouseQueryBuilder.buildTimeSeriesQuery(
        "events",
        "timestamp",
        "minute",
        {
          select: ["value"],
          dateFrom: "2023-01-01T00:00:00Z",
          dateTo: "2023-01-02T00:00:00Z",
        }
      );

      expect(query).toBe(
        'SELECT toStartOfMinute("timestamp") AS time_interval, "value" FROM "events" WHERE "timestamp" >= {dateFrom:DateTime} AND "timestamp" <= {dateTo:DateTime} GROUP BY time_interval ORDER BY time_interval'
      );
      expect(params).toEqual({
        dateFrom: "2023-01-01T00:00:00.000Z",
        dateTo: "2023-01-02T00:00:00.000Z",
      });
    });

    it("should build time-series query with hour intervals", () => {
      const { query, params } = ClickHouseQueryBuilder.buildTimeSeriesQuery(
        "events",
        "created_at",
        "hour",
        {
          select: ["amount"],
        }
      );

      expect(query).toBe(
        'SELECT toStartOfHour("created_at") AS time_interval, "amount" FROM "events" GROUP BY time_interval ORDER BY time_interval'
      );
      expect(params).toEqual({});
    });
  });

  describe("buildWindowFunctionQuery", () => {
    it("should build window function query", () => {
      const { query, params } = ClickHouseQueryBuilder.buildWindowFunctionQuery(
        "sales",
        {
          select: [
            "product",
            "amount",
            "SUM(amount) OVER (PARTITION BY product ORDER BY date) as running_total",
          ],
          where: { category: "electronics" },
          orderBy: [{ field: "date", direction: "ASC" }],
          limit: 100,
        }
      );

      expect(query).toBe(
        'SELECT product, amount, SUM(amount) OVER (PARTITION BY product ORDER BY date) as running_total FROM "sales" WHERE "category" = {category:String} ORDER BY "date" ASC LIMIT 100'
      );
      expect(params).toEqual({ category: "electronics" });
    });
  });

  describe("buildSubquery", () => {
    it("should build subquery", () => {
      const { query, params } = ClickHouseQueryBuilder.buildSubquery(
        "SELECT user_id, COUNT(*) as order_count FROM orders GROUP BY user_id",
        {
          select: [
            "user_id",
            "order_count",
            "AVG(order_count) OVER () as avg_orders",
          ],
          where: { order_count: { operator: ">", value: 5 } },
          orderBy: [{ field: "order_count", direction: "DESC" }],
          limit: 10,
        }
      );

      expect(query).toBe(
        'SELECT user_id, order_count, AVG(order_count) OVER () as avg_orders FROM (SELECT user_id, COUNT(*) as order_count FROM orders GROUP BY user_id) WHERE "order_count" > {order_count:String} ORDER BY "order_count" DESC LIMIT 10'
      );
      expect(params).toEqual({ order_count: 5 });
    });
  });

  describe("validation", () => {
    it("should reject invalid identifiers", () => {
      expect(() => {
        ClickHouseQueryBuilder.buildSelectQuery("invalid-table", {
          select: ["id"],
        });
      }).toThrow("Invalid table name: invalid-table");
    });

    it("should reject invalid operators", () => {
      expect(() => {
        ClickHouseQueryBuilder.buildSelectQuery("users", {
          select: ["id"],
          where: { status: { operator: "INVALID_OP", value: "active" } },
        });
      }).toThrow("Invalid operator: INVALID_OP");
    });

    it("should reject complex objects in queries", () => {
      expect(() => {
        ClickHouseQueryBuilder.buildSelectQuery("users", {
          select: ["id"],
          // @ts-expect-error Testing complex object input
          where: { data: { nested: "object" } },
        });
      }).toThrow("Objects and complex types not allowed in queries");
    });

    it("should sanitize string values", () => {
      const { params } = ClickHouseQueryBuilder.buildSelectQuery("users", {
        select: ["id"],
        where: { name: "test' OR 1=1 --" },
      });

      expect(params.name).toBe("test OR 1=1 --");
    });

    it("should handle Date objects", () => {
      const date = new Date("2023-01-01T00:00:00Z");
      const { params } = ClickHouseQueryBuilder.buildSelectQuery("events", {
        select: ["id"],
        where: { timestamp: date },
      });

      expect(params.timestamp).toBe("2023-01-01T00:00:00.000Z");
    });
  });

  describe("edge cases", () => {
    it("should handle empty WHERE conditions", () => {
      const { query, params } = ClickHouseQueryBuilder.buildSelectQuery(
        "users",
        {
          select: ["id"],
          where: {},
        }
      );

      expect(query).toBe('SELECT "id" FROM "users"');
      expect(params).toEqual({});
    });

    it("should handle empty GROUP BY", () => {
      const { query } = ClickHouseQueryBuilder.buildAggregationQuery(
        "users",
        [{ field: "id", function: "COUNT" }],
        {
          groupBy: [],
        }
      );

      expect(query).toBe('SELECT COUNT("id") FROM "users"');
    });

    it("should enforce LIMIT bounds", () => {
      const { query } = ClickHouseQueryBuilder.buildSelectQuery("users", {
        select: ["id"],
        limit: 200000, // Over max
      });

      expect(query).toContain("LIMIT 100000");
    });

    it("should handle zero and negative limits", () => {
      const { query } = ClickHouseQueryBuilder.buildSelectQuery("users", {
        select: ["id"],
        limit: 0,
      });

      expect(query).toContain("LIMIT 1");
    });
  });
});
