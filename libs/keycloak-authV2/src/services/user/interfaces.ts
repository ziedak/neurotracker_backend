/**
 * User Management Interfaces
 * Following Interface Segregation Principle (ISP)
 */

import type { UserInfo } from "../../types";

// Domain Models
export interface KeycloakUser {
  id?: string | undefined;
  username: string;
  email?: string | undefined;
  firstName?: string | undefined;
  lastName?: string | undefined;
  enabled?: boolean | undefined;
  emailVerified?: boolean | undefined;
  createdTimestamp?: number | undefined;
  attributes?: Record<string, string[]> | undefined;
  credentials?: KeycloakCredential[] | undefined;
  realmRoles?: string[] | undefined;
  clientRoles?: Record<string, string[]> | undefined;
}

export interface KeycloakCredential {
  type: string;
  value: string;
  temporary?: boolean;
}

export interface KeycloakRole {
  id?: string;
  name: string;
  description?: string;
  composite?: boolean;
  clientRole?: boolean;
  containerId?: string;
}

// Operation Options
export interface UserSearchOptions {
  username?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  search?: string;
  exact?: boolean;
  max?: number;
  first?: number;
}

export interface CreateUserOptions {
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  password?: string;
  temporaryPassword?: boolean;
  enabled?: boolean;
  emailVerified?: boolean;
  attributes?: Record<string, string[]>;
  realmRoles?: string[];
  clientRoles?: Record<string, string[]>;
}

export interface UpdateUserOptions {
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled?: boolean;
  emailVerified?: boolean;
  attributes?: Record<string, string[]>;
}

export interface ResetPasswordOptions {
  password: string;
  temporary?: boolean;
}

// Component Interfaces (ISP - Interface Segregation)

/**
 * Client credentials token provider interface
 * Replaces IAdminTokenManager with more robust implementation
 */
export interface IClientCredentialsTokenProvider {
  getValidToken(): Promise<string>;
  invalidateToken(): Promise<void>;
}

/**
 * @deprecated Use IClientCredentialsTokenProvider instead
 * Kept for backward compatibility
 */
export interface IAdminTokenManager extends IClientCredentialsTokenProvider {}

/**
 * Low-level Keycloak API client interface
 */
export interface IKeycloakApiClient {
  searchUsers(options: UserSearchOptions): Promise<KeycloakUser[]>;
  getUserById(userId: string): Promise<KeycloakUser | null>;
  createUser(user: KeycloakUser): Promise<string>;
  updateUser(userId: string, updates: UpdateUserOptions): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  resetPassword(userId: string, credential: KeycloakCredential): Promise<void>;
  getUserRealmRoles(userId: string): Promise<KeycloakRole[]>;
  assignRealmRoles(userId: string, roles: KeycloakRole[]): Promise<void>;
  removeRealmRoles(userId: string, roles: KeycloakRole[]): Promise<void>;
  assignClientRoles(
    userId: string,
    clientId: string,
    roles: KeycloakRole[]
  ): Promise<void>;
  getRealmRoles(): Promise<KeycloakRole[]>;
  getClientRoles(clientId: string): Promise<KeycloakRole[]>;
  getClientInternalId(clientId: string): Promise<string>;
}

/**
 * User repository interface
 */
export interface IUserRepository {
  searchUsers(options: UserSearchOptions): Promise<KeycloakUser[]>;
  getUserById(userId: string): Promise<KeycloakUser | null>;
  getUserByUsername(username: string): Promise<KeycloakUser | null>;
  createUser(options: CreateUserOptions): Promise<string>;
  updateUser(userId: string, options: UpdateUserOptions): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  resetPassword(userId: string, options: ResetPasswordOptions): Promise<void>;
}

/**
 * Role management interface
 */
export interface IRoleManager {
  getUserRealmRoles(userId: string): Promise<KeycloakRole[]>;
  assignRealmRoles(userId: string, roleNames: string[]): Promise<void>;
  removeRealmRoles(userId: string, roleNames: string[]): Promise<void>;
  assignClientRoles(
    userId: string,
    clientId: string,
    roleNames: string[]
  ): Promise<void>;
}

/**
 * User info conversion interface
 */
export interface IUserInfoConverter {
  convertToUserInfo(
    keycloakUser: KeycloakUser,
    roles?: string[],
    permissions?: string[]
  ): UserInfo;
}

/**
 * High-level user service interface (Facade)
 */
export interface IUserService {
  searchUsers(options: UserSearchOptions): Promise<KeycloakUser[]>;
  getUserById(userId: string): Promise<KeycloakUser | null>;
  getUserByUsername(username: string): Promise<KeycloakUser | null>;
  createUser(options: CreateUserOptions): Promise<string>;
  updateUser(userId: string, options: UpdateUserOptions): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  resetPassword(userId: string, options: ResetPasswordOptions): Promise<void>;
  getCompleteUserInfo(userId: string): Promise<UserInfo | null>;
  assignRealmRoles(userId: string, roleNames: string[]): Promise<void>;
  removeRealmRoles(userId: string, roleNames: string[]): Promise<void>;
  assignClientRoles(
    userId: string,
    clientId: string,
    roleNames: string[]
  ): Promise<void>;
}
