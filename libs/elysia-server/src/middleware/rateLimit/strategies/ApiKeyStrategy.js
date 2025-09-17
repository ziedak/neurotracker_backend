import { z } from "@libs/utils";
/**
 * API key-based rate limiting strategy
 * Uses API key as the rate limiting key
 * Falls back to IP if no API key is present
 * Optimized for performance, maintainability, and strict validation
 */
export class ApiKeyStrategy {
    /**
     * Generate a rate limit key based on API key or fallback to IP
     * Caches headers for performance, uses helpers for extraction and validation
     */
    generateKey(context) {
        const headers = this.cacheHeaders(context.request.headers);
        const apiKey = this.extractApiKey(headers, context);
        if (apiKey) {
            return apiKey;
        }
        // Fallback to IP-based strategy
        const ip = ApiKeyStrategy.extractClientIp(headers, context);
        // Example logging usage of maskApiKey (if logger available)
        // logger?.warn(`API key missing, falling back to IP: ${ApiKeyStrategy.maskApiKey(ip)}`);
        return `fallback:${ip}`;
    }
    /**
     * Cache headers for performance (lowercase keys)
     */
    cacheHeaders(headers) {
        const cached = {};
        for (const key in headers) {
            cached[key.toLowerCase()] = headers[key];
        }
        return cached;
    }
    /**
     * Extract API key from headers, authorization, or user context
     * Integrates isValidApiKey for strict validation
     */
    extractApiKey(headers, context) {
        // Try standard API key headers
        const apiKey = this.extractFromHeaders(headers);
        if (apiKey && this.isValidApiKey(apiKey))
            return apiKey;
        // Try Authorization header
        const authKey = this.extractFromAuthorization(headers);
        if (authKey && this.isValidApiKey(authKey))
            return authKey;
        // Try user context
        const userKey = this.extractFromUser(context);
        if (userKey && this.isValidApiKey(userKey))
            return userKey;
        return null;
    }
    /**
     * Extract API key from standard headers
     */
    extractFromHeaders(headers) {
        return headers["x-api-key"] || headers["api-key"] || null;
    }
    /**
     * Extract API key from Authorization header
     */
    extractFromAuthorization(headers) {
        const authHeader = headers["authorization"];
        if (!authHeader)
            return null;
        const apiKeyMatch = ApiKeyStrategy.matchApiKeyAuth(authHeader);
        if (apiKeyMatch)
            return apiKeyMatch;
        const bearerMatch = ApiKeyStrategy.matchBearerAuth(authHeader);
        if (bearerMatch && this.looksLikeApiKey(bearerMatch))
            return bearerMatch;
        return null;
    }
    /**
     * Extract API key from user context
     */
    extractFromUser(context) {
        const apiKey = context.user?.["apiKey"];
        return apiKey || null;
    }
    /**
     * Match "ApiKey <key>" format in Authorization header
     */
    static matchApiKeyAuth(authHeader) {
        const match = authHeader.match(/^ApiKey\s+(.+)$/i);
        return match && typeof match[1] === "string" ? match[1] : null;
    }
    /**
     * Match "Bearer <key>" format in Authorization header
     */
    static matchBearerAuth(authHeader) {
        const match = authHeader.match(/^Bearer\s+(.+)$/i);
        return match && typeof match[1] === "string" ? match[1] : null;
    }
    /**
     * Extract client IP for fallback (centralized for reuse)
     */
    static extractClientIp(headers, context) {
        return (headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
            headers["x-real-ip"] ||
            headers["cf-connecting-ip"] ||
            context.request.ip ||
            "unknown");
    }
    /**
     * Check if a string looks like an API key
     * API keys are typically longer and don't contain dots (unlike JWTs)
     */
    looksLikeApiKey(token) {
        return (token.length >= 20 &&
            !token.includes(".") &&
            /^[a-zA-Z0-9_-]+$/.test(token));
    }
    /**
     * Mask API key for logging
     */
    static maskApiKey(apiKey) {
        if (apiKey.length <= 8) {
            return "***";
        }
        return `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`;
    }
    /**
     * Validate API key format using zod
     */
    isValidApiKey(apiKey) {
        const apiKeySchema = z.string().min(10).max(100);
        return apiKeySchema.safeParse(apiKey).success;
    }
}
//# sourceMappingURL=ApiKeyStrategy.js.map