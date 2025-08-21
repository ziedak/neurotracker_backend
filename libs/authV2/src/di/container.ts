/**
 * @fileoverview AuthV2 Dependency Injection Container
 * @module di/container
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import { ServiceRegistry, type IServiceRegistry } from "@libs/utils";

/**
 * AuthV2 service tokens for type safety
 */
export const AUTH_V2_TOKENS = {
  // Core Services
  USER_SERVICE: "AuthV2.UserService",
  SESSION_SERVICE: "AuthV2.SessionService",
  JWT_SERVICE: "AuthV2.JWTService",
  PERMISSION_SERVICE: "AuthV2.PermissionService",
  AUTHENTICATION_SERVICE: "AuthV2.AuthenticationService",

  // Infrastructure Services
  CACHE_SERVICE: "AuthV2.CacheService",
  API_KEY_SERVICE: "AuthV2.APIKeyService",

  // Configuration and Management
  CONFIG_MANAGER: "AuthV2.ConfigManager",
  HEALTH_SERVICE: "AuthV2.HealthService",
} as const;

/**
 * AuthV2 DI Container - Wrapper around existing ServiceRegistry
 * Creates isolated container for authV2 services while leveraging existing infrastructure
 */
export class AuthV2Container {
  private readonly registry: IServiceRegistry;
  private isInitialized = false;

  constructor() {
    // Create child registry for authV2 isolation
    this.registry = ServiceRegistry.createChild();
  }

  /**
   * Register a transient service
   */
  public register<T>(token: string, factory: () => T): void {
    this.registry.register(token, factory);
  }

  /**
   * Register a singleton service
   */
  public registerSingleton<T>(token: string, factory: () => T): void {
    this.registry.registerSingleton(token, factory);
  }

  /**
   * Register an instance
   */
  public registerInstance<T>(token: string, instance: T): void {
    this.registry.registerInstance(token, instance);
  }

  /**
   * Register an async singleton service
   */
  public registerAsyncSingleton<T>(
    token: string,
    factory: () => Promise<T>
  ): void {
    this.registry.registerAsyncSingleton(token, factory);
  }

  /**
   * Resolve a service synchronously
   */
  public resolve<T>(token: string): T {
    return this.registry.resolve<T>(token);
  }

  /**
   * Resolve a service asynchronously
   */
  public async resolveAsync<T>(token: string): Promise<T> {
    return this.registry.resolveAsync<T>(token);
  }

  /**
   * Safe resolve with error handling
   */
  public safeResolve<T>(token: string): T | null {
    try {
      return this.registry.safeResolve<T>(token);
    } catch {
      return null;
    }
  }

  /**
   * Check if service is registered
   */
  public isRegistered(token: string): boolean {
    return this.registry.isRegistered(token);
  }

  /**
   * Initialize core authV2 services
   */
  public initializeCore(): void {
    if (this.isInitialized) {
      return;
    }

    // Initialize critical services in order
    const coreServices = [
      AUTH_V2_TOKENS.CONFIG_MANAGER,
      AUTH_V2_TOKENS.CACHE_SERVICE,
      AUTH_V2_TOKENS.USER_SERVICE,
      AUTH_V2_TOKENS.SESSION_SERVICE,
      AUTH_V2_TOKENS.JWT_SERVICE,
      AUTH_V2_TOKENS.PERMISSION_SERVICE,
      AUTH_V2_TOKENS.AUTHENTICATION_SERVICE,
    ];

    this.registry.initializeCore(coreServices);
    this.isInitialized = true;
  }

  /**
   * Get health status of all registered services
   */
  public getHealthStatus(): Record<string, boolean> {
    const health: Record<string, boolean> = {};

    // Check core service registration
    Object.values(AUTH_V2_TOKENS).forEach((token) => {
      health[token] = this.isRegistered(token);
    });

    return health;
  }

  /**
   * Dispose of the container and cleanup resources
   */
  public dispose(): void {
    this.registry.dispose();
    this.isInitialized = false;
  }
}

/**
 * Singleton container instance
 */
let containerInstance: AuthV2Container | null = null;

/**
 * Get or create the AuthV2 container instance
 */
export function getAuthV2Container(): AuthV2Container {
  if (!containerInstance) {
    containerInstance = new AuthV2Container();
  }
  return containerInstance;
}

/**
 * Reset container (primarily for testing)
 */
export function resetAuthV2Container(): void {
  if (containerInstance) {
    containerInstance.dispose();
    containerInstance = null;
  }
}

/**
 * Type-safe service resolution helpers
 */
export function resolveService<T>(token: string): T {
  return getAuthV2Container().resolve<T>(token);
}

export function safeResolveService<T>(token: string): T | null {
  return getAuthV2Container().safeResolve<T>(token);
}

export async function resolveServiceAsync<T>(token: string): Promise<T> {
  return getAuthV2Container().resolveAsync<T>(token);
}
