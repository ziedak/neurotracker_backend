/**
 * Session Management Components - SOLID Architecture
 *
 * This module provides a complete session management system following SOLID principles.
 * Each component has a single responsibility and can be used independently or together
 * through the main SessionManager orchestrator.
 */

// Main orchestrator (recommended entry point)
export { SessionManager, type SessionManagerConfig } from "./SessionManager";

// Individual components (for advanced usage)
export { SessionStore, type SessionStoreConfig } from "./SessionStore";
export {
  SessionValidator,
  type SessionValidatorConfig,
  SecurityCheckReason,
} from "./SessionValidator";
export {
  SessionSecurity,
  type SessionSecurityConfig,
  SecurityEventType,
} from "./SessionSecurity";
export { SessionMetrics, type SessionMetricsConfig } from "./SessionMetrics";
export { SessionCleaner, type SessionCleanerConfig } from "./SessionCleaner";
export { SessionTokenCoordinator } from "./SessionTokenCoordinator";

// Shared types and interfaces
export * from "./sessionTypes";

/**
 * Usage Examples:
 *
 * 1. Complete session management (recommended):
 * ```typescript
 * import { SessionManager } from "@libs/keycloak-auth/services/session";
 *
 * const sessionManager = new SessionManager(
 *   dbClient,
 *   cacheService,
 *   logger,
 *   metrics,
 *   {
 *     keycloak: {
 *       serverUrl: "https://keycloak.example.com",
 *       realm: "myapp",
 *       clientId: "myapp-client",
 *     },
 *     enableComponents: {
 *       metrics: true,
 *       security: true,
 *       cleanup: true,
 *       validation: true,
 *     }
 *   }
 * );
 *
 * // Create session
 * const result = await sessionManager.createSession(userId, tokens, requestContext);
 *
 * // Validate session
 * const validation = await sessionManager.validateSession(sessionId, requestContext);
 * ```
 *
 * 2. Individual components (for custom architectures):
 * ```typescript
 * import { SessionStore, TokenManager, SessionValidator } from "@libs/keycloak-auth/services/session";
 *
 * const store = new SessionStore(dbClient, cacheService);
 * const tokenManager = new TokenManager();
 * const validator = new SessionValidator();
 *
 * // Use components independently
 * await store.storeSession(sessionData);
 * const validation = await validator.validateSession(sessionData);
 * ```
 *
 * 3. Component-specific configuration:
 * ```typescript
 * import { SessionManager } from "@libs/keycloak-auth/services/session";
 *
 * const sessionManager = new SessionManager(dbClient, cacheService, logger, metrics, {
 *   sessionStore: {
 *     cacheEnabled: true,
 *     defaultCacheTTL: 3600,
 *     batchSize: 100,
 *   },
 *   tokenManager: {
 *     encryptionKey: process.env.TOKEN_ENCRYPTION_KEY,
 *     tokenRefreshThreshold: 300000, // 5 minutes
 *   },
 *   sessionValidator: {
 *     sessionTimeout: 86400000, // 24 hours
 *     maxIdleTime: 14400000,    // 4 hours
 *     requireFingerprint: true,
 *   },
 *   sessionSecurity: {
 *     maxConcurrentSessions: 5,
 *     deviceTrackingEnabled: true,
 *     suspiciousActivityThreshold: 10,
 *   },
 *   sessionMetrics: {
 *     enableDetailedMetrics: true,
 *     metricsRetentionDays: 30,
 *   },
 *   sessionCleaner: {
 *     enableAutomaticCleanup: true,
 *     cleanupInterval: 3600000, // 1 hour
 *     enableDeepCleanup: true,
 *   }
 * });
 * ```
 */

/**
 * Architecture Benefits:
 *
 * 1. **Single Responsibility**: Each component handles one aspect of session management
 * 2. **Open/Closed**: Components are extensible without modifying existing code
 * 3. **Liskov Substitution**: Components can be replaced with compatible implementations
 * 4. **Interface Segregation**: Clean, focused interfaces for each component
 * 5. **Dependency Inversion**: Components depend on abstractions, not concretions
 *
 * Components:
 * - **SessionStore**: Database and cache operations
 * - **TokenManager**: Token encryption, decryption, and refresh
 * - **SessionValidator**: Security checks, expiration, and rotation
 * - **SessionSecurity**: Concurrent limits, fingerprinting, threat detection
 * - **SessionMetrics**: Statistics, monitoring, and performance tracking
 * - **SessionCleaner**: Maintenance, cleanup, and optimization
 * - **SessionManager**: Orchestrates all components with unified API
 */
