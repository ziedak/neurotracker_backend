/**
 * WebSocket-specific middleware types and interfaces
 */

export interface WebSocketMessage {
  type: string;
  payload?: any;
  timestamp?: string;
  id?: string;
}

export interface WebSocketConnectionMetadata {
  connectedAt: Date;
  lastActivity: Date;
  messageCount: number;
  clientIp: string;
  userAgent?: string;
  headers: Record<string, string>;
  query: Record<string, string>;
}

export interface WebSocketContext {
  ws: any; // WebSocket instance
  connectionId: string;
  message: WebSocketMessage;
  metadata: WebSocketConnectionMetadata;
  authenticated: boolean;
  userId?: string;
  userRoles?: string[];
  userPermissions?: string[];
  rooms?: string[];
  [key: string]: any;
}

export type WebSocketMiddlewareFunction = (
  context: WebSocketContext,
  next: () => Promise<void>
) => Promise<void | any>;

export interface WebSocketMiddlewareOptions {
  name: string;
  enabled?: boolean;
  priority?: number;
  skipMessageTypes?: string[];
}

export interface WebSocketAuthConfig extends WebSocketMiddlewareOptions {
  requireAuth?: boolean;
  skipAuthenticationForTypes?: string[];
  closeOnAuthFailure?: boolean;
  jwtSecret: string;
  apiKeyHeader?: string;
  roles?: string[];
  permissions?: string[];
  messagePermissions?: Record<string, string[]>;
  messageRoles?: Record<string, string[]>;
}

export interface WebSocketRateLimitConfig extends WebSocketMiddlewareOptions {
  maxConnections?: number;
  maxMessagesPerMinute?: number;
  maxMessagesPerHour?: number;
  keyGenerator?: (context: WebSocketContext) => string;
  onLimitExceeded?: (context: WebSocketContext, limit: string) => void;
}

export interface WebSocketValidationConfig extends WebSocketMiddlewareOptions {
  schemas: Record<string, any>; // Message type -> Joi/Zod schema
  validatePayload?: boolean;
  validateMetadata?: boolean;
  onValidationError?: (context: WebSocketContext, error: any) => void;
}

export interface WebSocketAuditConfig extends WebSocketMiddlewareOptions {
  logConnections?: boolean;
  logMessages?: boolean;
  logDisconnections?: boolean;
  sensitiveFields?: string[];
  auditStorage?: "database" | "file" | "external";
}
