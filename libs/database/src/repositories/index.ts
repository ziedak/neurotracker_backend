/**
 * @fileoverview Repository Index - Clean exports for all repository classes
 * @module database/repositories
 * @version 1.0.0
 * @author Enterprise Development Team
 */

// Base infrastructure
export { BaseRepository, RepositoryError } from "./base";
export type { QueryOptions, BatchResult } from "./base";

// Repository factory
export { RepositoryFactory, createRepositoryFactory } from "./factory";

// Import repository classes for type definitions
import { UserRepository } from "./user";
import { RoleRepository } from "./role";
import { StoreRepository } from "./store";
import { ProductRepository } from "./product";
import { CartRepository } from "./cart";
import { OrderRepository } from "./order";
import { PaymentRepository } from "./payment";
import { OrderItemRepository } from "./orderItem";
import { ApiKeyRepository } from "./apiKey";
import { CartItemRepository } from "./cartItem";
import { ConfigRepository } from "./config";
import { FeatureRepository } from "./feature";
import { NotificationRepository } from "./notification";
import { QualityAnomalyRepository } from "./qualityAnomaly";
import { QualityValidationRepository } from "./qualityValidation";
import { ReconciliationExecutionRepository } from "./reconciliationExecution";
import { ReconciliationRuleRepository } from "./reconciliationRule";
import { RecoveryEventRepository } from "./recoveryEvent";
import { RepairOperationRepository } from "./repairOperation";
import { ReportRepository } from "./report";
import { RolePermissionRepository } from "./rolePermission";
import { SessionActivityRepository } from "./sessionActivity";
import { SessionLogRepository } from "./sessionLog";
import { StoreSettingsRepository } from "./storeSettings";
import { UserEventRepository } from "./userEvent";
import { UserSessionRepository } from "./userSession";
import { WebhookRepository } from "./webhook";

// Individual repositories
export {
  UserRepository,
  type UserCreateInput,
  type UserUpdateInput,
} from "./user";
export {
  RoleRepository,
  type RoleCreateInput,
  type RoleUpdateInput,
} from "./role";
export {
  StoreRepository,
  type StoreCreateInput,
  type StoreUpdateInput,
} from "./store";
export {
  ProductRepository,
  type ProductCreateInput,
  type ProductUpdateInput,
} from "./product";
export {
  OrderRepository,
  type OrderCreateInput,
  type OrderUpdateInput,
} from "./order";
export {
  PaymentRepository,
  type PaymentCreateInput,
  type PaymentUpdateInput,
} from "./payment";
export {
  OrderItemRepository,
  type OrderItemCreateInput,
  type OrderItemUpdateInput,
} from "./orderItem";
export {
  ApiKeyRepository,
  type ApiKeyCreateInput,
  type ApiKeyUpdateInput,
} from "./apiKey";
export {
  CartRepository,
  type CartCreateInput,
  type CartUpdateInput,
} from "./cart";
export {
  CartItemRepository,
  type CartItemCreateInput,
  type CartItemUpdateInput,
} from "./cartItem";
export {
  ConfigRepository,
  type ConfigCreateInput,
  type ConfigUpdateInput,
} from "./config";
export {
  FeatureRepository,
  type FeatureCreateInput,
  type FeatureUpdateInput,
} from "./feature";
export {
  NotificationRepository,
  type NotificationCreateInput,
  type NotificationUpdateInput,
} from "./notification";
export {
  QualityAnomalyRepository,
  type QualityAnomalyCreateInput,
  type QualityAnomalyUpdateInput,
} from "./qualityAnomaly";
export {
  QualityValidationRepository,
  type QualityValidationCreateInput,
  type QualityValidationUpdateInput,
} from "./qualityValidation";
export {
  ReconciliationExecutionRepository,
  type ReconciliationExecutionCreateInput,
  type ReconciliationExecutionUpdateInput,
} from "./reconciliationExecution";
export {
  ReconciliationRuleRepository,
  type ReconciliationRuleCreateInput,
  type ReconciliationRuleUpdateInput,
} from "./reconciliationRule";
export {
  RecoveryEventRepository,
  type RecoveryEventCreateInput,
  type RecoveryEventUpdateInput,
} from "./recoveryEvent";
export {
  RepairOperationRepository,
  type RepairOperationCreateInput,
  type RepairOperationUpdateInput,
} from "./repairOperation";
export {
  ReportRepository,
  type ReportCreateInput,
  type ReportUpdateInput,
} from "./report";
export {
  RolePermissionRepository,
  type RolePermissionCreateInput,
  type RolePermissionUpdateInput,
} from "./rolePermission";
export {
  SessionActivityRepository,
  type SessionActivityCreateInput,
  type SessionActivityUpdateInput,
} from "./sessionActivity";
export {
  SessionLogRepository,
  type SessionLogCreateInput,
  type SessionLogUpdateInput,
} from "./sessionLog";
export {
  StoreSettingsRepository,
  type StoreSettingsCreateInput,
  type StoreSettingsUpdateInput,
} from "./storeSettings";
export {
  UserEventRepository,
  type UserEventCreateInput,
  type UserEventUpdateInput,
} from "./userEvent";
export {
  UserSessionRepository,
  type UserSessionCreateInput,
  type UserSessionUpdateInput,
} from "./userSession";
export {
  WebhookRepository,
  type WebhookCreateInput,
  type WebhookUpdateInput,
} from "./webhook";

// Repository types for dependency injection
export type RepositoryTypes = {
  user: InstanceType<typeof UserRepository>;
  role: InstanceType<typeof RoleRepository>;
  store: InstanceType<typeof StoreRepository>;
  product: InstanceType<typeof ProductRepository>;
  cart: InstanceType<typeof CartRepository>;
  order: InstanceType<typeof OrderRepository>;
  payment: InstanceType<typeof PaymentRepository>;
  orderItem: InstanceType<typeof OrderItemRepository>;
  apiKey: InstanceType<typeof ApiKeyRepository>;
  cartItem: InstanceType<typeof CartItemRepository>;
  config: InstanceType<typeof ConfigRepository>;
  feature: InstanceType<typeof FeatureRepository>;
  notification: InstanceType<typeof NotificationRepository>;
  qualityAnomaly: InstanceType<typeof QualityAnomalyRepository>;
  qualityValidation: InstanceType<typeof QualityValidationRepository>;
  reconciliationExecution: InstanceType<
    typeof ReconciliationExecutionRepository
  >;
  reconciliationRule: InstanceType<typeof ReconciliationRuleRepository>;
  recoveryEvent: InstanceType<typeof RecoveryEventRepository>;
  repairOperation: InstanceType<typeof RepairOperationRepository>;
  report: InstanceType<typeof ReportRepository>;
  rolePermission: InstanceType<typeof RolePermissionRepository>;
  sessionActivity: InstanceType<typeof SessionActivityRepository>;
  sessionLog: InstanceType<typeof SessionLogRepository>;
  storeSettings: InstanceType<typeof StoreSettingsRepository>;
  userEvent: InstanceType<typeof UserEventRepository>;
  userSession: InstanceType<typeof UserSessionRepository>;
  webhook: InstanceType<typeof WebhookRepository>;
};
