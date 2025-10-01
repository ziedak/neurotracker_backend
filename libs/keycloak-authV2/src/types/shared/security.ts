/**
 * Shared security types
 *
 * Common security interfaces and types used across multiple services
 */

/**
 * Security event interface
 * Standard format for security-related events
 */
export interface SecurityEvent {
  readonly type:
    | "authentication"
    | "authorization"
    | "validation"
    | "breach"
    | "suspicious";
  readonly severity: "low" | "medium" | "high" | "critical";
  readonly source: string;
  readonly details: Record<string, any>;
  readonly timestamp: Date;
  readonly userId?: string;
  readonly sessionId?: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

/**
 * Security analysis result interface
 * Result of security analysis operations
 */
export interface SecurityAnalysis {
  readonly status: "secure" | "warning" | "breach" | "critical";
  readonly riskScore: number; // 0-100
  readonly findings: SecurityFinding[];
  readonly recommendations: string[];
  readonly analysisDate: Date;
  readonly nextReviewDate?: Date;
}

/**
 * Individual security finding
 */
export interface SecurityFinding {
  readonly type:
    | "vulnerability"
    | "misconfiguration"
    | "anomaly"
    | "policy_violation";
  readonly severity: "low" | "medium" | "high" | "critical";
  readonly description: string;
  readonly impact: string;
  readonly recommendation: string;
  readonly evidence?: Record<string, any>;
}

/**
 * Security monitoring configuration
 */
export interface SecurityMonitoringConfig {
  readonly enableThreatDetection: boolean;
  readonly suspiciousActivityThreshold: number;
  readonly auditRetentionDays: number;
  readonly alertingEnabled: boolean;
  readonly maxValidationTime: number;
  readonly constantTimeSecurity: boolean;
}

/**
 * Rate limiting configuration
 */
export interface RateLimitConfig {
  readonly windowMs: number;
  readonly maxRequests: number;
  readonly skipSuccessfulRequests: boolean;
  readonly skipFailedRequests: boolean;
  readonly keyGenerator?: (context: any) => string;
}

/**
 * Access control configuration
 */
export interface AccessControlConfig {
  readonly requireAuthentication: boolean;
  readonly allowedRoles: string[];
  readonly requiredPermissions: string[];
  readonly bypassRoutes: string[];
  readonly strictModeEnabled: boolean;
}
