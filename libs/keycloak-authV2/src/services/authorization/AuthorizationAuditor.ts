/**
 * Authorization audit logger
 * Handles security audit logging and event tracking
 */

import { createLogger } from "@libs/utils";
import type { ILogger } from "@libs/utils";
import type {
  AuthorizationContext,
  Action,
  Subjects,
  ResourceContext,
  AuthorizationResult,
} from "../../types/authorization.types";

export class AuthorizationAuditor {
  private readonly logger: ILogger;

  constructor(private readonly enabled: boolean, logger?: ILogger) {
    this.logger = logger || createLogger("AuthorizationAuditor");
  }

  /**
   * Audit authorization decision
   */
  async auditAuthorizationDecision(
    context: AuthorizationContext,
    action: Action,
    subject: Subjects,
    resource: ResourceContext | undefined,
    result: AuthorizationResult
  ): Promise<void> {
    if (!this.enabled) return;

    try {
      const auditEntry = {
        timestamp: new Date().toISOString(),
        userId: context.userId,
        action,
        subject,
        resource: resource ? { type: resource.type, id: resource.id } : null,
        granted: result.granted,
        reason: result.reason,
        userRoles: context.roles,
        sessionId: context.sessionId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      };

      this.logger.info("Authorization decision", auditEntry);
    } catch (error) {
      // Audit failures should not break authorization
      this.logger.warn("Failed to audit authorization decision", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId: context.userId,
        action,
        subject,
      });
    }
  }

  /**
   * Audit permission cache operations
   */
  auditCacheOperation(
    operation: "hit" | "miss" | "set" | "clear",
    userId: string,
    details?: Record<string, any>
  ): void {
    if (!this.enabled) return;

    try {
      this.logger.info("Authorization cache operation", {
        timestamp: new Date().toISOString(),
        operation,
        userId: userId.substring(0, 8) + "***", // Partially obscured
        ...details,
      });
    } catch (error) {
      // Silent fail for audit logging
    }
  }

  /**
   * Audit security violations or suspicious activity
   */
  auditSecurityViolation(
    violation: string,
    context: AuthorizationContext,
    details?: Record<string, any>
  ): void {
    if (!this.enabled) return;

    try {
      this.logger.warn("Authorization security violation", {
        timestamp: new Date().toISOString(),
        violation,
        userId: context.userId,
        userRoles: context.roles,
        sessionId: context.sessionId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        ...details,
      });
    } catch (error) {
      // Silent fail for audit logging
    }
  }

  /**
   * Audit system errors in authorization
   */
  auditSystemError(
    error: Error,
    context: AuthorizationContext,
    operation: string
  ): void {
    if (!this.enabled) return;

    try {
      this.logger.error("Authorization system error", {
        timestamp: new Date().toISOString(),
        operation,
        error: error.message,
        stack: error.stack,
        userId: context.userId,
        userRoles: context.roles,
        sessionId: context.sessionId,
      });
    } catch (auditError) {
      // Silent fail for audit logging
    }
  }
}
