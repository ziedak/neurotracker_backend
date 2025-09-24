/**
 * Resource sanitization for authorization operations
 * Handles prototype pollution prevention and secure metadata cleaning
 */

import { createLogger } from "@libs/utils";

export class ResourceSanitizer {
  private readonly logger = createLogger("ResourceSanitizer");

  /**
   * Securely sanitize resource metadata to prevent prototype pollution
   */
  sanitizeMetadata(obj: any, depth = 0): any {
    // Prevent deep recursion attacks
    if (depth > 10) return null;
    if (obj === null || obj === undefined) return null;
    if (typeof obj !== "object") return obj;
    if (Array.isArray(obj))
      return obj.map((item) => this.sanitizeMetadata(item, depth + 1));

    const clean: any = {};
    for (const [key, value] of Object.entries(obj)) {
      // CRITICAL: Block all prototype pollution vectors
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        continue;
      }
      // Prevent other dangerous keys
      if (key.startsWith("__") || key.includes("prototype")) {
        continue;
      }
      clean[key] = this.sanitizeMetadata(value, depth + 1);
    }
    return clean;
  }

  /**
   * Validate and sanitize resource context
   */
  sanitizeResourceContext(resource: any): any {
    if (!resource || typeof resource !== "object") {
      return null;
    }

    try {
      return {
        // Only allow specific safe properties with proper sanitization
        type: typeof resource.type === "string" ? resource.type : undefined,
        id: typeof resource.id === "string" ? resource.id : undefined,
        ownerId:
          typeof resource.ownerId === "string" ? resource.ownerId : undefined,
        organizationId:
          typeof resource.organizationId === "string"
            ? resource.organizationId
            : undefined,
        metadata: resource.metadata
          ? this.sanitizeMetadata(resource.metadata)
          : undefined,
      };
    } catch (error) {
      this.logger.warn("Failed to sanitize resource context", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return null;
    }
  }
}
