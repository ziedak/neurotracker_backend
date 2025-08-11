// core/ServiceRegistry.ts

/**
 * Factory for synchronous services
 */
export type ServiceFactory<T> = () => T;

/**
 * Factory for asynchronous services (e.g., WASM, remote config)
 */
export type AsyncServiceFactory<T> = () => Promise<T>;

const transientRegistry = new Map<string, ServiceFactory<unknown>>();
const asyncTransientRegistry = new Map<string, AsyncServiceFactory<unknown>>();
const singletonInstances = new Map<string, unknown>();
const singletonFactories = new Map<string, ServiceFactory<unknown>>();
const asyncSingletonFactories = new Map<string, AsyncServiceFactory<unknown>>();
const asyncSingletonInstances = new Map<string, Promise<unknown>>();
const initializedServices = new Set<string>();
const initializationQueue = new Set<string>();

/**
 * Lightweight DI Container
 */
export interface IServiceRegistry {
  register<T>(key: string, factory: ServiceFactory<T>): void;
  registerSingleton<T>(key: string, factory: ServiceFactory<T>): void;
  registerInstance<T>(key: string, instance: T): void;
  resolve<T>(key: string): T;
  safeResolve<T>(key: string): T;
  initializeCore(services: string[]): void;
  createChild(): IServiceRegistry;
  dispose(): void;

  /**
   * Register an async singleton service (created on first async access)
   */
  registerAsyncSingleton<T>(key: string, factory: AsyncServiceFactory<T>): void;

  /**
   * Resolve an async singleton service (returns Promise<T>)
   */
  resolveAsync<T>(key: string): Promise<T>;

  /**
   * Unregister a service (transient, singleton, async, or instance)
   */
  unregister(key: string): void;

  /**
   * Check if a service is registered (factory or instance)
   */
  isRegistered(key: string): boolean;

  /**
   * Register an async transient service (new instance per resolveAsync)
   */
  registerAsync<T>(key: string, factory: AsyncServiceFactory<T>): void;

  /**
   * Register a lazy service (sync or async, singleton or transient)
   * If async, resolves on first use; if sync, resolves immediately on first use.
   */
  registerLazy<T>(
    key: string,
    factory: ServiceFactory<T> | AsyncServiceFactory<T>,
    singleton?: boolean
  ): void;
}
export const ServiceRegistry: IServiceRegistry = {
  /**
   * Register a transient service (new instance per resolve)
   */
  register<T>(key: string, factory: ServiceFactory<T>): void {
    transientRegistry.set(key, factory);
    asyncTransientRegistry.delete(key);
  },
  /**
   * Register an async transient service (new instance per resolveAsync)
   */
  registerAsync<T>(key: string, factory: AsyncServiceFactory<T>): void {
    asyncTransientRegistry.set(key, factory);
    transientRegistry.delete(key);
  },

  /**
   * Register a singleton service (created on first access)
   */
  registerSingleton<T>(key: string, factory: ServiceFactory<T>): void {
    singletonFactories.set(key, factory);
  },

  /**
   * Register a pre-created singleton instance
   */
  registerInstance<T>(key: string, instance: T): void {
    singletonInstances.set(key, instance);
  },

  /**
   * Register an async singleton service (created on first async access)
   */
  registerAsyncSingleton<T>(
    key: string,
    factory: AsyncServiceFactory<T>
  ): void {
    asyncSingletonFactories.set(key, factory);
  },

  /**
   * Resolve a service instance with dependency handling
   */
  resolve<T>(key: string): T {
    // 1. Check singleton instances
    if (singletonInstances.has(key)) {
      return singletonInstances.get(key) as T;
    }

    // 2. Check singleton factories (lazy initialization)
    if (singletonFactories.has(key)) {
      const factory = singletonFactories.get(key)!;
      const instance = factory();
      singletonInstances.set(key, instance);
      singletonFactories.delete(key);
      return instance as T;
    }

    // 3. Check transient services
    if (transientRegistry.has(key)) {
      return transientRegistry.get(key)!() as T;
    }

    // 4. Check async transient (should use resolveAsync)
    if (asyncTransientRegistry.has(key)) {
      throw new Error(`Service '${key}' is async. Use resolveAsync.`);
    }

    throw new Error(`Service not registered: ${key}`);
  },

  /**
   * Resolve an async singleton service (returns Promise<T>)
   */
  async resolveAsync<T>(key: string): Promise<T> {
    // 1. Check if already resolved
    if (asyncSingletonInstances.has(key)) {
      return asyncSingletonInstances.get(key)! as Promise<T>;
    }
    // 2. Check async singleton factory
    if (asyncSingletonFactories.has(key)) {
      const factory = asyncSingletonFactories.get(key)!;
      const promise = factory();
      asyncSingletonInstances.set(key, promise);
      asyncSingletonFactories.delete(key);
      return promise as Promise<T>;
    }
    // 3. Fallback to sync resolve (for compatibility)
    return Promise.resolve(this.resolve<T>(key));
    // 4. Check async transient
    if (asyncTransientRegistry.has(key)) {
      return asyncTransientRegistry.get(key)!() as Promise<T>;
    }
    // 5. Check sync transient (should use resolve)
    if (transientRegistry.has(key)) {
      throw new Error(`Service '${key}' is sync. Use resolve.`);
    }
    throw new Error(`Service not registered: ${key}`);
  },
  /**
   * Register a lazy service (sync or async, singleton or transient)
   * If async, resolves on first use; if sync, resolves immediately on first use.
   */
  registerLazy<T>(
    key: string,
    factory: ServiceFactory<T> | AsyncServiceFactory<T>,
    singleton: boolean = true
  ): void {
    if (singleton) {
      if (factory.length === 0) {
        // sync singleton
        this.registerSingleton(key, factory as ServiceFactory<T>);
      } else {
        // async singleton
        this.registerAsyncSingleton(key, factory as AsyncServiceFactory<T>);
      }
    } else {
      if (factory.length === 0) {
        // sync transient
        this.register(key, factory as ServiceFactory<T>);
      } else {
        // async transient
        this.registerAsync(key, factory as AsyncServiceFactory<T>);
      }
    }
  },

  /**
   * Safely resolve service with circular dependency protection
   */

  /**
   * Safely resolve service with circular dependency protection
   */
  safeResolve<T>(key: string): T {
    if (initializationQueue.has(key)) {
      throw new Error(
        `Circular dependency detected: ${key} in [${Array.from(
          initializationQueue
        ).join(" -> ")}]`
      );
    }

    if (initializedServices.has(key)) {
      return this.resolve(key);
    }

    try {
      initializationQueue.add(key);
      const service = this.resolve<T>(key);
      initializedServices.add(key);
      return service;
    } finally {
      initializationQueue.delete(key);
    }
  },

  /**
   * Initialize core services in explicit order
   */

  /**
   * Initialize core services in explicit order
   */
  initializeCore(services: string[]): void {
    services.forEach((key) => {
      if (!initializedServices.has(key)) {
        this.safeResolve(key);
      }
    });
  },

  /**
   * Reset registry
   */
  dispose(): void {
    transientRegistry.clear();
    asyncTransientRegistry.clear();
    singletonInstances.clear();
    singletonFactories.clear();
    asyncSingletonFactories.clear();
    asyncSingletonInstances.clear();
    initializedServices.clear();
    initializationQueue.clear();
  },

  /**
   * Create child container for isolated environments
   */

  /**
   * Create child container for isolated environments
   */
  createChild(): IServiceRegistry {
    const childInstances = new Map<string, unknown>();
    return {
      register: (key, factory) => transientRegistry.set(key, factory),
      registerAsync: (key, factory) => asyncTransientRegistry.set(key, factory),
      registerSingleton: (key, factory) => singletonFactories.set(key, factory),
      registerInstance: (key, instance) => childInstances.set(key, instance),
      registerAsyncSingleton: (key, factory) =>
        asyncSingletonFactories.set(key, factory),
      registerLazy: (key, factory, singleton = true) =>
        ServiceRegistry.registerLazy(key, factory, singleton),
      resolve: <T>(key: string): T => {
        if (childInstances.has(key)) return childInstances.get(key) as T;
        return ServiceRegistry.resolve(key);
      },
      resolveAsync: <T>(key: string) => ServiceRegistry.resolveAsync<T>(key),
      safeResolve: ServiceRegistry.safeResolve,
      initializeCore: ServiceRegistry.initializeCore,
      createChild: ServiceRegistry.createChild,
      dispose: ServiceRegistry.dispose,
      unregister: (key: string) => ServiceRegistry.unregister(key),
      isRegistered: (key: string) => ServiceRegistry.isRegistered(key),
    };
  },

  /**
   * Unregister a service (transient, singleton, async, or instance)
   */
  unregister(key: string): void {
    transientRegistry.delete(key);
    asyncTransientRegistry.delete(key);
    singletonFactories.delete(key);
    singletonInstances.delete(key);
    asyncSingletonFactories.delete(key);
    asyncSingletonInstances.delete(key);
    initializedServices.delete(key);
    // Note: child containers may need to be handled separately if used
  },

  /**
   * Check if a service is registered (factory or instance)
   */
  isRegistered(key: string): boolean {
    return (
      transientRegistry.has(key) ||
      asyncTransientRegistry.has(key) ||
      singletonFactories.has(key) ||
      singletonInstances.has(key) ||
      asyncSingletonFactories.has(key) ||
      asyncSingletonInstances.has(key)
    );
  },
};

/**
 * USAGE EXAMPLES
 *
 * // Register a sync singleton
 * ServiceRegistry.registerSingleton('Logger', () => new LoggerService());
 *
 * // Register an async singleton (e.g., WASM)
 * ServiceRegistry.registerAsyncSingleton('WasmCompressor', async () => {
 *   const module = await import('./wasm/Compressor');
 *   return module.createCompressor();
 * });
 *
 * // Resolve sync
 * const loggerService = ServiceRegistry.resolve<LoggerService>('Logger');
 *
 * // Resolve async
 * const compressor = await ServiceRegistry.resolveAsync<WasmCompressor>('WasmCompressor');
 *
 * // Unregister a service (for plugin unloading)
 * ServiceRegistry.unregister('Logger');
 */
