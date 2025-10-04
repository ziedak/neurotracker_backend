import { StoreStatus, RecoveryStatus, ReportStatus } from "./types";
import type { User, UserSession } from "./user";
import type { Cart, Product } from "./commerce";
import type { ApiKey } from "./ApiKey";
import type { Prisma } from "@prisma/client";
import { z } from "zod";

// Input types (moved from repository)
export type StoreCreateInput = Omit<
  Prisma.StoreCreateInput,
  "id" | "createdAt" | "updatedAt" | "isDeleted"
> & {
  id?: string;
};

export type StoreUpdateInput = Prisma.StoreUpdateInput;

export interface Store {
  id: string;
  name: string;
  url: string;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
  isDeleted: boolean;
  status: StoreStatus;
  settings?: StoreSettings | null;
  users?: User[];
  carts?: Cart[];
  products?: Product[];
  sessions?: UserSession[];
  recoveryEvents?: RecoveryEvent[];
  webhooks?: Webhook[];
  reports?: Report[];
  activities?: SessionActivity[];
  apiKeys?: ApiKey[];
}

export interface StoreSettings {
  id: string;
  storeId: string;
  config: unknown;
  createdAt: Date;
  updatedAt: Date;
  store?: Store;
}

export interface RecoveryEvent {
  id: string;
  cartId: string;
  storeId: string;
  userId?: string | null;
  sessionId?: string | null;
  eventType: string;
  status: RecoveryStatus;
  outcome?: string | null;
  metadata?: unknown | null;
  createdAt: Date;
  updatedAt: Date;
  cart?: Cart;
  store?: Store;
  user?: User | null;
  session?: UserSession | null;
}

export interface Report {
  id: string;
  storeId: string;
  type: string;
  status: ReportStatus;
  data?: unknown | null;
  url?: string | null;
  generatedAt?: Date | null;
  error?: string | null;
  createdAt: Date;
  updatedAt: Date;
  store?: Store;
}

export interface SessionActivity {
  id: string;
  sessionId: string;
  storeId: string;
  userId: string;
  activity: string;
  timestamp: Date;
  metadata?: unknown | null;
  session?: UserSession;
  store?: Store;
  user?: User;
}

export interface Webhook {
  id: string;
  storeId: string;
  url: string;
  eventType: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastTriggered?: Date | null;
  metadata?: unknown | null;
  store?: Store;
}

// Input types (moved from repositories)
export type RecoveryEventCreateInput = Omit<
  Prisma.RecoveryEventCreateInput,
  "id" | "createdAt" | "updatedAt"
> & {
  id?: string;
};

export type RecoveryEventUpdateInput = Prisma.RecoveryEventUpdateInput;

export type SessionActivityCreateInput = Omit<
  Prisma.SessionActivityCreateInput,
  "id" | "timestamp"
> & {
  id?: string;
};

export type SessionActivityUpdateInput = Prisma.SessionActivityUpdateInput;

export type StoreSettingsCreateInput = Omit<
  Prisma.StoreSettingsCreateInput,
  "id" | "createdAt" | "updatedAt"
> & {
  id?: string;
};

export type StoreSettingsUpdateInput = Prisma.StoreSettingsUpdateInput;

export type WebhookCreateInput = Omit<
  Prisma.WebhookCreateInput,
  "id" | "createdAt" | "updatedAt"
> & {
  id?: string;
};

export type WebhookUpdateInput = Prisma.WebhookUpdateInput;

// Zod validation schemas
export const StoreCreateInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(100),
  url: z.string().url(),
  ownerId: z.string().uuid(),
  deletedAt: z.date().nullable().optional(),
  isDeleted: z.boolean().optional().default(false),
  status: z
    .enum(["ACTIVE", "SUSPENDED", "DELETED"])
    .optional()
    .default("ACTIVE"),
});

export const StoreUpdateInputSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  url: z.string().url().optional(),
  ownerId: z.string().uuid().optional(),
  deletedAt: z.date().nullable().optional(),
  isDeleted: z.boolean().optional(),
  status: z.enum(["ACTIVE", "SUSPENDED", "DELETED"]).optional(),
});

export const RecoveryEventCreateInputSchema = z.object({
  id: z.string().uuid().optional(),
  cartId: z.string().uuid(),
  storeId: z.string().uuid(),
  userId: z.string().uuid().nullable().optional(),
  sessionId: z.string().uuid().nullable().optional(),
  eventType: z.string().min(1).max(50),
  status: z
    .enum(["PENDING", "SUCCESS", "FAILED", "IGNORED"])
    .optional()
    .default("PENDING"),
  outcome: z.string().max(255).nullable().optional(),
  metadata: z.unknown().nullable().optional(),
});

export const RecoveryEventUpdateInputSchema = z.object({
  userId: z.string().uuid().nullable().optional(),
  sessionId: z.string().uuid().nullable().optional(),
  eventType: z.string().min(1).max(50).optional(),
  status: z.enum(["PENDING", "SUCCESS", "FAILED", "IGNORED"]).optional(),
  outcome: z.string().max(255).nullable().optional(),
  metadata: z.unknown().optional(),
});

export const SessionActivityCreateInputSchema = z.object({
  id: z.string().uuid().optional(),
  sessionId: z.string().uuid(),
  storeId: z.string().uuid(),
  userId: z.string().uuid(),
  activity: z.string().min(1).max(100),
  timestamp: z
    .date()
    .optional()
    .default(() => new Date()),
  metadata: z.unknown().nullable().optional(),
});

export const SessionActivityUpdateInputSchema = z.object({
  activity: z.string().min(1).max(100).optional(),
  timestamp: z.date().optional(),
  metadata: z.unknown().optional(),
});

export const StoreSettingsCreateInputSchema = z.object({
  id: z.string().uuid().optional(),
  storeId: z.string().uuid(),
  config: z.unknown(),
});

export const StoreSettingsUpdateInputSchema = z.object({
  storeId: z.string().uuid().optional(),
  config: z.unknown().optional(),
});

export const WebhookCreateInputSchema = z.object({
  id: z.string().uuid().optional(),
  storeId: z.string().uuid(),
  url: z.string().url(),
  eventType: z.string().min(1).max(50),
  isActive: z.boolean().optional().default(true),
  lastTriggered: z.date().nullable().optional(),
  metadata: z.unknown().nullable().optional(),
});

export const WebhookUpdateInputSchema = z.object({
  storeId: z.string().uuid().optional(),
  url: z.string().url().optional(),
  eventType: z.string().min(1).max(50).optional(),
  isActive: z.boolean().optional(),
  lastTriggered: z.date().nullable().optional(),
  metadata: z.unknown().optional(),
});
