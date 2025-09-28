import { Decimal } from "@prisma/client/runtime/library";
import * as Prisma from "@prisma/client";

export type DecimalType = Decimal;

// Common status and type enums
export type StoreStatus = "ACTIVE" | "SUSPENDED" | "DELETED";

export type EventType =
  | "LOGIN"
  | "LOGOUT"
  | "CART_CREATED"
  | "CART_UPDATED"
  | "CART_ABANDONED"
  | "ORDER_PLACED"
  | "ORDER_COMPLETED"
  | "FEATURE_COMPUTED"
  | "EXPORT_REQUESTED"
  | "QUALITY_ALERT"
  | "RECONCILIATION_RUN"
  | "OTHER";

export type UserRoleType = "ADMIN" | "ANALYST" | "VIEWER" | "USER";

export type RecoveryStatus = "PENDING" | "SUCCESS" | "FAILED" | "IGNORED";

export type ReportStatus = "PENDING" | "PROCESSING" | "READY" | "FAILED";

export type UserStatus = "ACTIVE" | "BANNED" | "INACTIVE" | "DELETED";

export type ProductStatus = "ACTIVE" | "INACTIVE" | "ARCHIVED" | "DELETED";

export type OrderStatus = "PENDING" | "COMPLETED" | "CANCELLED" | "FAILED";

export type PaymentStatus = "PENDING" | "COMPLETED" | "FAILED" | "REFUNDED";

export type ApiKeyStatus = "ACTIVE" | "REVOKED" | "EXPIRED";

export type CartStatus = "ACTIVE" | "ABANDONED" | "CONVERTED" | "EXPIRED";

export { Prisma };
