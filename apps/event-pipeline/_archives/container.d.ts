/**
 * Service Container for Dependency Injection
 * Consolidates service creation and manages dependencies
 */
export declare class ServiceContainer {
    private static instance;
    private services;
    private logger;
    private constructor();
    static getInstance(): ServiceContainer;
    /**
     * Initialize all services with proper dependency injection
     */
    initializeServices(): void;
    /**
     * Get service instance by name
     */
    getService<T>(serviceName: string): T;
    /**
     * Check if service exists
     */
    hasService(serviceName: string): boolean;
    /**
     * Get all service names
     */
    getServiceNames(): string[];
    /**
     * Clean up all services (for graceful shutdown)
     */
    cleanup(): void;
}
//# sourceMappingURL=container.d.ts.map