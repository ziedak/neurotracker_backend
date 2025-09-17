/**
 * @fileoverview Centralized utility functions for middleware operations
 * @description Common utility functions used across middleware classes for validation,
 * sanitization, ID generation, and data processing
 */
import type { HttpMiddlewareConfig } from "../base";
import { MiddlewareContext } from "../types";
/**
 * Configuration validation result
 */
export interface ValidationResult {
    isValid: boolean;
    errors: string[];
}
/**
 * Validate middleware configuration
 * @param config - Configuration object to validate
 * @param type - Middleware type ('http' or 'websocket')
 * @returns ValidationResult with errors if any
 */
export declare function validateMiddlewareConfig(config: HttpMiddlewareConfig, _type: "http" | "websocket"): ValidationResult;
/**
 * Sanitize sensitive data by redacting specified fields
 * @param data - Data to sanitize
 * @param sensitiveFields - Array of field names to redact
 * @returns Sanitized data
 */
export declare function sanitizeData(data: unknown, sensitiveFields: string[]): unknown;
/**
 * Generate a unique request ID
 * @returns Unique request identifier
 */
export declare function generateRequestId(): string;
/**
 * Safely parse JSON string
 * @param jsonString - JSON string to parse
 * @returns Parsed object or error indicator
 */
export declare function parseJsonSafely(jsonString: string | null | undefined): unknown;
/**
 * Extract client IP address from request headers
 * @param headers - Request headers
 * @returns Client IP address or undefined
 */
export declare function getClientIP(headers: Record<string, string>): string | undefined;
/**
 * Validate if a path is properly formatted
 * @param path - Path to validate
 * @returns True if path is valid
 */
export declare function isValidPath(path: string): boolean;
export declare function matchPathPattern(pattern: string, path: string): boolean;
/**
 * Calculate request/response size
 * @param data - Data to measure
 * @returns Size in bytes
 */
export declare function calculateRequestSize(data: unknown): number;
/**
 * Format log message with context
 * @param message - Base message
 * @param context - Additional context data
 * @returns Formatted message
 */
export declare function formatLogMessage(message: string, context?: Record<string, unknown>): string;
/**
 * Middleware chain for managing multiple middleware functions
 */
export declare class MiddlewareChain {
    private middlewares;
    /**
     * Add middleware to chain
     */
    add(name: string, middleware: (context: MiddlewareContext, next: () => Promise<void>) => Promise<void>, priority?: number): void;
    /**
     * Remove middleware from chain
     */
    remove(name: string): boolean;
    /**
     * Enable/disable middleware
     */
    toggle(name: string, enabled: boolean): boolean;
    /**
     * Get all middlewares
     */
    getMiddlewares(): Array<{
        name: string;
        priority: number;
        enabled: boolean;
    }>;
    /**
     * Execute middleware chain
     */
    execute(context: MiddlewareContext): Promise<void>;
}
/**
 * Create middleware chain
 * @param middlewares - Array of middleware configurations
 * @returns MiddlewareChain instance
 */
export declare function createMiddlewareChain(middlewares: Array<{
    name: string;
    middleware: (context: MiddlewareContext, next: () => Promise<void>) => Promise<void>;
    priority?: number;
    enabled?: boolean;
}>): MiddlewareChain;
//# sourceMappingURL=middleware.utils.d.ts.map