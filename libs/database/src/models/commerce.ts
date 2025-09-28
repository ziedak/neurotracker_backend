import {
  DecimalType,
  ProductStatus,
  OrderStatus,
  PaymentStatus,
  CartStatus,
} from "./types";
import type { Store } from "./store";
import type { User } from "./user";
import type { Feature } from "./analytics";
import type { RecoveryEvent } from "./store";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
import { z } from "zod";

// Input types (moved from repositories)
export type ProductCreateInput = Omit<
  Prisma.ProductCreateInput,
  "id" | "createdAt" | "updatedAt" | "isDeleted"
> & {
  id?: string;
};

export type ProductUpdateInput = Prisma.ProductUpdateInput;

export type CartCreateInput = Omit<
  Prisma.CartCreateInput,
  "id" | "createdAt" | "updatedAt" | "isDeleted" | "archived" | "user"
> & {
  id?: string;
  userId: string;
};

export type CartUpdateInput = Prisma.CartUpdateInput;

export type CartItemCreateInput = Omit<
  Prisma.CartItemCreateInput,
  "id" | "createdAt" | "updatedAt"
> & {
  id?: string;
};

export type CartItemUpdateInput = Prisma.CartItemUpdateInput;

export type OrderCreateInput = Omit<
  Prisma.OrderCreateInput,
  "id" | "createdAt" | "updatedAt"
> & {
  id?: string;
};

export type OrderUpdateInput = Prisma.OrderUpdateInput;

export type OrderItemCreateInput = Omit<
  Prisma.OrderItemCreateInput,
  "id" | "createdAt" | "updatedAt"
> & {
  id?: string;
};

export type OrderItemUpdateInput = Prisma.OrderItemUpdateInput;

export type PaymentCreateInput = Omit<
  Prisma.PaymentCreateInput,
  "id" | "createdAt" | "updatedAt"
> & {
  id?: string;
};

export type PaymentUpdateInput = Prisma.PaymentUpdateInput;

export interface Product {
  id: string;
  name: string;
  description?: string | null;
  price: DecimalType;
  currency: string;
  sku?: string | null;
  imageUrl?: string | null;
  category?: string | null;
  status: ProductStatus;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
  isDeleted: boolean;
  createdBy?: string | null;
  updatedBy?: string | null;
  metadata?: unknown | null;
  cartItems?: CartItem[];
  orderItems?: OrderItem[];
  stores?: Store[];
}

export interface Cart {
  id: string;
  userId: string;
  status: CartStatus;
  total: DecimalType;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
  isDeleted: boolean;
  archived: boolean;
  metadata?: unknown | null;
  auditLog?: unknown | null;
  user?: User;
  items?: CartItem[];
  features?: Feature[];
  orders?: Order[];
  stores?: Store[];
  recoveryEvents?: RecoveryEvent[];
}

export interface Order {
  id: string;
  cartId: string;
  userId: string;
  status: OrderStatus;
  total: Decimal;
  currency: string;
  paymentId?: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date | null;
  cancelledAt?: Date | null;
  metadata?: unknown | null;
  cart?: Cart;
  user?: User;
  items?: OrderItem[];
  payments?: Payment[];
}

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  quantity: number;
  price: DecimalType;
  createdAt: Date;
  updatedAt: Date;
  order?: Order;
  product?: Product;
}

export interface Payment {
  id: string;
  orderId: string;
  amount: string;
  currency: string;
  status: PaymentStatus;
  provider?: string | null;
  transactionId?: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date | null;
  failedAt?: Date | null;
  metadata?: unknown | null;
  order?: Order;
}

export interface CartItem {
  id: string;
  cartId: string;
  productId: string;
  quantity: number;
  price: DecimalType;
  createdAt: Date;
  updatedAt: Date;
  metadata?: unknown | null;
  cart?: Cart;
  product?: Product;
}

// Re-export types for convenience
export type { ProductStatus, OrderStatus, PaymentStatus, CartStatus };

// Zod validation schemas
export const ProductCreateInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(255),
  description: z.string().max(1000).nullable().optional(),
  price: z.string().regex(/^\d+(\.\d{1,2})?$/), // Decimal as string
  currency: z.string().length(3), // ISO 4217 currency code
  sku: z.string().max(100).nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  category: z.string().max(100).nullable().optional(),
  status: z
    .enum(["ACTIVE", "INACTIVE", "ARCHIVED", "DELETED"])
    .optional()
    .default("ACTIVE"),
  deletedAt: z.date().nullable().optional(),
  isDeleted: z.boolean().optional().default(false),
  createdBy: z.string().uuid().nullable().optional(),
  updatedBy: z.string().uuid().nullable().optional(),
  metadata: z.unknown().nullable().optional(),
});

export const ProductUpdateInputSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).nullable().optional(),
  price: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .optional(),
  currency: z.string().length(3).optional(),
  sku: z.string().max(100).nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  category: z.string().max(100).nullable().optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "ARCHIVED", "DELETED"]).optional(),
  deletedAt: z.date().nullable().optional(),
  isDeleted: z.boolean().optional(),
  createdBy: z.string().uuid().nullable().optional(),
  updatedBy: z.string().uuid().nullable().optional(),
  metadata: z.unknown().optional(),
});

export const CartCreateInputSchema = z.object({
  id: z.string().uuid().optional(),
  userId: z.string().uuid(),
  status: z
    .enum(["ACTIVE", "ABANDONED", "CONVERTED", "EXPIRED"])
    .optional()
    .default("ACTIVE"),
  total: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .optional()
    .default("0.00"),
  currency: z.string().length(3).optional().default("USD"),
  deletedAt: z.date().nullable().optional(),
  isDeleted: z.boolean().optional().default(false),
  archived: z.boolean().optional().default(false),
  metadata: z.unknown().nullable().optional(),
  auditLog: z.unknown().nullable().optional(),
});

export const CartUpdateInputSchema = z.object({
  status: z.enum(["ACTIVE", "ABANDONED", "CONVERTED", "EXPIRED"]).optional(),
  total: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .optional(),
  currency: z.string().length(3).optional(),
  deletedAt: z.date().nullable().optional(),
  isDeleted: z.boolean().optional(),
  archived: z.boolean().optional(),
  metadata: z.unknown().optional(),
  auditLog: z.unknown().optional(),
});

export const CartItemCreateInputSchema = z.object({
  id: z.string().uuid().optional(),
  cartId: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
  price: z.string().regex(/^\d+(\.\d{1,2})?$/),
  metadata: z.unknown().nullable().optional(),
});

export const CartItemUpdateInputSchema = z.object({
  quantity: z.number().int().positive().optional(),
  price: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .optional(),
  metadata: z.unknown().optional(),
});

export const OrderCreateInputSchema = z.object({
  id: z.string().uuid().optional(),
  cartId: z.string().uuid(),
  userId: z.string().uuid(),
  status: z
    .enum(["PENDING", "COMPLETED", "CANCELLED", "FAILED"])
    .optional()
    .default("PENDING"),
  total: z.string().regex(/^\d+(\.\d{1,2})?$/),
  currency: z.string().length(3),
  paymentId: z.string().uuid().nullable().optional(),
  completedAt: z.date().nullable().optional(),
  cancelledAt: z.date().nullable().optional(),
  metadata: z.unknown().nullable().optional(),
});

export const OrderUpdateInputSchema = z.object({
  status: z.enum(["PENDING", "COMPLETED", "CANCELLED", "FAILED"]).optional(),
  total: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .optional(),
  currency: z.string().length(3).optional(),
  paymentId: z.string().uuid().nullable().optional(),
  completedAt: z.date().nullable().optional(),
  cancelledAt: z.date().nullable().optional(),
  metadata: z.unknown().optional(),
});

export const OrderItemCreateInputSchema = z.object({
  id: z.string().uuid().optional(),
  orderId: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
  price: z.string().regex(/^\d+(\.\d{1,2})?$/),
});

export const OrderItemUpdateInputSchema = z.object({
  quantity: z.number().int().positive().optional(),
  price: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .optional(),
});

export const PaymentCreateInputSchema = z.object({
  id: z.string().uuid().optional(),
  orderId: z.string().uuid(),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  currency: z.string().length(3),
  status: z
    .enum(["PENDING", "COMPLETED", "FAILED", "REFUNDED"])
    .optional()
    .default("PENDING"),
  provider: z.string().max(50).nullable().optional(),
  transactionId: z.string().max(255).nullable().optional(),
  completedAt: z.date().nullable().optional(),
  failedAt: z.date().nullable().optional(),
  metadata: z.unknown().nullable().optional(),
});

export const PaymentUpdateInputSchema = z.object({
  amount: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .optional(),
  currency: z.string().length(3).optional(),
  status: z.enum(["PENDING", "COMPLETED", "FAILED", "REFUNDED"]).optional(),
  provider: z.string().max(50).nullable().optional(),
  transactionId: z.string().max(255).nullable().optional(),
  completedAt: z.date().nullable().optional(),
  failedAt: z.date().nullable().optional(),
  metadata: z.unknown().optional(),
});
