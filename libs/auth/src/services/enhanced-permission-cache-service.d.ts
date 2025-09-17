/**
 * Enhanced Permission Caching Service
 * Provides Redis-based caching for frequently accessed permissions
 * Implements cache invalidation, TTL management, and performance monitoring
 */
import { ServiceDependencies } from "../types";
export interface PermissionCacheEntry {
    permissions: string[];
    roles: string[];
    timestamp: number;
    ttl: number;
    hitCount: number;
    lastAccessed: number;
}
export interface CacheStats {
    totalEntries: number;
    totalHits: number;
    totalMisses: number;
    hitRate: number;
    averageAccessTime: number;
    memoryUsage: number;
}
export interface CacheConfig {
    defaultTtl: number;
    maxEntries: number;
    cleanupInterval: number;
    enableStats: boolean;
}
export declare class EnhancedPermissionCacheService {
    private deps;
    private cacheConfig;
    private stats;
    private cleanupTimer?;
    constructor(deps: ServiceDependencies, config?: Partial<CacheConfig>);
    /**
     * Get cached permissions for user
     */
    getUserPermissions(userId: string): Promise<string[] | null>;
    /**
     * Cache user permissions
     */
    setUserPermissions(userId: string, permissions: string[], roles?: string[], ttl?: number): Promise<void>;
    /**
     * Get cached roles for user
     */
    getUserRoles(userId: string): Promise<string[] | null>;
    /**
     * Cache user roles
     */
    setUserRoles(userId: string, roles: string[], ttl?: number): Promise<void>;
    /**
     * Invalidate user permission cache
     */
    invalidateUserPermissions(userId: string): Promise<void>;
    /**
     * Invalidate user role cache
     */
    invalidateUserRoles(userId: string): Promise<void>;
    /**
     * Invalidate all caches for user
     */
    invalidateUserCache(userId: string): Promise<void>;
    /**
     * Invalidate permission cache by role
     */
    invalidateRolePermissions(roleName: string): Promise<void>;
    /**
     * Clear all caches
     */
    clearAll(): Promise<void>;
    /**
     * Get cache statistics
     */
    getStats(): CacheStats;
    /**
     * Get cache configuration
     */
    getConfig(): CacheConfig;
    /**
     * Update cache configuration
     */
    updateConfig(config: Partial<CacheConfig>): void;
    /**
     * Warm up cache with frequently accessed data
     */
    warmupCache(userIds: string[]): Promise<void>;
    /**
     * Cleanup expired entries
     */
    private cleanup;
    /**
     * Start cleanup timer
     */
    private startCleanupTimer;
    /**
     * Restart cleanup timer with new interval
     */
    private restartCleanupTimer;
    /**
     * Update cache statistics
     */
    private updateStats;
    /**
     * Update hit rate
     */
    private updateHitRate;
    /**
     * Update memory usage estimate
     */
    private updateMemoryUsage;
    /**
     * Cleanup on destruction
     */
    destroy(): void;
}
/**
 * Create enhanced permission cache service instance
 */
export declare function createEnhancedPermissionCacheService(deps: ServiceDependencies, config?: Partial<CacheConfig>): EnhancedPermissionCacheService;
/**
 * Quick cache status check
 */
export declare function getCacheStatus(cache: EnhancedPermissionCacheService): {
    isHealthy: boolean;
    stats: CacheStats;
    config: CacheConfig;
};
export default EnhancedPermissionCacheService;
//# sourceMappingURL=enhanced-permission-cache-service.d.ts.map