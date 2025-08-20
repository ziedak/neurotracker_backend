type StoreStatus = "ACTIVE" | "SUSPENDED" | "DELETED";

type EventType = "LOGIN" | "LOGOUT" | "CART_CREATED" | "CART_UPDATED" | "CART_ABANDONED" | "ORDER_PLACED" | "ORDER_COMPLETED" | "FEATURE_COMPUTED" | "EXPORT_REQUESTED" | "QUALITY_ALERT" | "RECONCILIATION_RUN" | "OTHER";

type UserRoleType = "ADMIN" | "ANALYST" | "VIEWER" | "USER";

type RecoveryStatus = "PENDING" | "SUCCESS" | "FAILED" | "IGNORED";

type ReportStatus = "PENDING" | "PROCESSING" | "READY" | "FAILED";

type UserStatus = "ACTIVE" | "BANNED" | "INACTIVE" | "DELETED";

type ProductStatus = "ACTIVE" | "INACTIVE" | "ARCHIVED" | "DELETED";

type OrderStatus = "PENDING" | "COMPLETED" | "CANCELLED" | "FAILED";

type PaymentStatus = "PENDING" | "COMPLETED" | "FAILED" | "REFUNDED";

type CartStatus = "ACTIVE" | "ABANDONED" | "CONVERTED" | "EXPIRED";

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
}

export interface StoreSettings {
  id: string;
  storeId: string;
  config: any;
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
  metadata?: any | null;
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
  data?: any | null;
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
  metadata?: any | null;
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
  metadata?: any | null;
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
  metadata?: any | null;
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
  conditions?: any | null;
  metadata?: any | null;
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
  auditLog?: any | null;
  roleId?: string | null;
  role?: Role | null;
  roleAssignedAt?: Date | null;
  roleRevokedAt?: Date | null;
  roleAssignedBy?: string | null;
  roleRevokedBy?: string | null;
  roleExpiresAt?: Date | null;
  metadata?: any | null;
  sessions: UserSession[];
  events: UserEvent[];
  carts: Cart[];
  notifications: Notification[];
  orders: Order[];
  storeId?: string | null;
  store?: Store | null;
  recoveryEvents: RecoveryEvent[];
  activities: SessionActivity[];
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
  metadata?: any | null;
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
  metadata?: any | null;
  session: UserSession;
}

export interface UserEvent {
  id: string;
  userId: string;
  sessionId?: string | null;
  eventType: string;
  timestamp: Date;
  metadata?: any | null;
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
  price: number;
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
  metadata?: any | null;
  cartItems: CartItem[];
  orderItems: OrderItem[];
  Store: Store[];
}

export interface Cart {
  id: string;
  userId: string;
  status: CartStatus;
  total: number;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
  isDeleted: boolean;
  archived: boolean;
  metadata?: any | null;
  auditLog?: any | null;
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
  total: number;
  currency: string;
  paymentId?: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date | null;
  cancelledAt?: Date | null;
  metadata?: any | null;
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
  price: number;
  createdAt: Date;
  updatedAt: Date;
  order: Order;
  product: Product;
}

export interface Payment {
  id: string;
  orderId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  provider?: string | null;
  transactionId?: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date | null;
  failedAt?: Date | null;
  metadata?: any | null;
  order: Order;
}

export interface CartItem {
  id: string;
  cartId: string;
  productId: string;
  quantity: number;
  price: number;
  createdAt: Date;
  updatedAt: Date;
  metadata?: any | null;
  cart: Cart;
  product: Product;
}

export interface Feature {
  id: string;
  cartId: string;
  name: string;
  value: any;
  version: string;
  description?: string | null;
  ttl?: number | null;
  createdAt: Date;
  updatedAt: Date;
  metadata?: any | null;
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
  metadata?: any | null;
  user: User;
}

export interface Config {
  id: string;
  key: string;
  value: any;
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
  details?: any | null;
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

