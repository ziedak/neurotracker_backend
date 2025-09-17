/**
 * Production-grade input validation utilities
 */
import { HttpHeaders, ValidatedHeaders, JsonValue, JsonValidationOptions, WebSocketMessage, ValidatedWebSocketMessage } from "../types/validation.types";
export declare class InputValidator {
    /**
     * Validate authentication token
     */
    static validateToken(token: string | undefined): string;
    /**
     * Validate URL
     */
    static validateUrl(url: string | undefined, allowedProtocols?: string[]): string;
    /**
     * Validate HTTP headers
     */
    static validateHeaders(headers: HttpHeaders): ValidatedHeaders;
    /**
     * Validate JSON payload
     */
    static validateJsonPayload(payload: unknown, options?: JsonValidationOptions): JsonValue;
    /**
     * Validate WebSocket message
     */
    static validateWebSocketMessage(message: WebSocketMessage): ValidatedWebSocketMessage;
    /**
     * Validate IP address
     */
    static validateIpAddress(ip: string | undefined): string;
    /**
     * Sanitize string input
     */
    static sanitizeString(input: string | undefined, options?: {
        maxLength?: number;
        allowedChars?: RegExp;
        trimWhitespace?: boolean;
        removeHtml?: boolean;
    }): string;
    /**
     * Get object depth for validation
     */
    private static getObjectDepth;
    /**
     * Check if value is of allowed type
     */
    private static isValidType;
}
/**
 * Pre-configured validators for common use cases
 */
export declare const CommonValidators: {
    /**
     * Strict API validation
     */
    api: {
        validateToken: (token: string | undefined) => string;
        validateHeaders: (headers: HttpHeaders) => ValidatedHeaders;
        validatePayload: (payload: unknown) => JsonValue;
    };
    /**
     * WebSocket message validation
     */
    websocket: {
        validateMessage: (message: WebSocketMessage) => ValidatedWebSocketMessage;
        validatePayload: (payload: unknown) => JsonValue;
    };
    /**
     * Basic string validation
     */
    string: {
        username: (input: string | undefined) => string;
        email: (input: string | undefined) => string;
        roomName: (input: string | undefined) => string;
    };
};
//# sourceMappingURL=InputValidator.d.ts.map