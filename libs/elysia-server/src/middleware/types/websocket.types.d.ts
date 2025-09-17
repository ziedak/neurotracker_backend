/**
 * WebSocket-specific middleware types and interfaces
 */
export interface WebSocketMessage {
    type: string;
    payload?: unknown;
    timestamp?: string;
    error?: string;
    code?: number;
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
/**
 * Elysia's WebSocket structure as provided in handlers
 * Reference: https://elysiajs.com/patterns/websocket.html#ws
 */
export interface ElysiaServerWebSocket {
    readonly id: string;
    data: {
        cookie: Record<string, unknown>;
        request: Request;
        [key: string]: unknown;
    };
    raw: {
        send: (data: string | ArrayBufferLike, compress?: boolean) => void;
        close: (code?: number, reason?: string) => void;
        readyState: 0 | 1 | 2 | 3;
        remoteAddress?: string;
        binaryType: "nodebuffer" | "arraybuffer" | "uint8array";
        [key: string]: unknown;
    };
    send: (data: string | ArrayBufferLike, compress?: boolean) => void;
    close: (code?: number, reason?: string) => void;
    readyState: 0 | 1 | 2 | 3;
    [key: string]: unknown;
}
/**
 * Type guard and utility for Elysia WebSocket access
 */
export interface WebSocketLike {
    send: (data: string | ArrayBufferLike) => void | Promise<void>;
    close: (code?: number, reason?: string) => void | Promise<void>;
    readyState: number;
    [key: string]: unknown;
}
/**
 * Safely cast unknown WebSocket to typed interface
 */
export declare function asWebSocket(ws: unknown): WebSocketLike;
export interface WebSocketContext {
    mockWSContext?: Buffer<ArrayBuffer>;
    ws: unknown;
    connectionId: string;
    message: WebSocketMessage;
    metadata: WebSocketConnectionMetadata;
    authenticated: boolean;
    userId?: string;
    userRoles?: string[];
    userPermissions?: string[];
    rooms?: string[];
    [key: string]: unknown;
}
export type WebSocketMiddlewareFunction = (context: WebSocketContext, next: () => Promise<void>) => Promise<void | unknown>;
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
    schemas: Record<string, unknown>;
    validatePayload?: boolean;
    validateMetadata?: boolean;
    onValidationError?: (context: WebSocketContext, error: Error) => void;
}
export interface WebSocketAuditConfig extends WebSocketMiddlewareOptions {
    logConnections?: boolean;
    logMessages?: boolean;
    logDisconnections?: boolean;
    sensitiveFields?: string[];
    auditStorage?: "database" | "file" | "external";
}
//# sourceMappingURL=websocket.types.d.ts.map