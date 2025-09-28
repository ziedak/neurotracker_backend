import { DecimalType } from "./types";
import type { Prisma } from "@prisma/client";
import { z } from "zod";

// Input types (moved from repositories)
export type ConfigCreateInput = Omit<
  Prisma.ConfigCreateInput,
  "id" | "createdAt" | "updatedAt"
> & {
  id?: string;
};

export type ConfigUpdateInput = Prisma.ConfigUpdateInput;

export type QualityValidationCreateInput = Omit<
  Prisma.QualityValidationCreateInput,
  "id" | "executedAt"
> & {
  id?: string;
  executedAt?: Date;
};

export type QualityValidationUpdateInput = Prisma.QualityValidationUpdateInput;

export type ReconciliationRuleCreateInput = Omit<
  Prisma.ReconciliationRuleCreateInput,
  "id" | "createdAt"
> & {
  id?: string;
};

export type ReconciliationRuleUpdateInput =
  Prisma.ReconciliationRuleUpdateInput;

export type ReconciliationExecutionCreateInput = Omit<
  Prisma.ReconciliationExecutionCreateInput,
  "id" | "executedAt"
> & {
  id?: string;
  executedAt?: Date;
};

export type ReconciliationExecutionUpdateInput =
  Prisma.ReconciliationExecutionUpdateInput;

export type ReportCreateInput = Omit<
  Prisma.ReportCreateInput,
  "id" | "createdAt" | "updatedAt" | "generatedAt"
> & {
  id?: string;
};

export type ReportUpdateInput = Prisma.ReportUpdateInput;

export interface Config {
  id: string;
  key: string;
  value: unknown;
  createdAt: Date;
  updatedAt: Date;
  description?: string | null;
}

export interface QualityValidation {
  id: string;
  tableName: string;
  checkType: string;
  checkName: string;
  status: string;
  severity: string;
  details?: unknown | null;
  affectedRows: number;
  executedAt: Date;
  executionTime?: DecimalType | null;
}

export interface QualityAnomaly {
  id: string;
  type: string;
  details?: unknown | null;
  timestamp: Date;
}

// Input types (moved from repositories)
export type QualityAnomalyCreateInput = Omit<
  Prisma.QualityAnomalyCreateInput,
  "id" | "timestamp"
> & {
  id?: string;
  timestamp?: Date;
};

export type QualityAnomalyUpdateInput = Prisma.QualityAnomalyUpdateInput;

export interface ReconciliationRule {
  id: string;
  name: string;
  sourceTable: string;
  targetTable: string;
  joinKey: string;
  enabled: boolean;
  sourceColumns?: string | null;
  targetColumns?: string | null;
  tolerance?: number | null;
  createdAt: Date;
  executions: ReconciliationExecution[];
}

export interface ReconciliationExecution {
  id: string;
  ruleId: string;
  status: string;
  recordsChecked: number;
  discrepancies: number;
  executedAt: Date;
  executionTime: DecimalType;
  details?: unknown | null;
  errorMessage?: string | null;
  rule?: ReconciliationRule;
}

export interface RepairOperation {
  id: string;
  operationId: string;
  type: string;
  status: string;
  error?: string | null;
  executedAt: Date;
}

// Input types (moved from repositories)
export type RepairOperationCreateInput = Omit<
  Prisma.RepairOperationCreateInput,
  "id" | "executedAt"
> & {
  id?: string;
  executedAt?: Date;
};

export type RepairOperationUpdateInput = Prisma.RepairOperationUpdateInput;

// Zod validation schemas
export const ConfigCreateInputSchema = z.object({
  id: z.string().uuid().optional(),
  key: z.string().min(1).max(255),
  value: z.unknown(),
  description: z.string().max(500).nullable().optional(),
});

export const ConfigUpdateInputSchema = z.object({
  key: z.string().min(1).max(255).optional(),
  value: z.unknown().optional(),
  description: z.string().max(500).nullable().optional(),
});

export const QualityValidationCreateInputSchema = z.object({
  id: z.string().uuid().optional(),
  tableName: z.string().min(1).max(100),
  checkType: z.string().min(1).max(50),
  checkName: z.string().min(1).max(100),
  status: z.string().min(1).max(20),
  severity: z.string().min(1).max(20),
  details: z.unknown().nullable().optional(),
  affectedRows: z.number().int().min(0).optional().default(0),
  executedAt: z
    .date()
    .optional()
    .default(() => new Date()),
  executionTime: z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/)
    .nullable()
    .optional(),
});

export const QualityValidationUpdateInputSchema = z.object({
  tableName: z.string().min(1).max(100).optional(),
  checkType: z.string().min(1).max(50).optional(),
  checkName: z.string().min(1).max(100).optional(),
  status: z.string().min(1).max(20).optional(),
  severity: z.string().min(1).max(20).optional(),
  details: z.unknown().optional(),
  affectedRows: z.number().int().min(0).optional(),
  executedAt: z.date().optional(),
  executionTime: z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/)
    .nullable()
    .optional(),
});

export const QualityAnomalyCreateInputSchema = z.object({
  id: z.string().uuid().optional(),
  type: z.string().min(1).max(50),
  details: z.unknown().nullable().optional(),
  timestamp: z
    .date()
    .optional()
    .default(() => new Date()),
});

export const QualityAnomalyUpdateInputSchema = z.object({
  type: z.string().min(1).max(50).optional(),
  details: z.unknown().optional(),
  timestamp: z.date().optional(),
});

export const ReconciliationRuleCreateInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(100),
  sourceTable: z.string().min(1).max(100),
  targetTable: z.string().min(1).max(100),
  joinKey: z.string().min(1).max(100),
  enabled: z.boolean().optional().default(true),
  sourceColumns: z.string().nullable().optional(),
  targetColumns: z.string().nullable().optional(),
  tolerance: z.number().min(0).optional(),
});

export const ReconciliationRuleUpdateInputSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  sourceTable: z.string().min(1).max(100).optional(),
  targetTable: z.string().min(1).max(100).optional(),
  joinKey: z.string().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  sourceColumns: z.string().nullable().optional(),
  targetColumns: z.string().nullable().optional(),
  tolerance: z.number().min(0).optional(),
});

export const ReconciliationExecutionCreateInputSchema = z.object({
  id: z.string().uuid().optional(),
  ruleId: z.string().uuid(),
  status: z.string().min(1).max(20),
  recordsChecked: z.number().int().min(0).optional().default(0),
  discrepancies: z.number().int().min(0).optional().default(0),
  executedAt: z
    .date()
    .optional()
    .default(() => new Date()),
  executionTime: z.string().regex(/^\d+(\.\d{1,6})?$/),
  details: z.unknown().nullable().optional(),
  errorMessage: z.string().max(1000).nullable().optional(),
});

export const ReconciliationExecutionUpdateInputSchema = z.object({
  status: z.string().min(1).max(20).optional(),
  recordsChecked: z.number().int().min(0).optional(),
  discrepancies: z.number().int().min(0).optional(),
  executedAt: z.date().optional(),
  executionTime: z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/)
    .optional(),
  details: z.unknown().optional(),
  errorMessage: z.string().max(1000).nullable().optional(),
});

export const ReportCreateInputSchema = z.object({
  id: z.string().uuid().optional(),
  storeId: z.string().uuid(),
  type: z.string().min(1).max(50),
  status: z
    .enum(["PENDING", "PROCESSING", "READY", "FAILED"])
    .optional()
    .default("PENDING"),
  data: z.unknown().nullable().optional(),
  url: z.string().url().nullable().optional(),
  generatedAt: z.date().nullable().optional(),
  error: z.string().max(1000).nullable().optional(),
});

export const ReportUpdateInputSchema = z.object({
  type: z.string().min(1).max(50).optional(),
  status: z.enum(["PENDING", "PROCESSING", "READY", "FAILED"]).optional(),
  data: z.unknown().optional(),
  url: z.string().url().nullable().optional(),
  generatedAt: z.date().nullable().optional(),
  error: z.string().max(1000).nullable().optional(),
});

export const RepairOperationCreateInputSchema = z.object({
  id: z.string().uuid().optional(),
  operationId: z.string().min(1).max(100),
  type: z.string().min(1).max(50),
  status: z.string().min(1).max(20),
  error: z.string().max(1000).nullable().optional(),
  executedAt: z
    .date()
    .optional()
    .default(() => new Date()),
});

export const RepairOperationUpdateInputSchema = z.object({
  operationId: z.string().min(1).max(100).optional(),
  type: z.string().min(1).max(50).optional(),
  status: z.string().min(1).max(20).optional(),
  error: z.string().max(1000).nullable().optional(),
  executedAt: z.date().optional(),
});
