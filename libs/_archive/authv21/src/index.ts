/**
 * AuthV2 Library - Production-ready authentication for ElysiaJS + Bun
 *
 * Features:
 * - Keycloak integration for enterprise authentication
 * - JWT, Basic Auth, and API Key authentication methods
 * - HTTP and WebSocket authentication support
 * - Role-based and permission-based authorization
 * - Session management with Redis support
 * - Comprehensive error handling and validation
 * - ElysiaJS plugin architecture
 */

// Export all types and interfaces
export * from "./types/index.js";

// Export services (to be implemented)
export * from "./services/index.js";

// Export middleware (to be implemented)
export * from "./middleware/index.js";

// Export utilities (to be implemented)
export * from "./utils/index.js";

// Main plugin export
export { default as authPlugin } from "./plugin.js";

// Version and metadata
export const VERSION = "1.0.0";
export const NAME = "@libs/authv2";
