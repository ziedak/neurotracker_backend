import { Prisma } from "../node_modules/.prisma/client";

/**
 * Secure Query Builder for type-safe database operations
 * Prevents SQL injection by using Prisma's parameterized queries
 */
export class QueryBuilder {
  /**
   * Build safe WHERE conditions with type safety
   */
  static buildWhereConditions<T extends Record<string, any>>(
    filters: Partial<T>,
    options: {
      stringFields?: (keyof T)[];
      numberFields?: (keyof T)[];
      dateFields?: (keyof T)[];
      arrayFields?: (keyof T)[];
      allowPartialMatch?: boolean;
    } = {}
  ): any {
    const conditions: any = {};
    const {
      stringFields = [],
      numberFields = [],
      dateFields = [],
      arrayFields = [],
      allowPartialMatch = false,
    } = options;

    Object.entries(filters).forEach(([key, value]) => {
      if (value === undefined || value === null) return;

      if (stringFields.includes(key as keyof T)) {
        conditions[key] = allowPartialMatch
          ? { contains: String(value), mode: "insensitive" }
          : String(value);
      } else if (numberFields.includes(key as keyof T)) {
        conditions[key] = Number(value);
      } else if (dateFields.includes(key as keyof T)) {
        conditions[key] = new Date(value);
      } else if (arrayFields.includes(key as keyof T) && Array.isArray(value)) {
        conditions[key] = { in: value };
      } else {
        conditions[key] = value;
      }
    });

    return conditions;
  }

  /**
   * Build safe date range conditions
   */
  static buildDateRange(
    field: string,
    dateFrom?: string | Date,
    dateTo?: string | Date
  ): any {
    const conditions: any = {};

    if (dateFrom || dateTo) {
      conditions[field] = {};

      if (dateFrom) {
        conditions[field].gte = new Date(dateFrom);
      }

      if (dateTo) {
        conditions[field].lte = new Date(dateTo);
      }
    }

    return conditions;
  }

  /**
   * Build safe pagination options
   */
  static buildPagination(
    page: number = 1,
    limit: number = 100,
    maxLimit: number = 10000
  ): { skip: number; take: number } {
    const safeLimit = Math.min(Math.max(1, limit), maxLimit);
    const safePage = Math.max(1, page);

    return {
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    };
  }

  /**
   * Build safe ORDER BY conditions
   */
  static buildOrderBy(
    sortField?: string,
    sortOrder: "asc" | "desc" = "desc",
    allowedFields: string[] = []
  ): any {
    if (!sortField || !allowedFields.includes(sortField)) {
      return { createdAt: "desc" }; // Default safe ordering
    }

    return { [sortField]: sortOrder };
  }

  /**
   * Sanitize string input to prevent injection attempts
   */
  static sanitizeString(input: string): string {
    if (typeof input !== "string") {
      throw new Error("Input must be a string");
    }

    // Remove potentially dangerous characters and patterns
    return input
      .replace(/['"`;\\]/g, "") // Remove quotes, semicolons, backslashes
      .replace(/--/g, "") // Remove SQL comments
      .replace(/\/\*/g, "") // Remove /* comments
      .replace(/\*\//g, "") // Remove */ comments
      .trim();
  }

  /**
   * Validate and sanitize array input
   */
  static sanitizeArray(input: any[]): any[] {
    if (!Array.isArray(input)) {
      throw new Error("Input must be an array");
    }

    return input
      .filter((item) => item !== null && item !== undefined)
      .map((item) => {
        if (typeof item === "string") {
          return this.sanitizeString(item);
        }
        return item;
      });
  }

  /**
   * Build safe aggregate conditions for Prisma
   */
  static buildAggregateWhere(
    filters: Record<string, any>,
    fieldTypes: Record<string, "string" | "number" | "date" | "boolean"> = {}
  ): any {
    const conditions: any = {};

    Object.entries(filters).forEach(([key, value]) => {
      if (value === undefined || value === null) return;

      const fieldType = fieldTypes[key];

      switch (fieldType) {
        case "string":
          conditions[key] = typeof value === "string" ? value : String(value);
          break;
        case "number":
          conditions[key] = typeof value === "number" ? value : Number(value);
          break;
        case "date":
          conditions[key] = value instanceof Date ? value : new Date(value);
          break;
        case "boolean":
          conditions[key] = Boolean(value);
          break;
        default:
          conditions[key] = value;
      }
    });

    return conditions;
  }
}

/**
 * Specialized query builders for common patterns
 */
export class FeatureQueryBuilder extends QueryBuilder {
  /**
   * Build safe feature query conditions
   */
  static buildFeatureWhere(filters: {
    cartId?: string;
    featureNames?: string[];
    dateFrom?: string;
    dateTo?: string;
    includeExpired?: boolean;
  }): Prisma.FeatureWhereInput {
    const where: Prisma.FeatureWhereInput = {};

    if (filters.cartId) {
      where.cartId = this.sanitizeString(filters.cartId);
    }

    if (filters.featureNames?.length) {
      where.name = {
        in: this.sanitizeArray(filters.featureNames),
      };
    }

    // Add date range if provided
    if (filters.dateFrom || filters.dateTo) {
      const dateConditions = this.buildDateRange(
        "updatedAt",
        filters.dateFrom,
        filters.dateTo
      );
      Object.assign(where, dateConditions);
    }

    // Include/exclude expired features
    if (filters.includeExpired === false) {
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);
      where.updatedAt = { gte: oneDayAgo };
    }

    return where;
  }
}

/**
 * Cart query builder with safe conditions
 */
export class CartQueryBuilder extends QueryBuilder {
  /**
   * Build safe cart query conditions
   */
  static buildCartWhere(filters: {
    userId?: string;
    status?: string[];
    dateFrom?: string;
    dateTo?: string;
    minTotal?: number;
    maxTotal?: number;
  }): Prisma.CartWhereInput {
    const where: Prisma.CartWhereInput = {};

    if (filters.userId) {
      where.userId = this.sanitizeString(filters.userId);
    }

    if (filters.status?.length) {
      where.status = {
        in: this.sanitizeArray(filters.status) as any[],
      };
    }

    // Date range
    if (filters.dateFrom || filters.dateTo) {
      const dateConditions = this.buildDateRange(
        "createdAt",
        filters.dateFrom,
        filters.dateTo
      );
      Object.assign(where, dateConditions);
    }

    // Total amount range
    if (filters.minTotal !== undefined || filters.maxTotal !== undefined) {
      where.total = {};
      if (filters.minTotal !== undefined) {
        where.total.gte = Number(filters.minTotal);
      }
      if (filters.maxTotal !== undefined) {
        where.total.lte = Number(filters.maxTotal);
      }
    }

    return where;
  }
}

/**
 * User event query builder for analytics
 */
export class UserEventQueryBuilder extends QueryBuilder {
  /**
   * Build safe user event query conditions
   */
  static buildUserEventWhere(filters: {
    userId?: string;
    sessionId?: string;
    eventTypes?: string[];
    dateFrom?: string;
    dateTo?: string;
    pageUrl?: string;
  }): Prisma.UserEventWhereInput {
    const where: Prisma.UserEventWhereInput = {};

    if (filters.userId) {
      where.userId = this.sanitizeString(filters.userId);
    }

    if (filters.sessionId) {
      where.sessionId = this.sanitizeString(filters.sessionId);
    }

    if (filters.eventTypes?.length) {
      where.eventType = {
        in: this.sanitizeArray(filters.eventTypes),
      };
    }

    if (filters.pageUrl) {
      where.pageUrl = {
        contains: this.sanitizeString(filters.pageUrl),
        mode: "insensitive",
      };
    }

    // Date range
    if (filters.dateFrom || filters.dateTo) {
      const dateConditions = this.buildDateRange(
        "timestamp",
        filters.dateFrom,
        filters.dateTo
      );
      Object.assign(where, dateConditions);
    }

    return where;
  }
}
