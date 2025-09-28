/**
 * Keycloak Integration Service - SOLID Architecture Exports
 *
 * This module provides both the complete integration service and individual components
 * following the Interface Segregation Principle (ISP)
 */

// Main Integration Service (Recommended)
export { KeycloakIntegrationService } from "./KeycloakIntegrationService";

// Individual Components (Advanced Usage)
export { InputValidator } from "./InputValidator";
export { ConfigurationManager } from "./ConfigurationManager";
export { StatisticsCollector } from "./StatisticsCollector";
export { AuthenticationManager } from "./AuthenticationManager";
export { SessionValidator } from "./SessionValidator";
export { UserManager } from "./UserManager";
export { ResourceManager } from "./ResourceManager";

// Interfaces and Types
export type {
  IIntegrationService,
  IAuthenticationManager,
  ISessionValidator,
  IInputValidator,
  IStatisticsCollector,
  IConfigurationManager,
  IUserManager,
  IResourceManager,
  KeycloakConnectionOptions,
  ClientContext,
  AuthenticationResult,
  LogoutResult,
  ValidationResult,
  IntegrationStats,
} from "./interfaces";

/**
 * Usage Examples:
 *
 * 1. Complete Integration Service (Recommended):
 * ```typescript
 * import { KeycloakIntegrationService } from "@libs/keycloak-authV2/integration";
 *
 * const integrationService = KeycloakIntegrationService.create(
 *   keycloakOptions,
 *   dbClient,
 *   metrics
 * );
 *
 * await integrationService.initialize();
 * const result = await integrationService.authenticateWithPassword(username, password, context);
 * ```
 *
 * 2. Individual Components (Custom Architecture):
 * ```typescript
 * import {
 *   AuthenticationManager,
 *   SessionValidator,
 *   InputValidator
 * } from "@libs/keycloak-authV2/integration";
 *
 * const inputValidator = new InputValidator();
 * const authManager = new AuthenticationManager(keycloakClient, sessionManager, inputValidator, metrics);
 * const sessionValidator = new SessionValidator(keycloakClient, sessionManager, inputValidator, metrics);
 * ```
 *
 * 3. Interface-Based Development:
 * ```typescript
 * import type { IAuthenticationManager, ISessionValidator } from "@libs/keycloak-authV2/integration";
 *
 * function createAuthService(auth: IAuthenticationManager, session: ISessionValidator) {
 *   // Use interface methods
 * }
 * ```
 */

/**
 * Architecture Benefits:
 *
 * ✅ **Single Responsibility Principle**: Each component has one focused purpose
 * ✅ **Open/Closed Principle**: Easy to extend without modifying existing code
 * ✅ **Liskov Substitution Principle**: Components can be safely substituted
 * ✅ **Interface Segregation Principle**: Focused interfaces for each concern
 * ✅ **Dependency Inversion Principle**: Components depend on abstractions
 *
 * Components:
 * - **InputValidator**: Zod-based input validation and sanitization
 * - **ConfigurationManager**: Centralized service configuration
 * - **StatisticsCollector**: Performance statistics with intelligent caching
 * - **AuthenticationManager**: Multi-flow authentication handling
 * - **SessionValidator**: Session lifecycle and logout management
 * - **UserManager**: User creation and retrieval operations
 * - **ResourceManager**: Resource initialization, cleanup, and health monitoring
 * - **KeycloakIntegrationService**: Main orchestration facade
 */
