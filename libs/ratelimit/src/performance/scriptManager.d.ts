import { RedisClient } from "@libs/database";
/**
 * Shared script management for EVALSHA optimization
 * Prevents redundant script loading across multiple instances
 */
export declare class SharedScriptManager {
    private static instance;
    private readonly scriptShas;
    private scriptsInitialized;
    private initPromise;
    private readonly SCRIPTS;
    logger: import("@libs/utils").ILogger;
    /**
     * Get singleton instance
     */
    static getInstance(): SharedScriptManager;
    /**
     * Initialize scripts with Redis client
     */
    initialize(redisClient: RedisClient): Promise<void>;
    /**
     * Perform actual script initialization
     */
    private doInitialize;
    /**
     * Get script SHA by name
     */
    getScriptSha(scriptName: keyof typeof this.SCRIPTS): string | undefined;
    /**
     * Check if scripts are initialized
     */
    isInitialized(): boolean;
    /**
     * Get all available script names
     */
    getAvailableScripts(): string[];
    /**
     * Reset initialization state (for testing)
     */
    reset(): void;
    /**
     * Get script content for debugging
     */
    getScriptContent(scriptName: keyof typeof this.SCRIPTS): string | undefined;
    /**
     * Force re-initialization (useful for Redis reconnections)
     */
    forceReinitialize(redisClient: RedisClient): Promise<void>;
}
//# sourceMappingURL=scriptManager.d.ts.map