/**
 * Core types for keycloak-authv2
 */

// Authentication result
export interface AuthResult {
  success: boolean;
  user?: UserInfo;
  token?: string;
  scopes?: string[];
  expiresAt?: Date | undefined;
  error?: string;
}

// User information
export interface UserInfo {
  id: string;
  username: string | undefined;
  email: string | undefined;
  name: string | undefined;
  roles: string[];
  permissions: string[];
  metadata?: Record<string, any>;
}

// Auth configuration
export interface AuthConfig {
  jwksUrl?: string;
  audience?: string;
  issuer?: string;
  cache?: {
    enabled: boolean;
    ttl: number;
  };
}

// Auth V2 Configuration (Keycloak-specific)
export interface AuthV2Config {
  keycloak?: {
    serverUrl: string;
    realm: string;
    clientId: string;
    clientSecret?: string;
  };
  cache: {
    enabled: boolean;
    ttl: {
      jwt: number;
      apiKey: number;
      session: number;
      userInfo: number;
    };
  };
}

// Token types
export interface JWTPayload {
  sub: string;
  iss: string;
  aud: string | string[];
  exp: number;
  iat: number;
  [key: string]: any;
}

// Token validation options
export interface TokenValidationOptions {
  allowExpired?: boolean;
  maxAge?: number; // Maximum age in seconds
  requiredClaims?: string[];
  introspectionEndpoint?: string;
}

// Token introspection result
export interface TokenIntrospectionResult {
  active: boolean;
  sub?: string;
  email?: string;
  roles?: string[];
  permissions?: string[];
  exp?: number;
  iat?: number;
  [key: string]: any;
}

// Token manager statistics
export interface TokenManagerStats {
  jwksCached: boolean;
  jwksAge: number;
  cacheEnabled: boolean;
}

// API Key types
export interface APIKeyValidationResult extends AuthResult {
  keyId?: string;
  scopes?: string[];
}

export interface APIKeyInfo {
  id: string;
  userId: string;
  name?: string;
  scopes: string[];
  permissions: string[];
  createdAt: Date;
  lastUsed?: Date;
  expiresAt?: Date;
  isActive: boolean;
}
