/**
 * Type-safe validation types to replace 'any' usage
 */
export interface WebSocketConnection {
    send(data: string | Buffer): void;
    close(code?: number, reason?: string): void;
    readyState: number;
    remoteAddress?: string;
    [key: string]: unknown;
}
export interface HttpSocket {
    remoteAddress?: string;
    remotePort?: number;
    destroyed: boolean;
    [key: string]: unknown;
}
export type HttpHeaders = Record<string, string | string[] | undefined>;
export type ValidatedHeaders = Record<string, string>;
export type JsonPrimitive = string | number | boolean | null;
export type JsonArray = JsonValue[];
export type JsonObject = {
    [key: string]: JsonValue;
};
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface WebSocketMessage {
    type: string;
    payload?: JsonValue;
    id?: string;
    timestamp?: number;
    [key: string]: unknown;
}
export interface ValidatedWebSocketMessage {
    type: string;
    payload?: JsonValue;
    id?: string;
}
export interface JsonValidationOptions {
    maxSizeBytes?: number;
    maxDepth?: number;
    allowedTypes?: JsonTypeName[];
}
export interface WebSocketValidationOptions {
    maxMessageSize?: number;
    maxDepth?: number;
    requireId?: boolean;
}
export type JsonTypeName = "object" | "array" | "string" | "number" | "boolean" | "null";
export interface ValidationErrorContext {
    field?: string;
    value?: unknown;
    constraint?: string;
    received?: string;
    expected?: string;
}
export interface ConnectionMetadata {
    userAgent?: string;
    ip?: string;
    userId?: string;
    sessionId?: string;
    permissions?: string[];
    createdAt?: number;
    lastActivity?: number;
    [key: string]: JsonValue | undefined;
}
export interface ValidationResult<T = unknown> {
    isValid: boolean;
    data?: T;
    error?: string;
    context?: ValidationErrorContext;
}
export type LoggerArgs = (string | number | boolean | object | Error | null | undefined)[];
export type UnknownRecord = Record<string, unknown>;
export type TypeGuard<T> = (value: unknown) => value is T;
//# sourceMappingURL=validation.types.d.ts.map