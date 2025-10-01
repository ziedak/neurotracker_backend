/**
 * Shared authentication types
 *
 * Common authentication interfaces used across multiple services
 */

/**
 * Authentication result interface
 * Standard response format for authentication operations
 */
export interface AuthResult {
  readonly success: boolean;
  readonly user?: UserInfo;
  readonly token?: string;
  readonly scopes?: string[];
  readonly expiresAt?: Date | undefined;
  readonly error?: string;
}

/**
 * User information interface
 * Standardized user data structure
 */
export interface UserInfo {
  readonly id: string;
  readonly username: string | undefined;
  readonly email: string | undefined;
  readonly name: string | undefined;
  readonly roles: string[];
  readonly permissions: string[];
  readonly metadata?: Record<string, any>;
}

/**
 * Authentication configuration interface
 * Basic auth configuration options
 */
export interface AuthConfig {
  readonly jwksUrl?: string;
  readonly audience?: string;
  readonly issuer?: string;
  readonly cache?: {
    readonly enabled: boolean;
    readonly ttl: number;
  };
}

/**
 * Keycloak-specific authentication configuration
 */
export interface AuthV2Config {
  readonly keycloak?: {
    readonly serverUrl: string;
    readonly realm: string;
    readonly clientId: string;
    readonly clientSecret?: string;
  };
  readonly cache: {
    readonly enabled: boolean;
    readonly ttl: {
      readonly jwt: number;
      readonly apiKey: number;
      readonly session: number;
      readonly userInfo: number;
    };
  };
}

/**
 * Authentication context interface
 * Runtime authentication state information
 */
export interface AuthContext {
  readonly authenticated: boolean;
  readonly user?: UserInfo;
  readonly permissions: string[];
  readonly roles: string[];
  readonly tokenType: "jwt" | "apikey" | "session" | "anonymous";
  readonly expiresAt?: Date;
  readonly issuedAt: Date;
  readonly lastValidated: Date;
}
