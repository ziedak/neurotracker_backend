/**
 * @deprecated This class has been split into two separate utilities:
 * - ClaimsExtractor: For extracting data from JWT claims (token layer)
 * - RoleChecker: For authorization checks (authorization module)
 *
 * Extraction methods moved to: src/services/token/ClaimsExtractor.ts
 * Authorization methods moved to: src/services/authorization/RoleChecker.ts
 *
 * This file is kept for backward compatibility but will be removed in the future.
 * Please update your imports:
 *
 * // OLD:
 * import { RolePermissionExtractor } from './RolePermissionExtractor';
 * RolePermissionExtractor.extractRolesFromJWT(claims);
 * RolePermissionExtractor.hasRole(authResult, 'admin');
 *
 * // NEW:
 * import { ClaimsExtractor } from './ClaimsExtractor';
 * import { RoleChecker } from '../authorization/RoleChecker';
 * ClaimsExtractor.extractRolesFromJWT(claims);
 * RoleChecker.hasRole(authResult, 'admin');
 */

import type { AuthResult } from "../../types";
import { ClaimsExtractor } from "./ClaimsExtractor";
import { RoleChecker } from "../authorization/RoleChecker";

/**
 * @deprecated Use ClaimsExtractor and RoleChecker instead
 * Role Permission Extractor Utility
 * Handles role and permission validation and extraction
 */
export class RolePermissionExtractor {
  /**
   * @deprecated Use RoleChecker.hasRole() instead
   * Check if a role is present in user roles
   */
  static hasRole(authResult: AuthResult, role: string): boolean {
    return RoleChecker.hasRole(authResult, role);
  }

  /**
   * @deprecated Use RoleChecker.hasAnyRole() instead
   * Check if any of the required roles are present
   */
  static hasAnyRole(authResult: AuthResult, requiredRoles: string[]): boolean {
    return RoleChecker.hasAnyRole(authResult, requiredRoles);
  }

  /**
   * @deprecated Use RoleChecker.hasAllRoles() instead
   * Check if all required roles are present
   */
  static hasAllRoles(authResult: AuthResult, requiredRoles: string[]): boolean {
    return RoleChecker.hasAllRoles(authResult, requiredRoles);
  }

  /**
   * @deprecated Use RoleChecker.hasPermission() instead
   * Check if a permission is present
   */
  static hasPermission(authResult: AuthResult, permission: string): boolean {
    return RoleChecker.hasPermission(authResult, permission);
  }

  /**
   * @deprecated Use RoleChecker.hasAnyPermission() instead
   * Check if any of the required permissions are present
   */
  static hasAnyPermission(
    authResult: AuthResult,
    requiredPermissions: string[]
  ): boolean {
    return RoleChecker.hasAnyPermission(authResult, requiredPermissions);
  }

  /**
   * @deprecated Use RoleChecker.hasAllPermissions() instead
   * Check if all required permissions are present
   */
  static hasAllPermissions(
    authResult: AuthResult,
    requiredPermissions: string[]
  ): boolean {
    return RoleChecker.hasAllPermissions(authResult, requiredPermissions);
  }

  /**
   * @deprecated Use RoleChecker.getRealmRoles() instead
   * Get all realm roles for a user
   */
  static getRealmRoles(authResult: AuthResult): string[] {
    return RoleChecker.getRealmRoles(authResult);
  }

  /**
   * @deprecated Use RoleChecker.getClientRoles() instead
   * Get all client/resource roles for a user
   */
  static getClientRoles(authResult: AuthResult): Record<string, string[]> {
    return RoleChecker.getClientRoles(authResult);
  }

  /**
   * @deprecated Use RoleChecker.getAllPermissions() instead
   * Get all permissions for a user
   */
  static getAllPermissions(authResult: AuthResult): string[] {
    return RoleChecker.getAllPermissions(authResult);
  }

  /**
   * @deprecated Use RoleChecker.isTokenExpired() instead
   * Check if token is expired based on auth result
   */
  static isTokenExpired(authResult: AuthResult): boolean {
    return RoleChecker.isTokenExpired(authResult);
  }

  /**
   * @deprecated Use RoleChecker.getTokenLifetime() instead
   * Get remaining token lifetime in seconds
   */
  static getTokenLifetime(authResult: AuthResult): number {
    return RoleChecker.getTokenLifetime(authResult);
  }

  /**
   * @deprecated Use RoleChecker.willExpireSoon() instead
   * Check if token will expire within the specified seconds
   */
  static willExpireSoon(
    authResult: AuthResult,
    withinSeconds: number
  ): boolean {
    return RoleChecker.willExpireSoon(authResult, withinSeconds);
  }

  /**
   * @deprecated Use ClaimsExtractor.extractRolesFromJWT() instead
   * Extract roles from JWT claims
   */
  static extractRolesFromJWT(claims: Record<string, unknown>): string[] {
    return ClaimsExtractor.extractRolesFromJWT(claims);
  }

  /**
   * @deprecated Use ClaimsExtractor.extractPermissionsFromJWT() instead
   * Extract permissions from JWT claims
   */
  static extractPermissionsFromJWT(claims: Record<string, unknown>): string[] {
    return ClaimsExtractor.extractPermissionsFromJWT(claims);
  }
}
