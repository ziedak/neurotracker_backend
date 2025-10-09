import { UserStatus } from "./types";
import type { Store, RecoveryEvent, SessionActivity } from "./store";
import type { Cart, Order } from "./commerce";
import type { ApiKey } from "./ApiKey";
import type { Prisma } from "@prisma/client";
import { z } from "zod";

// Input types (moved from repository)
export type UserCreateInput = Omit<
  Prisma.UserCreateInput,
  "id" | "createdAt" | "updatedAt" | "loginCount"
> & {
  id?: string;
};

export type UserUpdateInput = Prisma.UserUpdateInput;

export interface UserFilters {
  status?: UserStatus;
  emailVerified?: boolean;
  phoneVerified?: boolean;
  roleId?: string;
  storeId?: string;
  organizationId?: string;
  isDeleted?: boolean;
  createdAfter?: Date;
  createdBefore?: Date;
  lastLoginAfter?: Date;
  lastLoginBefore?: Date;
}

export interface Role {
  id: string;
  name: string;
  displayName: string;
  description?: string | null;
  category: string;
  level: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  version: string;
  metadata?: unknown | null;
  parentRoleId?: string | null;
  parentRole?: Role | null;
  childRoles?: Role[];
  parentRoleIds: string[];
  childRoleIds: string[];
  users?: User[];
  permissions?: RolePermission[];
}

export interface RolePermission {
  id: string;
  roleId: string;
  resource: string;
  action: string;
  name: string;
  description?: string | null;
  conditions?: unknown | null;
  metadata?: unknown | null;
  priority: string;
  version: string;
  createdAt: Date;
  updatedAt: Date;
  role?: Role;
}

export interface User {
  id: string;
  keycloakId?: string | null;
  email: string;
  password: string;
  username: string;
  firstName?: string | null;
  lastName?: string | null;
  image?: string | null;
  phone?: string | null;
  status: UserStatus;
  emailVerified: boolean;
  phoneVerified: boolean;
  lastLoginAt?: Date | null;
  loginCount: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
  isDeleted: boolean;
  createdBy?: string | null;
  updatedBy?: string | null;
  organizationId?: string | null;
  auditLog?: unknown | null;
  roleId?: string | null;
  role?: Role | null;
  roleAssignedAt?: Date | null;
  roleRevokedAt?: Date | null;
  roleAssignedBy?: string | null;
  roleRevokedBy?: string | null;
  roleExpiresAt?: Date | null;
  metadata?: unknown | null;
  sessions?: UserSession[];
  events?: UserEvent[];
  carts?: Cart[];
  notifications?: Notification[];
  orders?: Order[];
  storeId?: string | null;
  store?: Store | null;
  recoveryEvents?: RecoveryEvent[];
  activities?: SessionActivity[];
  apiKeys?: ApiKey[];
}

export interface UserSession {
  id: string;
  userId: string;
  keycloakSessionId?: string | null;
  accessToken?: string | null;
  refreshToken?: string | null;
  idToken?: string | null;
  tokenExpiresAt?: Date | null;
  refreshExpiresAt?: Date | null;
  fingerprint?: string | null;
  lastAccessedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: unknown | null;
  isActive: boolean;
  endedAt?: Date | null;
  user?: User;
  events?: UserEvent[];
  logs?: SessionLog[];
  recoveryEvents?: RecoveryEvent[];
  activities?: SessionActivity[];
}

export interface SessionLog {
  id: string;
  sessionId: string;
  event: string;
  timestamp: Date;
  metadata?: unknown | null;
  session?: UserSession;
}

export interface UserEvent {
  id: string;
  userId: string;
  sessionId?: string | null;
  eventType: string;
  timestamp: Date;
  metadata?: unknown | null;
  pageUrl?: string | null;
  userAgent?: string | null;
  ipAddress?: string | null;
  isError: boolean;
  errorMsg?: string | null;
  user?: User;
  session?: UserSession | null;
}

// Input types (moved from repositories)
export type RoleCreateInput = Omit<
  Prisma.RoleCreateInput,
  "id" | "createdAt" | "updatedAt"
> & {
  id?: string;
};

export type RoleUpdateInput = Prisma.RoleUpdateInput;

export type RolePermissionCreateInput = Omit<
  Prisma.RolePermissionCreateInput,
  "id" | "createdAt" | "updatedAt"
> & {
  id?: string;
};

export type RolePermissionUpdateInput = Prisma.RolePermissionUpdateInput;

export type UserSessionCreateInput = Omit<
  Prisma.UserSessionCreateInput,
  "id" | "createdAt" | "updatedAt"
> & {
  id?: string;
};

export type UserSessionUpdateInput = Prisma.UserSessionUpdateInput;

export type SessionLogCreateInput = Omit<
  Prisma.SessionLogCreateInput,
  "id" | "timestamp"
> & {
  id?: string;
  timestamp?: Date;
};

export type SessionLogUpdateInput = Prisma.SessionLogUpdateInput;

export type UserEventCreateInput = Omit<
  Prisma.UserEventCreateInput,
  "id" | "timestamp"
> & {
  id?: string;
  timestamp?: Date;
};

export type UserEventUpdateInput = Prisma.UserEventUpdateInput;

// Zod validation schemas
export const UserCreateInputSchema = z.object({
  id: z.string().uuid().optional(),
  keycloakId: z.string().max(255).optional().nullable(),
  email: z.string().email(),
  password: z.string().min(8),
  username: z.string().min(3).max(50),
  firstName: z.string().min(1).max(50).optional().nullable(),
  lastName: z.string().min(1).max(50).optional().nullable(),
  image: z.string().url().optional().nullable(),
  phone: z
    .string()
    .regex(/^\+?[1-9]\d{1,14}$/)
    .optional()
    .nullable(),
  status: z
    .enum(["ACTIVE", "BANNED", "INACTIVE", "DELETED", "PENDING"])
    .optional()
    .default("PENDING"),
  emailVerified: z.boolean().optional().default(false),
  phoneVerified: z.boolean().optional().default(false),
  lastLoginAt: z.date().optional().nullable(),
  loginCount: z.number().int().min(0).optional().default(0),
  deletedAt: z.date().optional().nullable(),
  isDeleted: z.boolean().optional().default(false),
  createdBy: z.string().uuid().optional().nullable(),
  updatedBy: z.string().uuid().optional().nullable(),
  organizationId: z.string().uuid().optional().nullable(),
  auditLog: z.unknown().optional().nullable(),
  roleId: z.string().uuid().optional().nullable(),
  roleAssignedAt: z.date().optional().nullable(),
  roleRevokedAt: z.date().optional().nullable(),
  roleAssignedBy: z.string().uuid().optional().nullable(),
  roleRevokedBy: z.string().uuid().optional().nullable(),
  roleExpiresAt: z.date().optional().nullable(),
  metadata: z.unknown().optional().nullable(),
  storeId: z.string().uuid().optional().nullable(),
});

export const UserUpdateInputSchema = z.object({
  keycloakId: z.string().max(255).nullable().optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  username: z.string().min(3).max(50).optional(),
  firstName: z.string().min(1).max(50).nullable().optional(),
  lastName: z.string().min(1).max(50).nullable().optional(),
  image: z.string().url().nullable().optional(),
  phone: z
    .string()
    .regex(/^\+?[1-9]\d{1,14}$/)
    .nullable()
    .optional(),
  status: z.enum(["ACTIVE", "BANNED", "INACTIVE", "DELETED"]).optional(),
  emailVerified: z.boolean().optional(),
  phoneVerified: z.boolean().optional(),
  lastLoginAt: z.date().nullable().optional(),
  loginCount: z.number().int().min(0).optional(),
  deletedAt: z.date().nullable().optional(),
  isDeleted: z.boolean().optional(),
  createdBy: z.string().uuid().nullable().optional(),
  updatedBy: z.string().uuid().nullable().optional(),
  organizationId: z.string().uuid().nullable().optional(),
  auditLog: z.unknown().optional(),
  roleId: z.string().uuid().nullable().optional(),
  roleAssignedAt: z.date().nullable().optional(),
  roleRevokedAt: z.date().nullable().optional(),
  roleAssignedBy: z.string().uuid().nullable().optional(),
  roleRevokedBy: z.string().uuid().nullable().optional(),
  roleExpiresAt: z.date().nullable().optional(),
  metadata: z.unknown().optional(),
  storeId: z.string().uuid().nullable().optional(),
});

export const RoleCreateInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(50),
  displayName: z.string().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  category: z.string().min(1).max(50),
  level: z.number().int().min(0),
  isActive: z.boolean().optional().default(true),
  version: z.string().min(1).max(20),
  metadata: z.unknown().nullable().optional(),
  parentRoleId: z.string().uuid().nullable().optional(),
});

export const RoleUpdateInputSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  displayName: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  category: z.string().min(1).max(50).optional(),
  level: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  version: z.string().min(1).max(20).optional(),
  metadata: z.unknown().optional(),
  parentRoleId: z.string().uuid().nullable().optional(),
});

export const RolePermissionCreateInputSchema = z.object({
  id: z.string().uuid().optional(),
  roleId: z.string().uuid(),
  resource: z.string().min(1).max(100),
  action: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  conditions: z.unknown().nullable().optional(),
  metadata: z.unknown().nullable().optional(),
  priority: z.string().min(1).max(20),
  version: z.string().min(1).max(20),
});

export const RolePermissionUpdateInputSchema = z.object({
  roleId: z.string().uuid().optional(),
  resource: z.string().min(1).max(100).optional(),
  action: z.string().min(1).max(50).optional(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  conditions: z.unknown().optional(),
  metadata: z.unknown().optional(),
  priority: z.string().min(1).max(20).optional(),
  version: z.string().min(1).max(20).optional(),
});

export const UserSessionCreateInputSchema = z.object({
  id: z.string().uuid().optional(),
  userId: z.string().uuid(),
  keycloakSessionId: z.string().max(255).nullable().optional(),
  accessToken: z.string().nullable().optional(),
  refreshToken: z.string().nullable().optional(),
  idToken: z.string().nullable().optional(),
  tokenExpiresAt: z.date().nullable().optional(),
  refreshExpiresAt: z.date().nullable().optional(),
  fingerprint: z.string().max(255).nullable().optional(),
  lastAccessedAt: z
    .date()
    .optional()
    .default(() => new Date()),
  expiresAt: z.date().nullable().optional(),
  ipAddress: z.string().max(45).nullable().optional(),
  userAgent: z.string().max(500).nullable().optional(),
  metadata: z.unknown().nullable().optional(),
  isActive: z.boolean().optional().default(true),
  endedAt: z.date().nullable().optional(),
});

export const UserSessionUpdateInputSchema = z.object({
  keycloakSessionId: z.string().max(255).nullable().optional(),
  accessToken: z.string().nullable().optional(),
  refreshToken: z.string().nullable().optional(),
  idToken: z.string().nullable().optional(),
  tokenExpiresAt: z.date().nullable().optional(),
  refreshExpiresAt: z.date().nullable().optional(),
  fingerprint: z.string().max(255).nullable().optional(),
  lastAccessedAt: z.date().optional(),
  expiresAt: z.date().nullable().optional(),
  ipAddress: z.string().max(45).nullable().optional(),
  userAgent: z.string().max(500).nullable().optional(),
  metadata: z.unknown().optional(),
  isActive: z.boolean().optional(),
  endedAt: z.date().nullable().optional(),
});

export const SessionLogCreateInputSchema = z.object({
  id: z.string().uuid().optional(),
  sessionId: z.string().uuid(),
  event: z.string().min(1).max(100),
  timestamp: z
    .date()
    .optional()
    .default(() => new Date()),
  metadata: z.unknown().nullable().optional(),
});

export const SessionLogUpdateInputSchema = z.object({
  event: z.string().min(1).max(100).optional(),
  timestamp: z.date().optional(),
  metadata: z.unknown().optional(),
});

export const UserEventCreateInputSchema = z.object({
  id: z.string().uuid().optional(),
  userId: z.string().uuid(),
  sessionId: z.string().uuid().nullable().optional(),
  eventType: z.string().min(1).max(100),
  timestamp: z
    .date()
    .optional()
    .default(() => new Date()),
  metadata: z.unknown().nullable().optional(),
  pageUrl: z.string().url().nullable().optional(),
  userAgent: z.string().max(500).nullable().optional(),
  ipAddress: z.string().max(45).nullable().optional(),
  isError: z.boolean().optional().default(false),
  errorMsg: z.string().max(1000).nullable().optional(),
});

export const UserEventUpdateInputSchema = z.object({
  sessionId: z.string().uuid().nullable().optional(),
  eventType: z.string().min(1).max(100).optional(),
  timestamp: z.date().optional(),
  metadata: z.unknown().optional(),
  pageUrl: z.string().url().nullable().optional(),
  userAgent: z.string().max(500).nullable().optional(),
  ipAddress: z.string().max(45).nullable().optional(),
  isError: z.boolean().optional(),
  errorMsg: z.string().max(1000).nullable().optional(),
});
