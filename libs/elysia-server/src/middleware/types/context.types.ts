/**
 * Common context interface for middleware
 * Abstracts framework-specific context (Elysia, Express, etc.)
 */
export interface MiddlewareContext {
  requestId?: string;
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: unknown;
    query?: Record<string, unknown>;
    params?: Record<string, unknown>;
    ip?: string;
  };
  response?: {
    status?: number;
    headers?: Record<string, string>;
    body?: unknown;
  };
  set: {
    status?: number | undefined;
    headers: Record<string, string>;
  };
  user?: {
    id?: string;
    roles?: string[];
    permissions?: string[];
    authenticated?: boolean;
    anonymous?: boolean;
    [key: string]: unknown;
  };
  session?: {
    id?: string;
    [key: string]: unknown;
  };
  validated?: {
    body?: unknown;
    query?: unknown;
    params?: unknown;
  };
  path?: string;
  [key: string]: unknown;
}

/**
 * Request metadata for audit and logging
 */
export interface RequestMetadata {
  requestId: string;
  timestamp: Date;
  duration?: number;
  clientIp: string;
  userAgent: string;
  userId?: string;
  sessionId?: string;
}

/**
 * Response metadata for audit and logging
 */
export interface ResponseMetadata {
  statusCode: number;
  responseSize?: number;
  error?: string;
  success: boolean;
}
