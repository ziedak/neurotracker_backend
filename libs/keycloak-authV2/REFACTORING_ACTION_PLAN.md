# Keycloak Auth V2 Refactoring Action Plan

**Date:** October 1, 2025  
**Status:** 🔴 READY FOR IMPLEMENTATION  
**Estimated Duration:** 2 weeks (80 hours)

---

## Table of Contents

1. [Phase 1: Token Directory Refactoring](#phase-1-token-directory-refactoring)
2. [Phase 2: Session Directory Refactoring](#phase-2-session-directory-refactoring)
3. [Phase 3: Shared Directory Creation](#phase-3-shared-directory-creation)
4. [Phase 4: Integration & Testing](#phase-4-integration--testing)
5. [Migration Strategy](#migration-strategy)
6. [Success Metrics](#success-metrics)

---

## 🎯 Core Principles

### Separation of Concerns

```
┌─────────────────────────────────────────────────────────────┐
│                    SHARED LAYER                              │
│  ├── Types (AuthResult, UserInfo, Config)                   │
│  ├── Utilities (TypeAdapters, HashingUtils)                 │
│  ├── Security (EncryptionManager, KeyManager)               │
│  └── Constants (Time units, defaults)                       │
└─────────────────────────────────────────────────────────────┘
              ↑                              ↑
              │                              │
    ┌─────────┴───────────┐      ┌─────────┴──────────┐
    │   TOKEN LAYER       │      │   SESSION LAYER    │
    │                     │      │                    │
    │  Responsibilities:  │      │  Responsibilities: │
    │  - Validate tokens  │      │  - Manage sessions │
    │  - Refresh tokens   │      │  - Track sessions  │
    │  - Check roles      │      │  - Validate sessions│
    │  - Extract claims   │      │  - Security checks │
    │                     │      │                    │
    │  NO session logic   │      │  Delegates token   │
    │  NO caching sessions│      │  operations to ←───┤
    └─────────────────────┘      └────────────────────┘
```

### Key Rules

1. ✅ **Token Layer:** Stateless validation, NO session storage
2. ✅ **Session Layer:** Session lifecycle, DELEGATES token validation
3. ✅ **Shared Layer:** Common types, utilities, security
4. ❌ **Token Layer CANNOT:** Store sessions, manage session lifecycle
5. ❌ **Session Layer CANNOT:** Implement token validation, refresh logic

---

## Phase 1: Token Directory Refactoring

**Duration:** 3 days (24 hours)  
**Priority:** 🔴 CRITICAL  
**Risk:** Medium

### Current Problems

1. ❌ `SecureCacheManager` handles token caching (should be in shared)
2. ❌ `RefreshTokenManager` takes `sessionId` parameter (session awareness)
3. ❌ `TokenManager` has 22 methods (god interface)
4. ❌ No clear interfaces for different concerns
5. ❌ Token layer knows about sessions (tight coupling)

### 1.1: Delete SecureCacheManager (Use CacheService Directly)

**Action:** Remove redundant `SecureCacheManager` wrapper

**Problem:** `SecureCacheManager` is a thin wrapper on `CacheService` from `@libs/database`:

- CacheService already has: Multi-layer cache (L1: LRU, L2: Redis)
- Built-in: Warmup, circuit breaker, retry logic, compression
- SecureCacheManager adds: Only token prefixes and basic validation

**Solution:** Delete `SecureCacheManager` and use `CacheService` directly

**Files to Delete:**

```
src/services/token/SecureCacheManager.ts  ❌ DELETE
```

**Migration:**

```typescript
// BEFORE (using SecureCacheManager):
const cacheManager = new SecureCacheManager(true, metrics);
await cacheManager.set("jwt", tokenKey, validationResult, 300);
const result = await cacheManager.get<AuthResult>("jwt", tokenKey);

// AFTER (using CacheService directly):
import { CacheService } from "@libs/database";

const cacheService = CacheService.create(metrics);
const cacheKey = `jwt:${tokenKey}`;
await cacheService.set(cacheKey, validationResult, 300);
const result = await cacheService.get<AuthResult>(cacheKey);

export class CacheManager implements ICacheManager {
  constructor(
    private readonly adapter: ICacheAdapter,
    private readonly keyBuilder: CacheKeyBuilder,
    private readonly metrics?: IMetricsCollector
  ) {}

  async get<T>(key: string): Promise<CacheResult<T>> {
    const cacheKey = this.keyBuilder.build(key);
    return this.adapter.get<T>(cacheKey);
  }

  async set<T>(key: string, value: T, ttl: number): Promise<void> {
    const cacheKey = this.keyBuilder.build(key);
    return this.adapter.set(cacheKey, value, ttl);
  }
}
```

```typescript
// src/shared/cache/CacheKeyBuilder.ts
export class CacheKeyBuilder {
  private readonly prefix: string;

  constructor(prefix: string = "neurotracker") {
    this.prefix = prefix;
  }

  build(key: string, namespace?: string): string {
    const parts = [this.prefix];
    if (namespace) parts.push(namespace);

    // Simple keys: no hashing
    if (key.length <= 128 && /^[a-zA-Z0-9:_-]+$/.test(key)) {
      parts.push(key);
      return parts.join(":");
    }

    // Complex keys: hash for security
    const hash = crypto.createHash("sha256").update(key).digest("hex");
    parts.push(hash);
    return parts.join(":");
  }

  buildTokenKey(token: string): string {
    return this.build(token, "token");
  }

  buildSessionKey(sessionId: string): string {
    return this.build(sessionId, "session");
  }

  buildUserKey(userId: string): string {
    return this.build(userId, "user");
  }
}
```

**Migration Steps:**

1. ✅ Update JWTValidator to use CacheService directly
2. ✅ Update RefreshTokenManager to use CacheService directly
3. ✅ Delete `SecureCacheManager.ts`
4. ✅ Update all imports from SecureCacheManager → CacheService
5. ✅ Add cache key prefixes directly in calling code

**Estimated Time:** 2 hours

---

### 1.2: Remove Token Storage from Token Layer (Move to Session Layer)

**Time Estimate:** 6 hours

---

### 1.2: Remove Token Storage from Token Layer (Move to Session Layer)

**Problem:** Token layer should NOT store tokens - session layer should!

**Core Issue:**

- 🚫 **Token layer currently stores tokens** (RefreshTokenManager.storeTokensWithRefresh)
- 🚫 **Token layer knows about sessions** (takes sessionId parameter)
- ✅ **Token layer should ONLY:** Validate tokens, Refresh tokens via Keycloak
- ✅ **Session layer should:** Store tokens as part of session data

**Architecture Correction:**

```
┌──────────────────────────────────────────────────────────┐
│ TOKEN LAYER: Stateless Operations                       │
│  ✅ validateJwt(token) → AuthResult                     │
│  ✅ refreshToken(refreshToken) → TokenSet               │
│  ✅ extractClaims(token) → Claims                       │
│  ❌ storeTokens() - NO STORAGE!                         │
│  ❌ sessionId parameters - NO SESSION AWARENESS!        │
└──────────────────────────────────────────────────────────┘
                    ↑ uses
┌──────────────────────────────────────────────────────────┐
│ SESSION LAYER: Stateful Storage                         │
│  ✅ storeSession({ tokens, userId, sessionId, ... })    │
│  ✅ retrieveSession(sessionId) → SessionData            │
│  ✅ updateSessionTokens(sessionId, newTokens)           │
│  Uses TokenValidator for validation (delegation)        │
└──────────────────────────────────────────────────────────┘
```

**Current (WRONG):**

```typescript
// ❌ Token layer storing tokens
class RefreshTokenManager {
  async storeTokensWithRefresh(
    userId: string,
    sessionId: string, // Session awareness!
    accessToken: string,
    refreshToken: string
  ) {
    // Token layer storing in cache/database
    await this.cacheManager.set(cacheKey, tokens, ttl);
  }
}
```

**New (CORRECT):**

```typescript
// ✅ Token layer: Stateless refresh only
class TokenRefreshService {
  async refreshToken(refreshToken: string): Promise<TokenSet> {
    // Call Keycloak to refresh
    const response = await this.keycloakClient.refreshToken(refreshToken);

    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      expiresIn: response.expires_in,
      // ... return tokens, don't store
    };
  }
}

// ✅ Session layer: Handles storage
class SessionStore {
  async updateSessionTokens(
    sessionId: string,
    newTokens: TokenSet
  ): Promise<void> {
    const session = await this.retrieveSession(sessionId);

    session.accessToken = newTokens.accessToken;
    session.refreshToken = newTokens.refreshToken;
    session.expiresAt = new Date(Date.now() + newTokens.expiresIn * 1000);

    // Session layer stores in database + cache
    await this.storeSession(session);
  }
}
```

**Implementation:**

```typescript
// src/services/token/types/RefreshContext.ts
export interface RefreshContext {
  storageKey: string; // Generic identifier (no "session" in name)
  userId: string; // For user-specific operations
  refreshToken: string;
  metadata?: Record<string, unknown>; // Flexible metadata
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  expiresIn: number;
  refreshExpiresIn?: number;
  tokenType: string;
  scope: string;
}

export interface StoredTokenInfo {
  tokens: TokenSet;
  storageKey: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  refreshExpiresAt?: Date;
  refreshCount: number;
}
```

**Refactor `RefreshTokenManager`:**

```typescript
// src/services/token/RefreshTokenManager.ts
export class RefreshTokenManager {
  constructor(
    private readonly keycloakClient: KeycloakClient,
    private readonly cacheManager: ICacheManager, // ✅ Shared cache
    private readonly config: RefreshTokenConfig,
    private readonly eventHandlers: RefreshTokenEventHandlers = {},
    private readonly metrics?: IMetricsCollector
  ) {}

  /**
   * Refresh tokens using a generic storage key
   * Token layer doesn't know if it's a session, user, or device
   */
  async refreshTokens(context: RefreshContext): Promise<RefreshResult> {
    const startTime = performance.now();

    try {
      // Get stored tokens using generic key
      const storedInfo = await this.getStoredTokens(context.storageKey);
      if (!storedInfo) {
        return {
          success: false,
          error: "No stored tokens found",
          storageKey: context.storageKey,
          timestamp: new Date(),
        };
      }

      // Refresh using Keycloak
      const refreshResult = await this.keycloakClient.refreshToken(
        context.refreshToken || storedInfo.tokens.refreshToken
      );

      if (!refreshResult.access_token) {
        return {
          success: false,
          error: "Token refresh failed",
          storageKey: context.storageKey,
          timestamp: new Date(),
        };
      }

      // Store new tokens
      const newTokenSet: TokenSet = {
        accessToken: refreshResult.access_token,
        refreshToken:
          refreshResult.refresh_token || storedInfo.tokens.refreshToken,
        idToken: refreshResult.id_token,
        expiresIn: refreshResult.expires_in,
        refreshExpiresIn: refreshResult.refresh_expires_in,
        tokenType: "Bearer",
        scope: refreshResult.scope || storedInfo.tokens.scope,
      };

      await this.storeTokens(context.storageKey, context.userId, newTokenSet);

      // Fire event (generic)
      await this.eventHandlers.onTokenRefreshed?.(
        context.storageKey,
        newTokenSet
      );

      this.metrics?.recordCounter("token.refresh.success", 1);

      return {
        success: true,
        tokens: newTokenSet,
        storageKey: context.storageKey,
        timestamp: new Date(),
      };
    } catch (error) {
      this.logger.error("Token refresh failed", {
        error,
        storageKey: context.storageKey,
      });
      this.metrics?.recordCounter("token.refresh.error", 1);

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        storageKey: context.storageKey,
        timestamp: new Date(),
      };
    }
  }

  /**
   * Store tokens with generic storage key
   */
  async storeTokens(
    storageKey: string,
    userId: string,
    tokens: TokenSet
  ): Promise<void> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + tokens.expiresIn * 1000);
    const refreshExpiresAt = tokens.refreshExpiresIn
      ? new Date(now.getTime() + tokens.refreshExpiresIn * 1000)
      : undefined;

    const storedInfo: StoredTokenInfo = {
      tokens,
      storageKey,
      userId,
      createdAt: now,
      expiresAt,
      refreshExpiresAt,
      refreshCount: 0,
    };

    // Use shared cache with generic key
    const cacheKey = `refresh_tokens:${storageKey}`;
    const ttl = this.calculateCacheTtl(refreshExpiresAt, now);

    await this.cacheManager.set(cacheKey, storedInfo, ttl);

    // Fire event
    await this.eventHandlers.onTokenStored?.(storageKey, tokens);

    this.logger.info("Tokens stored", {
      storageKey,
      userId,
      expiresAt: expiresAt.toISOString(),
    });
  }

  /**
   * Get stored tokens by generic key
   */
  async getStoredTokens(storageKey: string): Promise<StoredTokenInfo | null> {
    const cacheKey = `refresh_tokens:${storageKey}`;
    const result = await this.cacheManager.get<StoredTokenInfo>(cacheKey);
    return result.data || null;
  }

  /**
   * Remove stored tokens
   */
  async removeStoredTokens(storageKey: string): Promise<void> {
    const cacheKey = `refresh_tokens:${storageKey}`;
    await this.cacheManager.invalidate(cacheKey);
    this.logger.debug("Stored tokens removed", { storageKey });
  }
}
```

**Migration Steps:**

1. ✅ Remove all token storage methods from RefreshTokenManager
2. ✅ Keep only `refreshToken(refreshToken: string): Promise<TokenSet>`
3. ✅ Move storage responsibility to SessionStore
4. ✅ Update SessionStore.storeSession() to handle token encryption
5. ✅ Update all callers to store via SessionStore instead

**Time Estimate:** 8 hours

---

### 1.3: Split RolePermissionExtractor (Extraction vs Authorization)

**Problem:** 22 methods in one interface (Interface Segregation Principle violation)

**New Structure:**

```typescript
// src/services/token/interfaces/ITokenValidator.ts
export interface ITokenValidator {
  /**
   * Validate JWT token using signature verification
   */
  validateJwt(token: string): Promise<AuthResult>;

  /**
   * Validate token using introspection endpoint
   */
  introspectToken(token: string): Promise<AuthResult>;

  /**
   * Validate token with fallback strategy
   */
  validateToken(token: string, useIntrospection?: boolean): Promise<AuthResult>;

  /**
   * Extract Bearer token from Authorization header
   */
  extractBearerToken(authorizationHeader?: string): string | null;
}
```

```typescript
// src/services/token/interfaces/ITokenRefreshService.ts
export interface ITokenRefreshService {
  /**
   * Refresh tokens using storage key
   */
  refreshTokens(context: RefreshContext): Promise<RefreshResult>;

  /**
   * Get stored tokens
   */
  getStoredTokens(storageKey: string): Promise<StoredTokenInfo | null>;

  /**
   * Check if tokens are valid
   */
  hasValidStoredTokens(storageKey: string): Promise<boolean>;

  /**
   * Remove stored tokens
   */
  removeStoredTokens(storageKey: string): Promise<void>;
}
```

```typescript
// src/services/token/interfaces/IAuthorizationChecker.ts
export interface IAuthorizationChecker {
  /**
   * Check if user has specific role
   */
  hasRole(authResult: AuthResult, role: string): boolean;

  /**
   * Check if user has any of the required roles
   */
  hasAnyRole(authResult: AuthResult, requiredRoles: string[]): boolean;

  /**
   * Check if user has all required roles
   */
  hasAllRoles(authResult: AuthResult, requiredRoles: string[]): boolean;

  /**
   * Check if user has specific permission
   */
  hasPermission(authResult: AuthResult, permission: string): boolean;

  /**
   * Check if user has any of the required permissions
   */
  hasAnyPermission(
    authResult: AuthResult,
    requiredPermissions: string[]
  ): boolean;

  /**
   * Check if user has all required permissions
   */
  hasAllPermissions(
    authResult: AuthResult,
    requiredPermissions: string[]
  ): boolean;

  /**
   * Check if token is expired
   */
  isTokenExpired(authResult: AuthResult): boolean;

  /**
   * Get remaining token lifetime in seconds
   */
  getTokenLifetime(authResult: AuthResult): number;

  /**
   * Check if token will expire soon
   */
  willExpireSoon(authResult: AuthResult, withinSeconds: number): boolean;
}
```

```typescript
// src/services/token/TokenManager.ts (refactored)
export class TokenManager
  implements ITokenValidator, ITokenRefreshService, IAuthorizationChecker
{
  constructor(
    private readonly jwtValidator: JWTValidator,
    private readonly refreshManager: RefreshTokenManager,
    private readonly authChecker: RolePermissionExtractor,
    private readonly cacheManager: ICacheManager,
    private readonly config: TokenConfig,
    private readonly metrics?: IMetricsCollector
  ) {}

  // Implement ITokenValidator
  async validateJwt(token: string): Promise<AuthResult> {
    return this.jwtValidator.validateJWT(token);
  }

  async introspectToken(token: string): Promise<AuthResult> {
    return this.keycloakClient.introspectToken(token);
  }

  async validateToken(
    token: string,
    useIntrospection = false
  ): Promise<AuthResult> {
    // Implementation with fallback strategy
  }

  extractBearerToken(authorizationHeader?: string): string | null {
    // Implementation
  }

  // Implement ITokenRefreshService
  async refreshTokens(context: RefreshContext): Promise<RefreshResult> {
    return this.refreshManager.refreshTokens(context);
  }

  async getStoredTokens(storageKey: string): Promise<StoredTokenInfo | null> {
    return this.refreshManager.getStoredTokens(storageKey);
  }

  async hasValidStoredTokens(storageKey: string): Promise<boolean> {
    const tokens = await this.getStoredTokens(storageKey);
    if (!tokens) return false;
    return tokens.expiresAt > new Date();
  }

  async removeStoredTokens(storageKey: string): Promise<void> {
    return this.refreshManager.removeStoredTokens(storageKey);
  }

  // Implement IAuthorizationChecker (delegate to RolePermissionExtractor)
  hasRole(authResult: AuthResult, role: string): boolean {
    return this.authChecker.hasRole(authResult, role);
  }

  hasAnyRole(authResult: AuthResult, requiredRoles: string[]): boolean {
    return this.authChecker.hasAnyRole(authResult, requiredRoles);
  }

  // ... other authorization methods (delegate)
}
```

**Export Segregated Interfaces:**

```typescript
// src/services/token/index.ts
export { TokenManager } from "./TokenManager";

// Export interfaces for dependency injection
export type { ITokenValidator } from "./interfaces/ITokenValidator";
export type { ITokenRefreshService } from "./interfaces/ITokenRefreshService";
export type { IAuthorizationChecker } from "./interfaces/IAuthorizationChecker";

// Export factory functions
export function createTokenValidator(
  config: TokenConfig,
  metrics?: IMetricsCollector
): ITokenValidator {
  return new TokenManager(/* ... */);
}

export function createTokenRefreshService(
  config: TokenConfig,
  metrics?: IMetricsCollector
): ITokenRefreshService {
  return new TokenManager(/* ... */);
}

export function createAuthorizationChecker(): IAuthorizationChecker {
  return new TokenManager(/* ... */);
}
```

**Migration Steps:**

1. ✅ Create interface files
2. ✅ Refactor TokenManager to implement interfaces
3. ✅ Add factory functions for each interface
4. ✅ Update session layer to use specific interfaces
5. ✅ Update tests to use segregated interfaces

**Time Estimate:** 6 hours

---

### 1.4: Remove Token Configuration Duplication

**Action:** Use shared configuration

**New Structure:**

```typescript
// src/shared/config/TokenConfig.ts
export interface TokenConfig {
  validation: {
    issuer: string;
    audience?: string;
    jwksUrl?: string;
    strict: boolean;
  };
  refresh: {
    enabled: boolean;
    threshold: number; // seconds before expiry
    maxAttempts: number;
    retryDelay: number; // milliseconds
  };
  cache: {
    enabled: boolean;
    ttl: {
      validation: number; // seconds
      introspection: number; // seconds
      refresh: number; // seconds
    };
  };
}
```

**Migration Steps:**

1. ✅ Create shared `TokenConfig` interface
2. ✅ Remove duplicated configs from token services
3. ✅ Update all token services to use shared config
4. ✅ Validate configuration at startup

**Time Estimate:** 4 hours

---

### Token Directory Final Structure

```
src/services/token/
├── interfaces/
│   ├── ITokenValidator.ts
│   ├── ITokenRefreshService.ts
│   └── IAuthorizationChecker.ts
│
├── TokenManager.ts              # Main orchestrator
├── JWTValidator.ts              # JWT signature validation
├── RefreshTokenManager.ts       # Token refresh (no session awareness)
├── RolePermissionExtractor.ts   # Authorization checks
│
├── types/
│   ├── RefreshContext.ts        # Generic refresh context
│   ├── TokenSet.ts              # Token data structure
│   └── StoredTokenInfo.ts       # Storage structure
│
└── index.ts                     # Public API

REMOVED:
❌ SecureCacheManager.ts (moved to shared)
❌ config.ts (moved to shared)
```

---

## Phase 2: Session Directory Refactoring

**Duration:** 4 days (32 hours)  
**Priority:** 🔴 CRITICAL  
**Risk:** High (many dependencies)

### Current Problems

1. ❌ `SessionTokenManager` duplicates token logic (200+ lines commented)
2. ❌ Session layer makes direct HTTP calls to Keycloak
3. ❌ Session validation uses hardcoded `{ isValid: true }`
4. ❌ No dependency injection (direct instantiation)
5. ❌ Session layer handles token caching (wrong responsibility)

### 2.1: Delete SessionTokenManager

**Action:** Remove entire file, create `SessionTokenCoordinator`

**Rationale:**

- SessionTokenManager tries to do token operations (wrong layer)
- 200+ lines of commented code (confusion)
- Duplicates TokenManager functionality
- Session layer should DELEGATE, not implement

**New Component:**

```typescript
// src/services/session/SessionTokenCoordinator.ts
/**
 * SessionTokenCoordinator
 *
 * Responsibility: Coordinate token operations for sessions
 * Does NOT: Validate tokens, refresh tokens, encrypt tokens
 * Does: Delegate to TokenManager, map results to session context
 */
export class SessionTokenCoordinator {
  constructor(
    private readonly tokenValidator: ITokenValidator,
    private readonly tokenRefreshService: ITokenRefreshService,
    private readonly logger?: ILogger,
    private readonly metrics?: IMetricsCollector
  ) {}

  /**
   * Check if session tokens need refresh
   * Delegates validation to TokenManager
   */
  async checkTokenRefreshNeeded(
    sessionData: KeycloakSessionData
  ): Promise<{ needsRefresh: boolean; canRefresh: boolean; reason?: string }> {
    const startTime = performance.now();

    try {
      // No token available
      if (!sessionData.accessToken) {
        return {
          needsRefresh: true,
          canRefresh: !!sessionData.refreshToken,
          reason: "no_access_token",
        };
      }

      // Delegate validation to TokenManager (don't duplicate)
      const authResult = await this.tokenValidator.validateJwt(
        sessionData.accessToken
      );

      // Check if token is expired or will expire soon
      const needsRefresh =
        !authResult.success ||
        (authResult.expiresAt &&
          this.willExpireSoon(authResult.expiresAt, 300));

      this.metrics?.recordTimer(
        "session.token_refresh_check.duration",
        performance.now() - startTime
      );

      return {
        needsRefresh,
        canRefresh: !!sessionData.refreshToken,
        reason: !authResult.success ? authResult.error : undefined,
      };
    } catch (error) {
      this.logger.error("Token refresh check failed", {
        error,
        sessionId: sessionData.id,
      });
      return {
        needsRefresh: true,
        canRefresh: !!sessionData.refreshToken,
        reason: "check_failed",
      };
    }
  }

  /**
   * Refresh tokens for a session
   * Delegates to TokenManager
   */
  async refreshSessionTokens(
    sessionData: KeycloakSessionData
  ): Promise<RefreshResult> {
    if (!sessionData.refreshToken) {
      throw new Error("No refresh token available");
    }

    // Create refresh context (generic, no session-specific details)
    const context: RefreshContext = {
      storageKey: sessionData.id, // Use session ID as storage key
      userId: sessionData.userId,
      refreshToken: sessionData.refreshToken,
      metadata: {
        sessionCreatedAt: sessionData.createdAt,
        lastAccessed: sessionData.lastAccessedAt,
      },
    };

    // Delegate to TokenManager
    const result = await this.tokenRefreshService.refreshTokens(context);

    this.metrics?.recordCounter("session.tokens_refreshed", 1, {
      success: result.success.toString(),
    });

    return result;
  }

  /**
   * Validate session access token
   * Delegates to TokenManager
   */
  async validateSessionToken(
    sessionData: KeycloakSessionData
  ): Promise<AuthResult> {
    if (!sessionData.accessToken) {
      return {
        success: false,
        error: "No access token in session",
      };
    }

    // Delegate to TokenManager
    return this.tokenValidator.validateJwt(sessionData.accessToken);
  }

  /**
   * Check if token will expire soon
   */
  private willExpireSoon(expiresAt: Date, bufferSeconds: number): boolean {
    const now = new Date();
    const expiresIn = (expiresAt.getTime() - now.getTime()) / 1000;
    return expiresIn <= bufferSeconds;
  }
}
```

**Migration Steps:**

1. ✅ Create `SessionTokenCoordinator.ts`
2. ✅ Update `SessionValidator` to use coordinator
3. ✅ Update `SessionManager` to use coordinator
4. ✅ Delete `SessionTokenManager.ts` (backup first)
5. ✅ Update all imports
6. ✅ Update tests

**Time Estimate:** 8 hours

---

### 2.2: Fix SessionValidator Token Validation

**Problem:** Uses hardcoded `{ isValid: true }`

**Current (WRONG):**

```typescript
// SessionTokenManager.ts (commented out)
// const validation = await this.validateToken(sessionData.accessToken);

// Hardcoded mock!
const validation = {
  isValid: true,
  shouldRefresh: false,
  reason: undefined,
};
```

**New (CORRECT):**

```typescript
// src/services/session/SessionValidator.ts
export class SessionValidator {
  constructor(
    private readonly tokenCoordinator: SessionTokenCoordinator, // ✅ Inject
    private readonly logger?: ILogger,
    private readonly metrics?: IMetricsCollector,
    private readonly config?: SessionValidatorConfig
  ) {}

  /**
   * Validate session with actual token validation
   */
  async validateSession(
    sessionData: KeycloakSessionData,
    currentRequest?: {
      ipAddress: string;
      userAgent: string;
      fingerprint?: SessionFingerprint;
    }
  ): Promise<SessionValidationResult> {
    const startTime = performance.now();

    try {
      // 1. Basic session checks
      if (!sessionData.isActive) {
        return this.createValidationResult(false, "session_inactive");
      }

      // 2. Expiration checks
      const expirationResult = this.validateExpiration(sessionData);
      if (!expirationResult.isValid) {
        return expirationResult;
      }

      // 3. Idle timeout checks
      const idleResult = this.validateIdleTimeout(sessionData);
      if (!idleResult.isValid) {
        return idleResult;
      }

      // 4. Token validation (DELEGATE to token layer)
      const tokenValidation = await this.tokenCoordinator.validateSessionToken(
        sessionData
      );

      if (!tokenValidation.success) {
        this.metrics?.recordCounter("session.validation.token_invalid", 1);

        return this.createValidationResult(false, "invalid_token", {
          message: tokenValidation.error,
          shouldRefreshToken: !!sessionData.refreshToken,
        });
      }

      // 5. Check if token needs refresh
      const refreshCheck = await this.tokenCoordinator.checkTokenRefreshNeeded(
        sessionData
      );

      if (refreshCheck.needsRefresh && refreshCheck.canRefresh) {
        return this.createValidationResult(true, undefined, {
          shouldRefreshToken: true,
          message: "Token refresh recommended",
        });
      }

      // 6. Security checks (if request context provided)
      if (currentRequest) {
        const securityResult = await this.performSecurityChecks(
          sessionData,
          currentRequest
        );
        if (!securityResult.isValid) {
          return this.createValidationResult(false, "security_check_failed", {
            message: securityResult.message,
            shouldTerminate: securityResult.shouldTerminate,
          });
        }
      }

      this.metrics?.recordTimer(
        "session.validate.duration",
        performance.now() - startTime
      );

      return this.createValidationResult(true);
    } catch (error) {
      this.logger.error("Session validation failed", { error });
      return this.createValidationResult(false, "validation_error");
    }
  }
}
```

**Migration Steps:**

1. ✅ Inject `SessionTokenCoordinator` into `SessionValidator`
2. ✅ Replace hardcoded validation with actual token validation
3. ✅ Add proper error handling
4. ✅ Update tests with mocked coordinator
5. ✅ Verify all validation paths

**Time Estimate:** 6 hours

---

### 2.3: Remove Session Caching Logic

**Problem:** Session layer manages cache (should use shared cache)

**Action:** Replace direct cache management with shared `CacheManager`

**Current (WRONG):**

```typescript
// SessionStore.ts
if (this.cacheService && this.config.cacheEnabled) {
  const cacheKey = this.buildSessionCacheKey(sessionData.id);
  await this.cacheService.set(cacheKey, sessionData, ttl);
}
```

**New (CORRECT):**

```typescript
// SessionStore.ts
export class SessionStore {
  constructor(
    private readonly dbClient: PostgreSQLClient,
    private readonly cacheManager: ICacheManager, // ✅ Shared cache
    private readonly keyBuilder: CacheKeyBuilder, // ✅ Shared key builder
    private readonly logger?: ILogger,
    private readonly metrics?: IMetricsCollector,
    private readonly config?: SessionStoreConfig
  ) {}

  async storeSession(sessionData: KeycloakSessionData): Promise<void> {
    // Store in database
    await this.dbClient.executeRaw(/* ... */);

    // Store in cache using shared manager
    const cacheKey = this.keyBuilder.buildSessionKey(sessionData.id);
    const ttl = Math.floor(
      (sessionData.expiresAt.getTime() - Date.now()) / 1000
    );

    if (ttl > 0) {
      await this.cacheManager.set(cacheKey, sessionData, ttl);
    }

    this.metrics?.recordCounter("session.stored", 1);
  }

  async retrieveSession(
    sessionId: string
  ): Promise<KeycloakSessionData | null> {
    // Check cache first
    const cacheKey = this.keyBuilder.buildSessionKey(sessionId);
    const cachedResult = await this.cacheManager.get<KeycloakSessionData>(
      cacheKey
    );

    if (cachedResult.hit && cachedResult.data) {
      this.metrics?.recordCounter("session.cache_hit", 1);
      return cachedResult.data;
    }

    // Fallback to database
    const rows = await this.dbClient.cachedQuery<
      SessionDatabaseRow[]
    >(/* ... */);

    if (!rows.length) {
      this.metrics?.recordCounter("session.not_found", 1);
      return null;
    }

    const sessionData = this.mapRowToSessionData(rows[0]);

    // Update cache
    const ttl = Math.floor(
      (sessionData.expiresAt.getTime() - Date.now()) / 1000
    );
    if (ttl > 0) {
      await this.cacheManager.set(cacheKey, sessionData, ttl);
    }

    this.metrics?.recordCounter("session.cache_miss", 1);
    return sessionData;
  }
}
```

**Migration Steps:**

1. ✅ Update `SessionStore` constructor to use shared `CacheManager`
2. ✅ Replace all cache operations with shared manager
3. ✅ Use `CacheKeyBuilder` for key generation
4. ✅ Remove custom cache key methods
5. ✅ Update tests

**Time Estimate:** 4 hours

---

### 2.4: Inject Dependencies (Dependency Inversion)

**Problem:** Services create dependencies directly (tight coupling)

**Action:** Use constructor injection for all dependencies

**Current (WRONG):**

```typescript
// KeycloakSessionManager.ts
export class KeycloakSessionManager {
  constructor(
    dbClient: PostgreSQLClient,
    cacheService?: CacheService,
    logger?: ILogger,
    metrics?: IMetricsCollector,
    config?: KeycloakSessionManagerConfig
  ) {
    // Creates dependencies directly
    this.sessionStore = new SessionStore(dbClient, cacheService);
    this.tokenManager = new SessionTokenManager();
    this.sessionValidator = new SessionValidator();
  }
}
```

**New (CORRECT):**

```typescript
// KeycloakSessionManager.ts
export class KeycloakSessionManager {
  constructor(
    private readonly sessionStore: SessionStore, // ✅ Injected
    private readonly tokenCoordinator: SessionTokenCoordinator, // ✅ Injected
    private readonly sessionValidator: SessionValidator, // ✅ Injected
    private readonly sessionSecurity: SessionSecurity, // ✅ Injected
    private readonly sessionMetrics: SessionMetrics, // ✅ Injected
    private readonly sessionCleaner?: SessionCleaner, // ✅ Injected
    private readonly keycloakClient?: KeycloakClient, // ✅ Injected
    private readonly logger?: ILogger,
    private readonly metrics?: IMetricsCollector,
    private readonly config?: KeycloakSessionManagerConfig
  ) {}
}
```

**Factory Function:**

```typescript
// src/services/session/factories/createSessionManager.ts
export function createSessionManager(
  dbClient: PostgreSQLClient,
  tokenValidator: ITokenValidator,
  tokenRefreshService: ITokenRefreshService,
  cacheManager: ICacheManager,
  config: SessionConfig,
  logger?: ILogger,
  metrics?: IMetricsCollector
): KeycloakSessionManager {
  // Create dependencies
  const keyBuilder = new CacheKeyBuilder("neurotracker");

  const sessionStore = new SessionStore(
    dbClient,
    cacheManager,
    keyBuilder,
    logger,
    metrics,
    config.store
  );

  const tokenCoordinator = new SessionTokenCoordinator(
    tokenValidator,
    tokenRefreshService,
    logger,
    metrics
  );

  const sessionValidator = new SessionValidator(
    tokenCoordinator,
    logger,
    metrics,
    config.validator
  );

  const sessionSecurity = new SessionSecurity(
    cacheManager,
    logger,
    metrics,
    config.security
  );

  const sessionMetrics = new SessionMetrics(logger, metrics, config.metrics);

  const sessionCleaner = config.enableCleaner
    ? new SessionCleaner(
        dbClient,
        cacheManager,
        logger,
        metrics,
        config.cleaner
      )
    : undefined;

  // Assemble manager
  return new KeycloakSessionManager(
    sessionStore,
    tokenCoordinator,
    sessionValidator,
    sessionSecurity,
    sessionMetrics,
    sessionCleaner,
    undefined, // keycloakClient (not needed)
    logger,
    metrics,
    config
  );
}
```

**Migration Steps:**

1. ✅ Update all session components to use constructor injection
2. ✅ Create factory function for `KeycloakSessionManager`
3. ✅ Update tests to use dependency injection
4. ✅ Remove direct instantiation of dependencies
5. ✅ Verify all components are injectable

**Time Estimate:** 6 hours

---

### 2.5: Create Type Adapters

**Problem:** Session types incompatible with token types

**Action:** Create adapter utilities in shared layer

```typescript
// src/shared/adapters/TypeAdapters.ts
import type { AuthResult, UserInfo } from "../types/common";
import type { KeycloakSessionData } from "../../services/session/sessionTypes";
import type { RefreshResult } from "../../services/token/types/RefreshContext";

/**
 * Convert AuthResult to session-friendly format
 */
export function authResultToSessionData(
  authResult: AuthResult,
  sessionId: string,
  requestContext: {
    ipAddress: string;
    userAgent: string;
    fingerprint: string;
  }
): Partial<KeycloakSessionData> {
  if (!authResult.success || !authResult.user) {
    throw new Error("Cannot create session data from failed auth result");
  }

  return {
    userId: authResult.user.id,
    userInfo: authResult.user,
    tokenExpiresAt: authResult.expiresAt,
    ipAddress: requestContext.ipAddress,
    userAgent: requestContext.userAgent,
    fingerprint: requestContext.fingerprint,
  };
}

/**
 * Update session with refreshed tokens
 */
export function applyTokenRefreshToSession(
  sessionData: KeycloakSessionData,
  refreshResult: RefreshResult
): KeycloakSessionData {
  if (!refreshResult.success || !refreshResult.tokens) {
    return sessionData;
  }

  return {
    ...sessionData,
    accessToken: refreshResult.tokens.accessToken,
    refreshToken: refreshResult.tokens.refreshToken,
    idToken: refreshResult.tokens.idToken,
    tokenExpiresAt: new Date(
      Date.now() + refreshResult.tokens.expiresIn * 1000
    ),
    refreshExpiresAt: refreshResult.tokens.refreshExpiresIn
      ? new Date(Date.now() + refreshResult.tokens.refreshExpiresIn * 1000)
      : undefined,
    lastAccessedAt: new Date(),
  };
}

/**
 * Check if session token needs refresh
 */
export function shouldRefreshSessionToken(
  sessionData: KeycloakSessionData,
  bufferSeconds: number = 300
): boolean {
  if (!sessionData.tokenExpiresAt) {
    return true;
  }

  const now = new Date();
  const expiresIn =
    (sessionData.tokenExpiresAt.getTime() - now.getTime()) / 1000;
  return expiresIn <= bufferSeconds;
}

/**
 * Extract user info from AuthResult
 */
export function extractUserInfo(authResult: AuthResult): UserInfo | null {
  if (!authResult.success || !authResult.user) {
    return null;
  }

  return authResult.user;
}
```

**Migration Steps:**

1. ✅ Create `TypeAdapters.ts` in shared layer
2. ✅ Update session components to use adapters
3. ✅ Add tests for all adapter functions
4. ✅ Document adapter usage

**Time Estimate:** 4 hours

---

### 2.6: Remove Direct Keycloak Calls

**Problem:** Session layer makes HTTP calls to Keycloak

**Action:** Session layer should never call Keycloak directly

**Before (WRONG):**

```typescript
// Session layer making HTTP calls
const response = await fetch(tokenEndpoint, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: formData,
});
```

**After (CORRECT):**

```typescript
// Session layer delegates to token layer
const refreshResult = await this.tokenCoordinator.refreshSessionTokens(
  sessionData
);
```

**Migration Steps:**

1. ✅ Remove all `fetch` calls from session layer
2. ✅ Replace with token coordinator methods
3. ✅ Remove Keycloak URL construction
4. ✅ Verify no direct HTTP dependencies

**Time Estimate:** 4 hours

---

### Session Directory Final Structure

```
src/services/session/
├── SessionStore.ts                   # Database/cache operations
├── SessionTokenCoordinator.ts        # Token coordination (delegates to token layer)
├── SessionValidator.ts               # Session validation (uses coordinator)
├── SessionSecurity.ts                # Security enforcement
├── SessionMetrics.ts                 # Metrics collection
├── SessionCleaner.ts                 # Maintenance
├── KeycloakSessionManager.ts         # Main orchestrator
│
├── factories/
│   └── createSessionManager.ts       # Factory function
│
├── types/
│   └── sessionTypes.ts               # Session-specific types
│
└── index.ts                          # Public API

REMOVED:
❌ SessionTokenManager.ts (replaced by SessionTokenCoordinator)
```

---

## Phase 3: Shared Directory Creation

**Duration:** 2 days (16 hours)  
**Priority:** 🟠 HIGH  
**Risk:** Low

### 3.1: Create Shared Structure

```
src/shared/
├── cache/
│   ├── CacheManager.ts              # Generic cache interface
│   ├── RedisCacheAdapter.ts         # Redis implementation
│   ├── MemoryCacheAdapter.ts        # Fallback
│   ├── CacheKeyBuilder.ts           # Key generation
│   └── index.ts
│
├── config/
│   ├── UnifiedAuthConfig.ts         # Single config
│   ├── TokenConfig.ts               # Token configuration
│   ├── SessionConfig.ts             # Session configuration
│   ├── configDefaults.ts            # Default values
│   ├── configValidation.ts          # Zod validation
│   └── index.ts
│
├── security/
│   ├── EncryptionKeyManager.ts      # Key management
│   ├── EncryptionManager.ts         # Existing
│   └── index.ts
│
├── types/
│   ├── common.ts                    # AuthResult, UserInfo
│   ├── config.ts                    # Config types
│   ├── cache.ts                     # Cache types
│   └── index.ts
│
├── adapters/
│   ├── TypeAdapters.ts              # Type conversions
│   └── index.ts
│
├── utils/
│   ├── HashingUtils.ts              # Shared hashing
│   ├── TimeUtils.ts                 # Time constants
│   └── index.ts
│
└── constants/
    ├── time.ts                      # Time constants
    ├── security.ts                  # Security constants
    └── index.ts
```

### 3.2: Shared Constants

```typescript
// src/shared/constants/time.ts
export const ONE_SECOND_MS = 1000;
export const ONE_MINUTE_MS = 60 * ONE_SECOND_MS;
export const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;
export const ONE_DAY_MS = 24 * ONE_HOUR_MS;
export const ONE_WEEK_MS = 7 * ONE_DAY_MS;

export const DEFAULT_SESSION_TIMEOUT = ONE_DAY_MS;
export const DEFAULT_IDLE_TIMEOUT = 4 * ONE_HOUR_MS;
export const DEFAULT_TOKEN_REFRESH_BUFFER = 5 * ONE_MINUTE_MS;
```

```typescript
// src/shared/constants/security.ts
export const DEFAULT_ENCRYPTION_ALGORITHM = "aes-256-gcm";
export const DEFAULT_KEY_DERIVATION_ITERATIONS = 100000;
export const MINIMUM_ENCRYPTION_KEY_LENGTH = 32;
export const DEFAULT_HASH_ROUNDS = 12;
```

### 3.3: Unified Configuration

```typescript
// src/shared/config/UnifiedAuthConfig.ts
export interface UnifiedAuthConfig {
  keycloak: {
    serverUrl: string;
    realm: string;
    clientId: string;
    clientSecret?: string;
  };

  token: TokenConfig;
  session: SessionConfig;
  cache: CacheConfig;
  encryption: EncryptionConfig;
  security: SecurityConfig;
}

export interface CacheConfig {
  enabled: boolean;
  adapter: "redis" | "memory";
  redis?: {
    url: string;
    db?: number;
  };
  ttl: {
    token: number;
    session: number;
    userInfo: number;
  };
}

export interface EncryptionConfig {
  enabled: boolean;
  key: string;
  algorithm: "aes-256-gcm";
  keyDerivation: {
    iterations: number;
    algorithm: "pbkdf2";
  };
}

export interface SecurityConfig {
  tokenReplayProtection: boolean;
  sessionRotationInterval: number;
  suspiciousActivityThreshold: number;
  maxConcurrentSessions: number;
}
```

**Migration Steps:**

1. ✅ Create shared directory structure
2. ✅ Move common types to shared
3. ✅ Create unified configuration
4. ✅ Move cache manager to shared
5. ✅ Create shared utilities
6. ✅ Update all imports

**Time Estimate:** 16 hours

---

## Phase 4: Integration & Testing

**Duration:** 3 days (24 hours)  
**Priority:** 🟠 HIGH  
**Risk:** High

### 4.1: Update All Imports

**Action:** Update imports across codebase

```bash
# Before
import { SecureCacheManager } from '../token/SecureCacheManager';
import { AuthResult } from '../../types';

# After
import { CacheManager } from '@shared/cache';
import { AuthResult } from '@shared/types';
```

### 4.2: Create Integration Tests

```typescript
// tests/integration/token-session-integration.test.ts
describe("Token-Session Integration", () => {
  let tokenManager: ITokenValidator;
  let sessionManager: KeycloakSessionManager;
  let cacheManager: ICacheManager;

  beforeEach(async () => {
    // Setup
    const config = createTestConfig();
    cacheManager = createCacheManager(config.cache);

    tokenManager = createTokenValidator(config.token);
    sessionManager = createSessionManager(
      mockDbClient,
      tokenManager,
      createTokenRefreshService(config.token),
      cacheManager,
      config.session
    );
  });

  it("should create session with valid token", async () => {
    // Test integration
  });

  it("should validate session using token layer", async () => {
    // Test delegation
  });

  it("should refresh session tokens", async () => {
    // Test refresh coordination
  });
});
```

### 4.3: Update Documentation

**Create:**

- Architecture diagrams
- Data flow diagrams
- API documentation
- Migration guide

**Time Estimate:** 24 hours

---

## Migration Strategy

### Backward Compatibility

**Phase 1: Parallel Implementation**

```typescript
// Keep old code working while adding new
export { SessionTokenManager } from "./legacy/SessionTokenManager";
export { SessionTokenCoordinator } from "./SessionTokenCoordinator";

// Deprecation warning
/** @deprecated Use SessionTokenCoordinator instead */
export class SessionTokenManager {
  constructor() {
    console.warn(
      "SessionTokenManager is deprecated. Use SessionTokenCoordinator."
    );
  }
}
```

**Phase 2: Migration Period**

- Run both implementations side-by-side
- Compare results
- Fix discrepancies
- Monitor metrics

**Phase 3: Cutover**

- Switch to new implementation
- Remove deprecated code
- Update all consumers

### Rollback Plan

1. Keep old code in `legacy/` directory
2. Feature flag for new implementation
3. Metrics comparison
4. Quick rollback if issues

---

## Success Metrics

### Separation of Concerns

- ✅ Token layer has zero session imports
- ✅ Session layer has zero token implementation
- ✅ All shared code in `shared/` directory

### Type Safety

- ✅ Zero `any` types in public APIs
- ✅ Type adapters for all conversions
- ✅ No runtime type errors

### Testability

- ✅ All components have > 80% coverage
- ✅ Integration tests pass
- ✅ Mocking is straightforward

### Performance

- ✅ < 10ms for cached token validation
- ✅ < 50ms for session validation
- ✅ < 200ms for token refresh

### Code Quality

- ✅ < 500 lines per file
- ✅ < 10 methods per class
- ✅ < 5 dependencies per component

---

## Timeline Summary

| Phase                          | Duration    | Start     | End        | Status         |
| ------------------------------ | ----------- | --------- | ---------- | -------------- |
| Phase 1: Token Refactoring     | 3 days      | Day 1     | Day 3      | 🔴 Not Started |
| Phase 2: Session Refactoring   | 4 days      | Day 4     | Day 7      | 🔴 Not Started |
| Phase 3: Shared Directory      | 2 days      | Day 8     | Day 9      | 🔴 Not Started |
| Phase 4: Integration & Testing | 3 days      | Day 10    | Day 12     | 🔴 Not Started |
| **Total**                      | **12 days** | **Day 1** | **Day 12** | 🔴 Not Started |

---

## Risk Assessment

### High Risk Items

1. 🔴 Session layer refactoring (many dependencies)
2. 🔴 Type adapter correctness (data integrity)
3. 🔴 Cache migration (performance impact)

### Mitigation Strategies

1. Parallel implementation with fallback
2. Comprehensive integration tests
3. Gradual rollout with metrics monitoring
4. Quick rollback capability

---

## Next Steps

1. ✅ Review this action plan with team
2. ✅ Set up feature flags
3. ✅ Create backup branches
4. ✅ Start Phase 1: Token Directory Refactoring
5. ✅ Monitor metrics throughout migration

---

**Document Version:** 1.0  
**Last Updated:** October 1, 2025  
**Status:** 📋 READY FOR REVIEW
