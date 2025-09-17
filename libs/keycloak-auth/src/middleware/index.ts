/**
 * Keycloak Authentication Middleware
 *
 * Clean exports for HTTP and WebSocket middleware components
 */

// HTTP Middleware (fully functional)
export { KeycloakAuthHttpMiddleware } from "./keycloak-http.middleware";

// Elysia HTTP Plugin
export { keycloakAuth } from "./keycloak-elysia.plugin";

// WebSocket Middleware
export { KeycloakWebSocketMiddleware } from "./keycloak-websocket.middleware";

// WebSocket Plugin (newly restored)
export {
  keycloakWebSocket,
  KeycloakWebSocketAuthPresets,
  createKeycloakWebSocketAuthPresets,
} from "./keycloak-websocket.plugin";

// Utility functions
export {
  getWebSocketAuthContext,
  isWebSocketAuthenticated,
  getWebSocketConnectionId,
  webSocketHasRole,
  webSocketHasPermission,
  sendAuthenticatedMessage,
} from "./keycloak-websocket.plugin";

// WebSocket Examples
export {
  createBasicWebSocketExample,
  createPermissionBasedWebSocketExample,
  createDevelopmentWebSocketExample,
  createCompleteWebSocketServer,
  WEBSOCKET_USAGE_EXAMPLES,
} from "./websocket-examples";
