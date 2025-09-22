/**
 * @fileoverview Enterprise Database Models - Type-Safe Foundation
 * @module models
 * @version 2.0.0
 * @description FIXED: Corrected Decimal types for financial precision
 */

// Prisma enums - validated against schema
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
export type CartStatus = "ACTIVE" | "ABANDONED" | "CONVERTED" | "EXPIRED";

// CRITICAL FIX: Use string for Decimal fields to preserve precision
export type PrismaDecimal = string;

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
  users: User[];
  carts: Cart[];
  products: Product[];
  sessions: UserSession[];
  recoveryEvents: RecoveryEvent[];
  webhooks: Webhook[];
  reports: Report[];
  activities: SessionActivity[];
  apiKeys: ApiKey[];
}

export interface StoreSettings {
  id: string;
  storeId: string;
  config: unknown;
  createdAt: Date;
  updatedAt: Date;
  store: Store;
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
  cart: Cart;
  store: Store;
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
  store: Store;
}

export interface SessionActivity {
  id: string;
  sessionId: string;
  storeId: string;
  activity: string;
  timestamp: Date;
  metadata?: unknown | null;
  session: UserSession;
  store: Store;
  User: User[];
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
  store: Store;
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
  childRoles: Role[];
  parentRoleIds: string[];
  childRoleIds: string[];
  users: User[];
  permissions: RolePermission[];
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
  role: Role;
}

export interface User {
  id: string;
  email: string;
  password: string;
  username: string;
  firstName?: string | null;
  lastName?: string | null;
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
  sessions: UserSession[];
  events: UserEvent[];
  carts: Cart[];
  notifications: Notification[];
  orders: Order[];
  storeId?: string | null;
  store?: Store | null;
  recoveryEvents: RecoveryEvent[];
  activities: SessionActivity[];
  apiKeys: ApiKey[];
}

export interface UserSession {
  id: string;
  userId: string;
  sessionId: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: unknown | null;
  isActive: boolean;
  endedAt?: Date | null;
  user: User;
  events: UserEvent[];
  logs: SessionLog[];
  Store: Store[];
  RecoveryEvent: RecoveryEvent[];
  SessionActivity: SessionActivity[];
}

export interface SessionLog {
  id: string;
  sessionId: string;
  event: string;
  timestamp: Date;
  metadata?: unknown | null;
  session: UserSession;
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
  user: User;
  session?: UserSession | null;
}

export interface Product {
  id: string;
  name: string;
  description?: string | null;
  price: PrismaDecimal; // FIXED: Was number, now Decimal for precision
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
  cartItems: CartItem[];
  orderItems: OrderItem[];
  Store: Store[];
}

export interface Cart {
  id: string;
  userId: string;
  status: CartStatus;
  total: PrismaDecimal; // FIXED: Was number, now Decimal for precision
  currency: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
  isDeleted: boolean;
  archived: boolean;
  metadata?: unknown | null;
  auditLog?: unknown | null;
  user: User;
  items: CartItem[];
  features: Feature[];
  orders: Order[];
  Store: Store[];
  RecoveryEvent: RecoveryEvent[];
}

export interface Order {
  id: string;
  cartId: string;
  userId: string;
  status: OrderStatus;
  total: PrismaDecimal; // FIXED: Was number, now Decimal for precision
  currency: string;
  paymentId?: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date | null;
  cancelledAt?: Date | null;
  metadata?: unknown | null;
  cart: Cart;
  user: User;
  items: OrderItem[];
  payments: Payment[];
}

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  quantity: number;
  price: PrismaDecimal; // FIXED: Was number, now Decimal for precision
  createdAt: Date;
  updatedAt: Date;
  order: Order;
  product: Product;
}

export interface Payment {
  id: string;
  orderId: string;
  amount: PrismaDecimal; // FIXED: Was number, now Decimal for precision
  currency: string;
  status: PaymentStatus;
  provider?: string | null;
  transactionId?: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date | null;
  failedAt?: Date | null;
  metadata?: unknown | null;
  order: Order;
}

export interface CartItem {
  id: string;
  cartId: string;
  productId: string;
  quantity: number;
  price: PrismaDecimal; // FIXED: Was number, now Decimal for precision
  createdAt: Date;
  metadata?: unknown | null;
  cart: Cart;
  product: Product;
}

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
  user: User;
}

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
  table: string;
  check: string;
  status: string;
  timestamp: Date;
}

export interface QualityAnomaly {
  id: string;
  type: string;
  details?: unknown | null;
  timestamp: Date;
}

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
  executionTime: number;
  details?: string | null;
  rule: ReconciliationRule;
}

export interface RepairOperation {
  id: string;
  operationId: string;
  type: string;
  status: string;
  error?: string | null;
  executedAt: Date;
}

export interface ApiKey {
  id: string;
  name: string;
  keyHash: string;
  keyIdentifier: string;
  keyPreview: string;
  userId: string;
  user: User;
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
