// TypeScript interfaces for strict typing

export interface AnalyticsOverviewQuery {
  dateFrom?: string;
  dateTo?: string;
}

export interface AnalyticsConversionQuery {
  dateFrom?: string;
  dateTo?: string;
}

export interface AnalyticsRevenueQuery {
  dateFrom?: string;
  dateTo?: string;
  aggregation?: string;
}

export interface AnalyticsPerformanceQuery {
  dateFrom?: string;
  dateTo?: string;
}

export interface FeatureStoreGetQuery {
  featureNames?: string[];
  fromCache?: boolean;
  includeExpired?: boolean;
}

export interface FeatureStoreComputeBody {
  cartId: string;
  features: Record<string, any>;
  version?: string; // Feature version
  ttl?: number; // Time-to-live in seconds
  computeRealtime?: boolean;
  description?: string;
}

export interface FeatureStoreBatchComputeBody {
  cartIds: string[];
  features?: Array<{
    name: string;
    value: any;
    version?: string;
    ttl?: number;
    description?: string;
  }>;
}

export interface FeatureDefinition {
  name: string;
  type: "number" | "string" | "boolean" | "object";
  description?: string; // <-- Already present, keep it
  version: string;
  computationLogic?: string;
  dependencies?: string[];
}
export enum EventType {
  LOGIN = "LOGIN",
  LOGOUT = "LOGOUT",
  CART_CREATED = "CART_CREATED",
  CART_UPDATED = "CART_UPDATED",
  CART_ABANDONED = "CART_ABANDONED",
  ORDER_PLACED = "ORDER_PLACED",
  ORDER_COMPLETED = "ORDER_COMPLETED",
  FEATURE_COMPUTED = "FEATURE_COMPUTED",
  EXPORT_REQUESTED = "EXPORT_REQUESTED",
  QUALITY_ALERT = "QUALITY_ALERT",
  RECONCILIATION_RUN = "RECONCILIATION_RUN",
  OTHER = "OTHER",
}

export enum UserRoleType {
  ADMIN = "ADMIN",
  ANALYST = "ANALYST",
  VIEWER = "VIEWER",
  USER = "USER",
}

export interface FeatureStoreDefinitionsQuery {
  version?: string;
}

export interface ExportEventsQuery {
  format?: "json" | "csv" | "parquet";
  limit?: number;
  offset?: number;
  cartIds?: string[];
  featureNames?: string[];
  dateFrom?: string;
  dateTo?: string;
}

export interface AuthLoginBody {
  email: string;
  password: string;
}

// Add more interfaces as needed for other endpoints
