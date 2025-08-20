/**
 * Unified Context Types
 * Basic types for user identity and context
 */

export interface UserIdentity {
  id: string; // Required id field
  email?: string;
  name?: string; // Optional name field
  storeId?: string; // Optional storeId field
  role?: UserRole; // Optional single role field for compatibility
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
