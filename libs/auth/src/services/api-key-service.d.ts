/**
 * API Key Management Service
 * Handles API key generation, validation, and lifecycle management
 * Provides secure API key authentication with Redis storage
 */
import { ApiKey, ApiKeyCreateData, AuthConfig, ServiceDependencies } from "../types";
export declare class ApiKeyService {
    private config;
    private deps;
    constructor(config: AuthConfig, deps: ServiceDependencies);
    /**
     * Create a new API key for user
     */
    createApiKey(userId: string, data: ApiKeyCreateData): Promise<ApiKey>;
    /**
     * Get API key by ID
     */
    getApiKey(apiKeyId: string): Promise<ApiKey | null>;
    /**
     * Get API key by key value
     */
    getApiKeyByKey(key: string): Promise<ApiKey | null>;
    /**
     * Validate API key and return user ID
     */
    validateApiKey(key: string): Promise<{
        userId: string;
        permissions: string[];
    } | null>;
    /**
     * Update API key
     */
    updateApiKey(apiKeyId: string, updates: Partial<Pick<ApiKey, "name" | "permissions" | "isActive" | "expiresAt">>): Promise<boolean>;
    /**
     * Delete API key
     */
    deleteApiKey(apiKeyId: string): Promise<boolean>;
    /**
     * Get all API keys for user
     */
    getUserApiKeys(userId: string): Promise<ApiKey[]>;
    /**
     * Regenerate API key
     */
    regenerateApiKey(apiKeyId: string): Promise<ApiKey | null>;
    /**
     * Clean up expired API keys
     */
    cleanupExpiredApiKeys(): Promise<number>;
    /**
     * Get API key statistics
     */
    getApiKeyStats(): Promise<{
        total: number;
        active: number;
        expired: number;
    }>;
    private generateApiKey;
    private storeApiKey;
    private updateApiKeyUsage;
}
/**
 * Create API key service instance
 */
export declare function createApiKeyService(config: AuthConfig, deps: ServiceDependencies): ApiKeyService;
/**
 * Validate API key format
 */
export declare function validateApiKeyFormat(key: string, config: AuthConfig): boolean;
export default ApiKeyService;
//# sourceMappingURL=api-key-service.d.ts.map