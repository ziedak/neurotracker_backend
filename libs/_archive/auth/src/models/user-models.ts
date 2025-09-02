/**
 * @fileoverview User Data Models - Supporting Step 4.1
 * Comprehensive user data structures for enterprise user management
 *
 * Features:
 * - User entity with comprehensive fields
 * - User status enumeration
 * - Create/Update DTOs
 * - Security profile interfaces
 * - Type safety and validation support
 *
 * @version 2.3.0
 * @author Enterprise Auth Foundation
 */

import { Role } from "./permission-models";

/**
 * User Status Enumeration
 */
export enum UserStatus {
  ACTIVE = "active",
  INACTIVE = "inactive",
  LOCKED = "locked",
  PENDING_VERIFICATION = "pending_verification",
  SUSPENDED = "suspended",
  DELETED = "deleted",
}

/**
 * Core User Entity - Phase 3A Architecture with Role Tracking
 */
export interface User {
  id: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  status: UserStatus;
  emailVerified: boolean;
  phoneVerified: boolean;
  phone?: string;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
  loginCount: number;
  role: Role; // Single role per Phase 3A architecture

  // Role assignment tracking for security audit
  roleAssignedAt: Date | null;
  roleRevokedAt: Date | null; // null means role is active
  roleAssignedBy: string | null; // User ID who assigned the role
  roleRevokedBy: string | null; // User ID who revoked the role
  roleExpiresAt: Date | null; // Optional role expiration

  metadata: Record<string, any>;
}

/**
 * Create User Data Transfer Object - Phase 3A Architecture
 */
export interface CreateUserData {
  email: string;
  password: string;
  username: string;
  firstName: string;
  lastName: string;
  phone?: string;
  role?: string; // Role ID for assignment - will be resolved to Role object
  metadata?: Record<string, any>;
}

/**
 * Update User Data Transfer Object - Phase 3A Architecture with Role Tracking
 */
export interface UpdateUserData {
  email?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  status?: UserStatus;
  emailVerified?: boolean;
  phoneVerified?: boolean;
  lastLoginAt?: Date;
  loginCount?: number;
  role?: string; // Role ID for assignment - will be resolved to Role object

  // Role assignment tracking fields
  roleAssignedAt?: Date;
  roleRevokedAt?: Date;
  roleAssignedBy?: string;
  roleRevokedBy?: string;
  roleExpiresAt?: Date;

  metadata?: Record<string, any>;
}

/**
 * User Security Profile
 */
export interface UserSecurityProfile {
  userId: string;
  twoFactorEnabled: boolean;
  lastPasswordChange: Date;
  failedLoginAttempts: number;
  accountLocked: boolean;
  lockReason?: string;
  passwordExpiryDate?: Date | null;
  securityQuestions: string[];
  trustedDevices: string[];
  loginNotifications: boolean;
  apiKeysCount: number;
  activeSessions: number;
  lastSecurityAudit: Date | null;
}

/**
 * User Login History Entry
 */
export interface UserLoginHistory {
  id: string;
  userId: string;
  timestamp: Date;
  ipAddress: string;
  userAgent: string;
  location?: string;
  success: boolean;
  failureReason?: string;
}

/**
 * User Activity Summary
 */
export interface UserActivitySummary {
  userId: string;
  period: string;
  totalLogins: number;
  lastLogin: Date | null;
  averageLoginsPerDay: number;
  sessionsCreated: number;
  apiCallsCount: number;
  dataAccessCount: number;
  securityEvents: number;
}
