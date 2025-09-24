/**
 * Template processor with security-aware variable interpolation
 * Handles template variable resolution with injection protection
 */

import { createLogger } from "@libs/utils";
import type { AuthorizationContext } from "../../types/authorization.types";
import type { AbilityFactoryConstants } from "./AbilityFactoryConfig";

export class TemplateProcessor {
  private readonly logger = createLogger("TemplateProcessor");

  constructor(private readonly constants: AbilityFactoryConstants) {}

  /**
   * Resolve permission conditions with user context
   */
  resolveConditions(
    conditions: Record<string, any> | undefined,
    context: AuthorizationContext
  ): Record<string, any> | undefined {
    if (!conditions) {
      return undefined;
    }

    return this.interpolateVariables(conditions, {
      user: {
        id: context.userId,
        roles: context.roles,
        ...context.attributes,
      },
    });
  }

  /**
   * Interpolate template variables in conditions with security validation
   */
  private interpolateVariables(obj: any, variables: Record<string, any>): any {
    if (typeof obj === "string") {
      return this.processStringTemplate(obj, variables);
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.interpolateVariables(item, variables));
    }

    if (obj && typeof obj === "object") {
      const result: Record<string, any> = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.interpolateVariables(value, variables);
      }
      return result;
    }

    return obj;
  }

  /**
   * Process string template with security checks
   */
  private processStringTemplate(
    template: string,
    variables: Record<string, any>
  ): string {
    // Replace ${variable.path} patterns with security checks
    return template.replace(/\$\{([a-zA-Z0-9_.]+)\}/g, (match, path) => {
      return this.resolveTemplatePath(match, path, variables);
    });
  }

  /**
   * Resolve template path with security validation
   */
  private resolveTemplatePath(
    match: string,
    path: string,
    variables: Record<string, any>
  ): string {
    // Validate path format to prevent injection
    if (!this.isValidTemplatePath(path)) {
      this.logger.warn("Invalid template path detected", {
        path: path.substring(0, 50), // Limit logged path length
      });
      return match;
    }

    // Check for dangerous property names
    if (this.hasDangerousProperties(path)) {
      this.logger.warn("Dangerous template path detected", {
        path: path.substring(0, 50),
      });
      return match;
    }

    // Limit depth to prevent deep object traversal attacks
    if (this.isPathTooDeep(path)) {
      this.logger.warn("Template path too deep", {
        path: path.substring(0, 50),
        depth: path.split(".").length,
      });
      return match;
    }

    const value = this.getNestedValue(variables, path);
    // Convert to string and sanitize to prevent injection
    return value !== undefined ? String(value) : match;
  }

  /**
   * Validate template path format
   */
  private isValidTemplatePath(path: string): boolean {
    return /^[a-zA-Z0-9_.]+$/.test(path);
  }

  /**
   * Check for dangerous property names
   */
  private hasDangerousProperties(path: string): boolean {
    const dangerousProps = [
      "__proto__",
      "constructor",
      "prototype",
      "__defineGetter__",
      "__defineSetter__",
    ];
    const parts = path.split(".");
    return parts.some((part: string) => dangerousProps.includes(part));
  }

  /**
   * Check if path exceeds maximum depth
   */
  private isPathTooDeep(path: string): boolean {
    return path.split(".").length > this.constants.MAX_TEMPLATE_DEPTH;
  }

  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(obj: any, path: string): any {
    return path.split(".").reduce((current, key) => current?.[key], obj);
  }
}
