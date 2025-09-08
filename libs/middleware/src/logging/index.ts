/**
 * Logging Middleware Module Exports
 *
 * This module provides comprehensive request/response and WebSocket logging capabilities
 * with configurable security controls and performance optimization.
 *
 * @module LoggingMiddleware
 */

// HTTP Logging Middleware
export {
  LoggingMiddleware,
  createLoggingMiddleware,
  LOGGING_PRESETS,
  type LoggingConfig,
  type RequestLogData,
  type ResponseLogData,
} from "./logging.middleware";

// WebSocket Logging Middleware
export {
  WebSocketLoggingMiddleware,
  createWebSocketLoggingMiddleware,
  WEBSOCKET_LOGGING_PRESETS,
  type WebSocketLoggingConfig,
  type WebSocketConnectionLogData,
  type WebSocketMessageLogData,
} from "./websocket.logging.middleware";

export { LoggingMiddleware as default } from "./logging.middleware";
