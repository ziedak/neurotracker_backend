/**
 * Type-safe validation types to replace 'any' usage
 */

// Socket/Connection types
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

// Headers types
export type HttpHeaders = Record<string, string | string[] | undefined>;
export type ValidatedHeaders = Record<string, string>;

// JSON payload types
export type JsonPrimitive = string | number | boolean | null;
export type JsonArray = JsonValue[];
export type JsonObject = { [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

// WebSocket message types
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

// Validation options
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

// Type names for validation
export type JsonTypeName =
  | "object"
  | "array"
  | "string"
  | "number"
  | "boolean"
  | "null";

// Error context types
export interface ValidationErrorContext {
  field?: string;
  value?: unknown;
  constraint?: string;
  received?: string;
  expected?: string;
}

// Metadata types
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

// Generic validation result
export interface ValidationResult<T = unknown> {
  isValid: boolean;
  data?: T;
  error?: string;
  context?: ValidationErrorContext;
}

// Logger argument types (to replace any[])
export type LoggerArgs = (
  | string
  | number
  | boolean
  | object
  | Error
  | null
  | undefined
)[];

// Generic object with unknown properties
export type UnknownRecord = Record<string, unknown>;

// Utility types for type guards
export type TypeGuard<T> = (value: unknown) => value is T;
