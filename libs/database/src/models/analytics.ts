import type { Cart } from "./commerce";
import type { User } from "./user";
import type { Prisma } from "@prisma/client";
import { z } from "zod";

// Input types (moved from repositories)
export type FeatureCreateInput = Omit<
  Prisma.FeatureCreateInput,
  "id" | "createdAt" | "updatedAt"
> & {
  id?: string;
};

export type FeatureUpdateInput = Prisma.FeatureUpdateInput;

export type NotificationCreateInput = Omit<
  Prisma.NotificationCreateInput,
  "id" | "createdAt" | "readAt"
> & {
  id?: string;
  readAt?: Date;
};

export type NotificationUpdateInput = Prisma.NotificationUpdateInput;

export interface Feature {
  id: string;
  cartId: string;
  name: string;
  value: unknown;
  version: string;
  description?: string | null;
  ttl?: number | null;
  createdAt: Date;
  updatedAt: Date;
  metadata?: unknown | null;
  cart?: Cart | null;
}

export interface Notification {
  id: string;
  userId: string;
  type: string;
  message: string;
  read: boolean;
  createdAt: Date;
  readAt?: Date | null;
  metadata?: unknown | null;
  user?: User;
}

// Zod validation schemas
export const FeatureCreateInputSchema = z.object({
  id: z.string().uuid().optional(),
  cartId: z.string().uuid(),
  name: z.string().min(1).max(100),
  value: z.unknown(),
  version: z.string().min(1).max(20),
  description: z.string().max(500).nullable().optional(),
  ttl: z.number().int().positive().nullable().optional(),
  metadata: z.unknown().nullable().optional(),
});

export const FeatureUpdateInputSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  value: z.unknown().optional(),
  version: z.string().min(1).max(20).optional(),
  description: z.string().max(500).nullable().optional(),
  ttl: z.number().int().positive().nullable().optional(),
  metadata: z.unknown().optional(),
});

export const NotificationCreateInputSchema = z.object({
  id: z.string().uuid().optional(),
  userId: z.string().uuid(),
  type: z.string().min(1).max(50),
  message: z.string().min(1).max(1000),
  read: z.boolean().optional().default(false),
  readAt: z.date().nullable().optional(),
  metadata: z.unknown().nullable().optional(),
});

export const NotificationUpdateInputSchema = z.object({
  type: z.string().min(1).max(50).optional(),
  message: z.string().min(1).max(1000).optional(),
  read: z.boolean().optional(),
  readAt: z.date().nullable().optional(),
  metadata: z.unknown().optional(),
});
