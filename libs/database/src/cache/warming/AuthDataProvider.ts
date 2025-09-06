/**
 * Authentication Data Provider
 * Provides data for cache warming in authentication scenarios
 */

import { createLogger } from "@libs/utils";
import type { WarmupDataProvider } from "../interfaces/ICache";

/**
 * Authentication-specific data provider for cache warming
 */
export class AuthDataProvider implements WarmupDataProvider {
  private logger = createLogger("AuthDataProvider");

  async getWarmupKeys(): Promise<string[]> {
    // Return commonly accessed authentication keys
    return [
      "user:profile:active",
      "session:active:count",
      "permissions:default",
      "auth:config:ttl",
      "user:roles:active",
      "system:auth:settings",
      "cache:auth:metadata",
    ];
  }

  async loadDataForKey(key: string): Promise<any | null> {
    try {
      // In a real implementation, this would load from database
      // For now, return mock data based on key pattern
      switch (true) {
        case key.startsWith("user:profile:"):
          return {
            id: "mock-user-id",
            email: "user@example.com",
            role: "user",
            lastLogin: new Date().toISOString(),
          };

        case key.startsWith("session:active:"):
          return {
            activeSessions: 42,
            lastActivity: new Date().toISOString(),
          };

        case key.startsWith("permissions:"):
          return {
            read: true,
            write: false,
            admin: false,
          };

        case key.startsWith("auth:config:"):
          return {
            sessionTimeout: 3600,
            maxLoginAttempts: 5,
            passwordPolicy: "strong",
          };

        case key.startsWith("user:roles:"):
          return ["user", "premium"];

        case key.startsWith("system:auth:"):
          return {
            version: "1.0.0",
            features: ["mfa", "sso"],
          };

        case key.startsWith("cache:auth:"):
          return {
            totalEntries: 150,
            hitRate: 0.85,
            lastCleanup: new Date().toISOString(),
          };

        default:
          this.logger.warn(`Unknown key pattern for auth data: ${key}`);
          return null;
      }
    } catch (error) {
      this.logger.error(`Failed to load data for key: ${key}`, error as Error);
      return null;
    }
  }

  getKeyPriority(key: string): number {
    // Define priority based on key patterns
    const priorities: Record<string, number> = {
      "user:profile:": 10,
      "session:active:": 9,
      "permissions:": 8,
      "auth:config:": 7,
      "user:roles:": 6,
      "system:auth:": 5,
      "cache:auth:": 4,
    };

    for (const [pattern, priority] of Object.entries(priorities)) {
      if (key.startsWith(pattern)) {
        return priority;
      }
    }

    return 1; // Default priority
  }
}
