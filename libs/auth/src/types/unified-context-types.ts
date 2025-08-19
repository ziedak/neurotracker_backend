/**
 * Unified Context Types
 * Basic types for user identity and context
 */

export interface UserIdentity {
  id?: string; // Add id field
  sub: string;
  email?: string;
  name?: string;
  storeId?: string; // Add storeId field
  role?: UserRole; // Single role field for compatibility
  roles: UserRole[];
  status: UserStatus;
  metadata?: Record<string, any>;
}

export enum UserRole {
  ADMIN = "admin",
  USER = "user",
  CUSTOMER = "customer",
  MANAGER = "manager",
  SUPPORT = "support",
}

export enum UserStatus {
  ACTIVE = "active",
  INACTIVE = "inactive",
  SUSPENDED = "suspended",
  PENDING = "pending",
  LOCKED = "locked",
}
