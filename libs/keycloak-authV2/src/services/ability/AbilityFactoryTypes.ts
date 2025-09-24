/**
 * Data structures for ability factory operations
 */

import type { AppAbility, Role } from "../../types/authorization.types";

/**
 * Cached ability data structure
 */
export interface CachedAbility {
  rules: any[];
  timestamp: number;
  userId: string;
  roles: Role[];
}

/**
 * Pending computation tracking structure
 */
export interface PendingComputation {
  promise: Promise<AppAbility>;
  timestamp: number;
  timeout: NodeJS.Timeout;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  enabled: boolean;
  hasCacheService: boolean;
  pendingComputations: number;
  serviceStats?: any;
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  status: "healthy" | "degraded" | "unhealthy";
  details: any;
}
