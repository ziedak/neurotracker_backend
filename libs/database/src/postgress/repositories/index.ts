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
export { UserRepository } from "./user";
export type { UserCreateInput, UserUpdateInput } from "../../models";
export { RoleRepository } from "./role";
export type { RoleCreateInput, RoleUpdateInput } from "../../models";
export { StoreRepository } from "./store";
export type { StoreCreateInput, StoreUpdateInput } from "../../models";
export { ProductRepository } from "./product";
export type { ProductCreateInput, ProductUpdateInput } from "../../models";
export { OrderRepository } from "./order";
export type { OrderCreateInput, OrderUpdateInput } from "../../models";
export { PaymentRepository } from "./payment";
export type { PaymentCreateInput, PaymentUpdateInput } from "../../models";
export { OrderItemRepository } from "./orderItem";
export type { OrderItemCreateInput, OrderItemUpdateInput } from "../../models";
export { ApiKeyRepository } from "./apiKey";
export type { ApiKeyCreateInput, ApiKeyUpdateInput } from "../../models";
export { CartRepository } from "./cart";
export type { CartCreateInput, CartUpdateInput } from "../../models";
export { CartItemRepository } from "./cartItem";
export type { CartItemCreateInput, CartItemUpdateInput } from "../../models";
export { ConfigRepository } from "./config";
export type { ConfigCreateInput, ConfigUpdateInput } from "../../models";
export { FeatureRepository } from "./feature";
export type { FeatureCreateInput, FeatureUpdateInput } from "../../models";
export { NotificationRepository } from "./notification";
export type {
  NotificationCreateInput,
  NotificationUpdateInput,
} from "../../models";
export { QualityAnomalyRepository } from "./qualityAnomaly";
export type {
  QualityAnomalyCreateInput,
  QualityAnomalyUpdateInput,
} from "../../models";
export { QualityValidationRepository } from "./qualityValidation";
export type {
  QualityValidationCreateInput,
  QualityValidationUpdateInput,
} from "../../models";
export { ReconciliationExecutionRepository } from "./reconciliationExecution";
export type {
  ReconciliationExecutionCreateInput,
  ReconciliationExecutionUpdateInput,
} from "../../models";
export { ReconciliationRuleRepository } from "./reconciliationRule";
export type {
  ReconciliationRuleCreateInput,
  ReconciliationRuleUpdateInput,
} from "../../models";
export { RecoveryEventRepository } from "./recoveryEvent";
export type {
  RecoveryEventCreateInput,
  RecoveryEventUpdateInput,
} from "../../models";
export { RepairOperationRepository } from "./repairOperation";
export type {
  RepairOperationCreateInput,
  RepairOperationUpdateInput,
} from "../../models";
export { ReportRepository } from "./report";
export type { ReportCreateInput, ReportUpdateInput } from "../../models";
export { RolePermissionRepository } from "./rolePermission";
export type {
  RolePermissionCreateInput,
  RolePermissionUpdateInput,
} from "../../models";
export { SessionActivityRepository } from "./sessionActivity";
export type {
  SessionActivityCreateInput,
  SessionActivityUpdateInput,
} from "../../models";
export { SessionLogRepository } from "./sessionLog";
export type {
  SessionLogCreateInput,
  SessionLogUpdateInput,
} from "../../models";
export { StoreSettingsRepository } from "./storeSettings";
export type {
  StoreSettingsCreateInput,
  StoreSettingsUpdateInput,
} from "../../models";
export { UserEventRepository } from "./userEvent";
export type { UserEventCreateInput, UserEventUpdateInput } from "../../models";
export { UserSessionRepository } from "./userSession";
export type {
  UserSessionCreateInput,
  UserSessionUpdateInput,
} from "../../models";
export { WebhookRepository } from "./webhook";
export type { WebhookCreateInput, WebhookUpdateInput } from "../../models";

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
