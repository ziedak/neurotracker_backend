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
    body?: any;
    query?: Record<string, any>;
    params?: Record<string, any>;
    ip?: string;
  };
  response?: {
    status?: number;
    headers?: Record<string, string>;
    body?: any;
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
    [key: string]: any;
  };
  session?: {
    id?: string;
    [key: string]: any;
  };
  validated?: {
    body?: any;
    query?: any;
    params?: any;
  };
  path?: string;
  [key: string]: any;
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
