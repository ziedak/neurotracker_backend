/**
 * CORS Middleware Module
 * Exports both HTTP and WebSocket CORS middleware implementations
 */

// HTTP CORS Middleware
export {
  CorsMiddleware,
  createCorsMiddleware,
  CORS_PRESETS,
  type CorsMiddlewareConfig,
} from "./cors.middleware";

// WebSocket CORS Middleware
export {
  WebSocketCorsMiddleware,
  createWebSocketCorsMiddleware,
  WEBSOCKET_CORS_PRESETS,
  type WebSocketCorsMiddlewareConfig,
  type WebSocketCorsContext,
} from "./cors.websocket.middleware";
