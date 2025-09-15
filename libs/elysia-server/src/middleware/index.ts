/**
 * Comprehensive Middleware System Exports
 *
 * This index file provides organized access to all middleware components:
 * - HTTP & WebSocket middleware classes
 * - Middleware chains and factories
 * - Type definitions and configurations
 * - Base classes and utilities
 */

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================
export * from "./types";

// =============================================================================
// BASE CLASSES
// =============================================================================
export * from "./base";

// =============================================================================
// MIDDLEWARE CHAINS & FACTORIES
// =============================================================================
export * from "./factories/ChainFactory";
export { HttpMiddlewareChain } from "./base/middlewareChain/httpMiddlewareChain";
export { WebSocketMiddlewareChain } from "./base/middlewareChain/WebSocketMiddlewareChain";

// =============================================================================
// HTTP MIDDLEWARE CLASSES
// =============================================================================
export { AuditHttpMiddleware } from "./audit/audit.http.middleware";
export { AuthHttpMiddleware } from "./auth/auth.http.middleware";
export { CorsHttpMiddleware } from "./cors/cors.http.middleware";
export { RateLimitHttpMiddleware } from "./rateLimit/rateLimit.http.Middleware";
export { SecurityHttpMiddleware } from "./security/security.http.middleware";
export { LoggingHttpMiddleware } from "./logging/logging.http.middleware";
export { ErrorHttpMiddleware } from "./error/error.http.middleware";
export { PrometheusHttpMiddleware } from "./prometheus/prometheus.http.middleware";

// =============================================================================
// WEBSOCKET MIDDLEWARE CLASSES
// =============================================================================
export { AuditWebSocketMiddleware } from "./audit/audit.websocket.middleware";
export { AuthWebSocketMiddleware } from "./auth/auth.websocket.middleware";
export { CorsWebSocketMiddleware } from "./cors/cors.websocket.middleware";
export { RateLimitWebSocketMiddleware } from "./rateLimit/rateLimit.websocket.middleware";
export { SecurityWebSocketMiddleware } from "./security/security.websocket.middleware";
export { LoggingWebSocketMiddleware } from "./logging/logging.websocket.middleware";
export { ErrorWebSocketMiddleware } from "./error/error.websocket.middleware";
export { PrometheusWebSocketMiddleware } from "./prometheus/prometheus.websocket.middleware";

// =============================================================================
// CONFIGURATION TYPES
// =============================================================================
export type { AuditHttpMiddlewareConfig } from "./audit/audit.http.middleware";
export type { AuthHttpMiddlewareConfig } from "./auth/auth.http.middleware";
export type { AuthWebSocketMiddlewareConfig } from "./auth/auth.websocket.middleware";
export type { CorsHttpMiddlewareConfig } from "./cors/cors.http.middleware";
export type { CorsWebSocketMiddlewareConfig } from "./cors/cors.websocket.middleware";
export type { RateLimitHttpMiddlewareConfig } from "./rateLimit/rateLimit.http.Middleware";
export type { AdvancedRateLimitWebSocketConfig } from "./rateLimit/rateLimit.websocket.middleware";
export type { SecurityHttpMiddlewareConfig } from "./security/security.http.middleware";
export type { SecurityWebSocketMiddlewareConfig } from "./security/security.websocket.middleware";
export type { LoggingHttpMiddlewareConfig } from "./logging/logging.http.middleware";
export type { LoggingWebSocketMiddlewareConfig } from "./logging/logging.websocket.middleware";
export type { ErrorHttpMiddlewareConfig } from "./error/error.http.middleware";
export type { ErrorWebSocketMiddlewareConfig } from "./error/error.websocket.middleware";
export type { PrometheusHttpMiddlewareConfig } from "./prometheus/prometheus.http.middleware";
export type { PrometheusWebSocketMiddlewareConfig } from "./prometheus/prometheus.websocket.middleware";

// =============================================================================
// ADAPTERS & UTILITIES
// =============================================================================
export { ElysiaMiddlewareAdapter } from "./adapters/ElysiaMiddlewareAdapter";
export * from "./utils";

// =============================================================================
// MODULE EXPORTS (for compatibility)
// =============================================================================
export * from "./audit";
export * from "./auth";
export * from "./cors";
export * from "./error";
export * from "./logging";
export * from "./prometheus";
export * from "./rateLimit";
export * from "./security";
