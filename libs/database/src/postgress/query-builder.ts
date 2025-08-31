import { Prisma, CartStatus } from "@prisma/client";

/**
 * Secure Query Builder for type-safe database operations
 * Prevents SQL injection by using Prisma's parameterized queries
 */
export class QueryBuilder {
  /**
   * Build safe WHERE conditions with type safety
   */
  static buildWhereConditions<T extends Record<string, unknown>>(
    filters: Partial<T>,
    options: {
      stringFields?: (keyof T)[];
      numberFields?: (keyof T)[];
      dateFields?: (keyof T)[];
      arrayFields?: (keyof T)[];
      allowPartialMatch?: boolean;
    } = {}
  ): Record<string, unknown> {
    const conditions: Record<string, unknown> = {};
    const {
      stringFields = [],
      numberFields = [],
      dateFields = [],
      arrayFields = [],
      allowPartialMatch = false,
    } = options;
    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null) continue;
      if (stringFields.includes(key as keyof T)) {
        conditions[key] = allowPartialMatch
          ? { contains: String(value), mode: "insensitive" }
          : String(value);
      } else if (numberFields.includes(key as keyof T)) {
        conditions[key] = Number(value);
      } else if (dateFields.includes(key as keyof T)) {
        conditions[key] = new Date(value as string | number | Date);
      } else if (arrayFields.includes(key as keyof T) && Array.isArray(value)) {
        conditions[key] = { in: this.sanitizeArray(value as unknown[]) };
      } else {
        conditions[key] = value;
      }
    }
    return conditions;
  }

  /**
   * Build safe date range conditions
   */
  static buildDateRange(
    field: string,
    dateFrom?: string | Date,
    dateTo?: string | Date
  ): Record<string, unknown> {
    const conditions: Record<string, unknown> = {};
    if (dateFrom || dateTo) {
      conditions[field] = {};
      if (dateFrom) {
        (conditions[field] as { gte?: Date; lte?: Date }).gte = new Date(
          dateFrom
        );
      }
      if (dateTo) {
        (conditions[field] as { gte?: Date; lte?: Date }).lte = new Date(
          dateTo
        );
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
  ): Record<string, "asc" | "desc"> {
    if (!sortField || !allowedFields.includes(sortField)) {
      return { createdAt: "desc" };
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
    return input
      .replace(/[\0\b\n\r\t\Z]/g, "")
      .replace(/['"`]/g, "")
      .trim();
  }

  /**
   * Validate and sanitize array input
   */
  static sanitizeArray(input: unknown[]): unknown[] {
    if (!Array.isArray(input)) {
      throw new Error("Input must be an array");
    }
    return input
      .filter((item) => item !== null && item !== undefined)
      .map((item) =>
        typeof item === "string" ? this.sanitizeString(item) : item
      );
  }

  /**
   * Build safe aggregate conditions for Prisma
   */
  static buildAggregateWhere(
    filters: Record<string, unknown>,
    fieldTypes: Record<string, "string" | "number" | "date" | "boolean"> = {}
  ): Record<string, unknown> {
    const conditions: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null) continue;
      const fieldType = fieldTypes[key];
      switch (fieldType) {
        case "string":
          conditions[key] = typeof value === "string" ? value : String(value);
          break;
        case "number":
          conditions[key] = typeof value === "number" ? value : Number(value);
          break;
        case "date":
          conditions[key] =
            value instanceof Date
              ? value
              : new Date(value as string | number | Date);
          break;
        case "boolean":
          conditions[key] = Boolean(value);
          break;
        default:
          conditions[key] = value;
      }
    }
    return conditions;
  }
}
/**
 
/**
 * Specialized query builder for Feature model
 */
export class FeatureQueryBuilder extends QueryBuilder {
  /**
   * Build safe feature query conditions
   */
  static buildFeatureWhere(filters: {
    cartId?: string | undefined;
    featureNames?: string[] | undefined;
    dateFrom?: string | undefined;
    dateTo?: string | undefined;
    includeExpired?: boolean | undefined;
  }): Prisma.FeatureWhereInput {
    const where: Prisma.FeatureWhereInput = {};

    if (filters.cartId) {
      where.cartId = this.sanitizeString(filters.cartId);
    }

    if (filters.featureNames?.length) {
      where.name = {
        in: this.sanitizeArray(filters.featureNames) as string[],
      };
    }

    if (filters.dateFrom || filters.dateTo) {
      Object.assign(
        where,
        this.buildDateRange("updatedAt", filters.dateFrom, filters.dateTo)
      );
    }

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
      // Use CartStatus enum for type safety
      where.status = {
        in: this.sanitizeArray(filters.status) as CartStatus[],
      };
    }

    if (filters.dateFrom || filters.dateTo) {
      Object.assign(
        where,
        this.buildDateRange("createdAt", filters.dateFrom, filters.dateTo)
      );
    }

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
        in: this.sanitizeArray(filters.eventTypes) as string[],
      };
    }

    if (filters.pageUrl) {
      where.pageUrl = {
        contains: this.sanitizeString(filters.pageUrl),
        mode: "insensitive",
      };
    }

    if (filters.dateFrom || filters.dateTo) {
      Object.assign(
        where,
        this.buildDateRange("timestamp", filters.dateFrom, filters.dateTo)
      );
    }

    return where;
  }
}
