/**
 * @fileoverview Enhanced authentication tyexport interface IEnhancedSession
  extends Omit<
    UserSession,
    "id" | "userId" | "createdAt" | "updatedAt" | "expiresAt"
  > {everaging existing Prisma models
 * @module types/enhanced
 * @version 1.0.0
 * @author Enterprise Development Team
 */

// Phase 1: Using core types with temporary database models
import type {
  EntityId,
  Timestamp,
  SecureHash,
  // TODO: Phase 2 - Enable when enhanced auth features are implemented
  // JWTToken,
  // APIKey,
  SessionId,
  // TODO: Phase 2 - Enable when enhanced context is needed
  // IAuthenticationContext,
  IAuthenticationError,
  User,
  UserSession,
  Role,
  RolePermission,
} from "./core";

/**
 * Enhanced User interface extending Prisma model with enterprise features
 */
export interface IEnhancedUser
  extends Omit<
    User,
    "id" | "createdAt" | "updatedAt" | "lastLoginAt" | "password"
  > {
  readonly id: EntityId;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly lastLoginAt: Timestamp | null;
  readonly passwordHash: SecureHash;
  readonly isActive: boolean;
  readonly isEmailVerified: boolean;
  readonly securityMetadata: IUserSecurityMetadata;
  readonly preferences: IUserPreferences;
}

/**
 * Enhanced Session interface extending Prisma model
 */
export interface IEnhancedSession
  extends Omit<
    UserSession,
    "id" | "userId" | "sessionId" | "createdAt" | "updatedAt" | "expiresAt"
  > {
  readonly id: EntityId;
  readonly userId: EntityId;
  readonly sessionId: SessionId;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly expiresAt: Timestamp;
  readonly securityContext: ISessionSecurityContext;
  readonly metrics: ISessionMetrics;
}

/**
 * Enhanced Role interface extending Prisma model
 */
export interface IEnhancedRole
  extends Omit<Role, "id" | "createdAt" | "updatedAt"> {
  readonly id: EntityId;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly computedPermissions: ReadonlyArray<IEnhancedPermission>;
  readonly hierarchy: IRoleHierarchy;
}

/**
 * Enhanced Permission interface extending Prisma model
 */
export interface IEnhancedPermission
  extends Omit<RolePermission, "id" | "roleId" | "createdAt" | "updatedAt"> {
  readonly id: EntityId;
  readonly roleId: EntityId;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly compiledConditions: IPermissionConditions;
  readonly scope: IPermissionScope;
}

/**
 * User security metadata for enhanced tracking
 */
export interface IUserSecurityMetadata {
  readonly failedLoginAttempts: number;
  readonly lastFailedLoginAt: Timestamp | null;
  readonly passwordChangedAt: Timestamp;
  readonly mfaEnabled: boolean;
  readonly mfaBackupCodes: ReadonlyArray<string>;
  readonly securityQuestions: ReadonlyArray<ISecurityQuestion>;
  readonly trustedDevices: ReadonlyArray<ITrustedDevice>;
  readonly suspiciousActivities: ReadonlyArray<ISuspiciousActivity>;
}

/**
 * User preferences for customization
 */
export interface IUserPreferences {
  readonly theme: "light" | "dark" | "auto";
  readonly language: string;
  readonly timezone: string;
  readonly notifications: INotificationPreferences;
  readonly privacy: IPrivacyPreferences;
}

/**
 * Session security context for enhanced validation
 */
export interface ISessionSecurityContext {
  readonly deviceFingerprint: string;
  readonly locationData: ILocationData;
  readonly securityFlags: ReadonlyArray<SecurityFlag>;
  readonly riskScore: number;
  readonly validationLevel: SecurityValidationLevel;
}

/**
 * Session metrics for performance tracking
 */
export interface ISessionMetrics {
  readonly requestCount: number;
  readonly dataTransferred: number;
  readonly averageResponseTime: number;
  readonly errorCount: number;
  readonly lastActivityAt: Timestamp;
}

/**
 * Role hierarchy information
 */
export interface IRoleHierarchy {
  readonly level: number;
  readonly parentRoles: ReadonlyArray<EntityId>;
  readonly childRoles: ReadonlyArray<EntityId>;
  readonly inheritedPermissions: ReadonlyArray<EntityId>;
  readonly effectivePermissions: ReadonlyArray<EntityId>;
}

/**
 * Permission conditions for dynamic authorization
 */
export interface IPermissionConditions {
  readonly timeRestrictions: ITimeRestriction | null;
  readonly ipRestrictions: ReadonlyArray<string>;
  readonly contextRequirements: ReadonlyArray<IContextRequirement>;
  readonly customRules: ReadonlyArray<ICustomRule>;
}

/**
 * Permission scope for resource access control
 */
export interface IPermissionScope {
  readonly resourceType: string;
  readonly resourceIds: ReadonlyArray<string>;
  readonly actions: ReadonlyArray<string>;
  readonly filters: ReadonlyArray<IResourceFilter>;
}

/**
 * Security question for account recovery
 */
export interface ISecurityQuestion {
  readonly id: EntityId;
  readonly question: string;
  readonly answerHash: SecureHash;
  readonly createdAt: Timestamp;
}

/**
 * Trusted device information
 */
export interface ITrustedDevice {
  readonly id: EntityId;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly deviceType: string;
  readonly fingerprint: string;
  readonly addedAt: Timestamp;
  readonly lastUsedAt: Timestamp;
}

/**
 * Suspicious activity tracking
 */
export interface ISuspiciousActivity {
  readonly id: EntityId;
  readonly activityType: string;
  readonly severity: "low" | "medium" | "high" | "critical";
  readonly description: string;
  readonly ipAddress: string;
  readonly userAgent: string;
  readonly detectedAt: Timestamp;
  readonly resolved: boolean;
}

/**
 * Notification preferences
 */
export interface INotificationPreferences {
  readonly email: boolean;
  readonly sms: boolean;
  readonly push: boolean;
  readonly securityAlerts: boolean;
  readonly marketingEmails: boolean;
}

/**
 * Privacy preferences
 */
export interface IPrivacyPreferences {
  readonly profileVisibility: "public" | "private" | "friends";
  readonly activityTracking: boolean;
  readonly analyticsConsent: boolean;
  readonly cookieConsent: boolean;
  readonly dataRetention: number; // days
}

/**
 * Location data for security validation
 */
export interface ILocationData {
  readonly country: string;
  readonly region: string;
  readonly city: string;
  readonly coordinates: ICoordinates | null;
  readonly timezone: string;
  readonly isVpn: boolean;
  readonly isTor: boolean;
}

/**
 * Geographic coordinates
 */
export interface ICoordinates {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracy: number;
}

/**
 * Security flags for session validation
 */
export enum SecurityFlag {
  SUSPICIOUS_LOCATION = "suspicious_location",
  NEW_DEVICE = "new_device",
  CONCURRENT_SESSION = "concurrent_session",
  UNUSUAL_ACTIVITY = "unusual_activity",
  BRUTE_FORCE_ATTEMPT = "brute_force_attempt",
  VPN_CONNECTION = "vpn_connection",
  TOR_CONNECTION = "tor_connection",
  HIGH_RISK_IP = "high_risk_ip",
}

/**
 * Security validation levels
 */
export enum SecurityValidationLevel {
  BASIC = "basic",
  STANDARD = "standard",
  ENHANCED = "enhanced",
  MAXIMUM = "maximum",
}

/**
 * Time restrictions for permissions
 */
export interface ITimeRestriction {
  readonly allowedHours: ReadonlyArray<number>;
  readonly allowedDays: ReadonlyArray<number>;
  readonly timezone: string;
  readonly exceptions: ReadonlyArray<ITimeException>;
}

/**
 * Time exception for special cases
 */
export interface ITimeException {
  readonly startDate: Timestamp;
  readonly endDate: Timestamp;
  readonly description: string;
  readonly overrideRestrictions: boolean;
}

/**
 * Context requirement for dynamic permissions
 */
export interface IContextRequirement {
  readonly key: string;
  readonly operator:
    | "equals"
    | "not_equals"
    | "contains"
    | "not_contains"
    | "greater"
    | "less";
  readonly value: unknown;
  readonly required: boolean;
}

/**
 * Custom rule for advanced permission logic
 */
export interface ICustomRule {
  readonly id: EntityId;
  readonly name: string;
  readonly expression: string;
  readonly priority: number;
  readonly isActive: boolean;
}

/**
 * Resource filter for scoped access
 */
export interface IResourceFilter {
  readonly field: string;
  readonly operator:
    | "equals"
    | "not_equals"
    | "in"
    | "not_in"
    | "contains"
    | "starts_with";
  readonly value: unknown;
}

/**
 * Enhanced authentication context with full feature set
 * TEMPORARILY DISABLED for Phase 1 build - will be implemented in Phase 2
 */
// export interface IEnhancedAuthenticationContext extends IAuthenticationContext {
//   readonly user: IEnhancedUser;
//   readonly session: IEnhancedSession | null;
//   readonly roles: ReadonlyArray<IEnhancedRole>;
//   readonly permissions: ReadonlyArray<IEnhancedPermission>;
//   readonly securityContext: ISessionSecurityContext;
//   readonly computedPermissions: ReadonlyArray<string>;
//   readonly accessTokens: ReadonlyArray<JWTToken>;
//   readonly refreshTokens: ReadonlyArray<JWTToken>;
//   readonly apiKeys: ReadonlyArray<APIKey>;
// }

/**
 * Batch operation result for performance operations
 */
export interface IBatchOperationResult<T> {
  readonly successful: ReadonlyArray<T>;
  readonly failed: ReadonlyArray<IBatchError>;
  readonly totalProcessed: number;
  readonly processingTime: number;
  readonly timestamp: Timestamp;
}

/**
 * Batch operation error
 */
export interface IBatchError {
  readonly id: string;
  readonly error: IAuthenticationError;
  readonly input: unknown;
}

/**
 * Cache statistics for monitoring
 */
export interface ICacheStatistics {
  readonly hitCount: number;
  readonly missCount: number;
  readonly hitRate: number;
  readonly evictionCount: number;
  readonly averageLoadTime: number;
  readonly cacheSize: number;
  readonly lastUpdated: Timestamp;
}

/**
 * Service health information
 */
export interface IServiceHealth {
  readonly service: string;
  readonly status: "healthy" | "degraded" | "unhealthy";
  readonly uptime: number;
  readonly lastCheck: Timestamp;
  readonly dependencies: ReadonlyArray<IDependencyHealth>;
  readonly metrics: Record<string, number>;
}

/**
 * Dependency health status
 */
export interface IDependencyHealth {
  readonly name: string;
  readonly status: "healthy" | "degraded" | "unhealthy";
  readonly responseTime: number;
  readonly lastCheck: Timestamp;
  readonly error: string | null;
}

/**
 * Enhanced type guards for runtime validation
 */
export const EnhancedTypeGuards = {
  isEnhancedUser: (value: unknown): value is IEnhancedUser => {
    return (
      typeof value === "object" &&
      value !== null &&
      "id" in value &&
      "email" in value &&
      "securityMetadata" in value &&
      "preferences" in value
    );
  },

  isEnhancedSession: (value: unknown): value is IEnhancedSession => {
    return (
      typeof value === "object" &&
      value !== null &&
      "id" in value &&
      "sessionId" in value &&
      "securityContext" in value &&
      "metrics" in value
    );
  },

  isEnhancedRole: (value: unknown): value is IEnhancedRole => {
    return (
      typeof value === "object" &&
      value !== null &&
      "id" in value &&
      "name" in value &&
      "computedPermissions" in value &&
      "hierarchy" in value
    );
  },

  isSecurityFlag: (value: unknown): value is SecurityFlag => {
    return Object.values(SecurityFlag).includes(value as SecurityFlag);
  },

  isValidationLevel: (value: unknown): value is SecurityValidationLevel => {
    return Object.values(SecurityValidationLevel).includes(
      value as SecurityValidationLevel
    );
  },
} as const;

/**
 * Model transformation utilities
 */
export const ModelTransformers = {
  /**
   * Transform Prisma User to Enhanced User
   */
  toEnhancedUser: (user: User): IEnhancedUser => {
    return {
      ...user,
      id: user.id as EntityId,
      createdAt: user.createdAt.toISOString() as Timestamp,
      updatedAt: user.updatedAt.toISOString() as Timestamp,
      lastLoginAt: (user.lastLoginAt?.toISOString() as Timestamp) || null,
      passwordHash: user.password as SecureHash,
      isActive: user.status === "ACTIVE",
      isEmailVerified: user.emailVerified,
      securityMetadata: {
        failedLoginAttempts: 0,
        lastFailedLoginAt: null,
        passwordChangedAt: user.updatedAt.toISOString() as Timestamp,
        mfaEnabled: false,
        mfaBackupCodes: [],
        securityQuestions: [],
        trustedDevices: [],
        suspiciousActivities: [],
      },
      preferences: {
        theme: "light",
        language: "en",
        timezone: "UTC",
        notifications: {
          email: true,
          sms: false,
          push: true,
          securityAlerts: true,
          marketingEmails: false,
        },
        privacy: {
          profileVisibility: "private",
          activityTracking: true,
          analyticsConsent: false,
          cookieConsent: false,
          dataRetention: 365,
        },
      },
    };
  },

  /**
   * Transform Prisma Session to Enhanced Session
   */
  toEnhancedSession: (session: UserSession): IEnhancedSession => {
    return {
      ...session,
      id: session.id as EntityId,
      userId: session.userId as EntityId,
      sessionId: session.sessionId as SessionId,
      createdAt: session.createdAt.toISOString() as Timestamp,
      updatedAt: session.updatedAt.toISOString() as Timestamp,
      expiresAt:
        (session.expiresAt?.toISOString() as Timestamp) ||
        (new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() as Timestamp),
      securityContext: {
        deviceFingerprint: "",
        locationData: {
          country: "",
          region: "",
          city: "",
          coordinates: null,
          timezone: "UTC",
          isVpn: false,
          isTor: false,
        },
        securityFlags: [],
        riskScore: 0,
        validationLevel: SecurityValidationLevel.BASIC,
      },
      metrics: {
        requestCount: 0,
        dataTransferred: 0,
        averageResponseTime: 0,
        errorCount: 0,
        lastActivityAt: new Date().toISOString() as Timestamp,
      },
    };
  },
} as const;

// Note: Session management interfaces are now defined in contracts/services.ts
// to avoid duplication and ensure consistent contracts across services
