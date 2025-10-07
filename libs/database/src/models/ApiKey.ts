import { ApiKeyStatus } from "./types";
import type { User } from "./user";
import type { Store } from "./store";
import type { Prisma } from "@prisma/client";
import { z } from "zod";

// Input types (moved from repositories)
export interface ApiKeyCreateInput {
  id?: string;
  name: string;
  keyHash: string;
  keyIdentifier: string;
  keyPreview: string;
  userId: string;
  storeId?: string | null;
  permissions?: Prisma.InputJsonValue | null;
  scopes: string[];
  lastUsedAt?: Date | null;
  usageCount?: number;
  isActive?: boolean;
  expiresAt?: Date | null;
  revokedAt?: Date | null;
  revokedBy?: string | null;
  metadata?: Prisma.InputJsonValue | null;
}

export type ApiKeyUpdateInput = Prisma.ApiKeyUpdateInput;

export interface ApiKey {
  id: string;
  name: string;
  keyHash: string;
  keyIdentifier: string;
  keyPreview: string;
  userId: string;
  user?: User;
  storeId?: string | null;
  store?: Store | null;
  permissions?: unknown | null;
  scopes: string[];
  lastUsedAt?: Date | null;
  usageCount: number;
  isActive: boolean;
  expiresAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  revokedAt?: Date | null;
  revokedBy?: string | null;
  metadata?: unknown | null;
}

// Re-export types for convenience
export type { ApiKeyStatus };

// Zod validation schemas
export const ApiKeyCreateInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(100),
  keyHash: z.string().min(1),
  keyIdentifier: z.string().min(1).max(100),
  keyPreview: z.string().min(1).max(10),
  userId: z.string().uuid(),
  storeId: z.string().uuid().nullable().optional(),
  permissions: z.unknown().nullable().optional(),
  scopes: z.array(z.string()).optional().default([]),
  lastUsedAt: z.date().nullable().optional(),
  usageCount: z.number().int().min(0).optional().default(0),
  isActive: z.boolean().optional().default(true),
  expiresAt: z.date().nullable().optional(),
  revokedAt: z.date().nullable().optional(),
  revokedBy: z.string().uuid().nullable().optional(),
  metadata: z.unknown().nullable().optional(),
});

export const ApiKeyUpdateInputSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  keyHash: z.string().min(1).optional(),
  keyIdentifier: z.string().min(1).max(100).optional(),
  keyPreview: z.string().min(1).max(10).optional(),
  userId: z.string().uuid().optional(),
  storeId: z.string().uuid().nullable().optional(),
  permissions: z.unknown().optional(),
  scopes: z.array(z.string()).optional(),
  lastUsedAt: z.date().nullable().optional(),
  usageCount: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  expiresAt: z.date().nullable().optional(),
  revokedAt: z.date().nullable().optional(),
  revokedBy: z.string().uuid().nullable().optional(),
  metadata: z.unknown().optional(),
});
