/**
 * Authorization system type definitions
 *
 * Defines types for role-based access control (RBAC) and
 * attribute-based access control (ABAC) using CASL.
 */

import type { AbilityBuilder, PureAbility } from "@casl/ability";
import type { Action, Role, Subjects } from "../../types/authorization.types";

/**
 * Application-specific ability type combining actions and subjects
 */
export type AppAbility = PureAbility<[Action, Subjects]>;

/**
 * Ability factory configuration
 */
export interface AbilityFactoryConfig {
  enableCaching?: boolean;
  cacheTimeout?: number;
  defaultRole?: Role;
  strictMode?: boolean;
  auditEnabled?: boolean;
}

/**
 * CASL ability builder type helper
 */
export type AppAbilityBuilder = AbilityBuilder<AppAbility>;
