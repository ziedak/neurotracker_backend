# Quick Reference: Separation of Concerns

**Date:** October 1, 2025

---

## 🎯 Core Principle: Strict Layer Separation

```
┌──────────────────────────────────────────────┐
│              SHARED LAYER                    │
│  • Types (AuthResult, UserInfo)             │
│  • Cache Manager (generic caching)          │
│  • Encryption (key management)              │
│  • Type Adapters (conversions)              │
│  • Utilities (hashing, time)                │
│  • Configuration (unified config)           │
└────────────┬─────────────────┬───────────────┘
             │                 │
    ┌────────┴────────┐  ┌────┴─────────────┐
    │  TOKEN LAYER    │  │  SESSION LAYER   │
    └─────────────────┘  └──────────────────┘
```

---

## Token Layer Responsibilities

### ✅ WHAT TOKEN LAYER SHOULD DO

1. **Validate JWT tokens**
   - Signature verification
   - Expiration checks
   - Claims extraction
2. **Refresh tokens**

   - Use generic storage keys (not "sessionId")
   - Store tokens with refresh capability
   - Manage token lifecycle

3. **Check authorization**

   - Role checking
   - Permission checking
   - Token expiry checking

4. **Token operations**
   - Extract Bearer tokens
   - Parse JWT claims
   - Token introspection

### ❌ WHAT TOKEN LAYER SHOULD NOT DO

1. **NO session management**

   - Don't create sessions
   - Don't store sessions
   - Don't validate sessions

2. **NO session-specific caching**

   - Use generic cache keys
   - No "session:" prefixes
   - Use shared CacheManager

3. **NO session lifecycle**

   - Don't track session creation
   - Don't manage session expiry
   - Don't handle session cleanup

4. **NO direct session references**
   - No `sessionId` parameters (use `storageKey`)
   - No `SessionData` types
   - No session-specific logic

---

## Session Layer Responsibilities

### ✅ WHAT SESSION LAYER SHOULD DO

1. **Manage session lifecycle**

   - Create sessions
   - Store sessions
   - Destroy sessions

2. **Validate sessions**

   - Check session expiry
   - Validate fingerprints
   - Security checks

3. **Track session state**

   - Last accessed time
   - Active/inactive status
   - Session metadata

4. **Coordinate with token layer**
   - Delegate token validation to TokenManager
   - Delegate token refresh to TokenManager
   - Use token results to update session

### ❌ WHAT SESSION LAYER SHOULD NOT DO

1. **NO token validation implementation**

   - Don't implement JWT validation
   - Don't verify signatures
   - Don't parse tokens

2. **NO token refresh implementation**

   - Don't call Keycloak directly
   - Don't construct OAuth2 requests
   - Don't manage token lifecycle

3. **NO direct HTTP calls to Keycloak**

   - Use TokenManager instead
   - Delegate all token operations
   - No `fetch()` calls

4. **NO token storage/encryption**
   - Session stores references, not implementations
   - Token encryption is token layer concern
   - Use token layer for storage

---

## Shared Layer Responsibilities

### ✅ WHAT SHARED LAYER PROVIDES

1. **Common types**

   ```typescript
   AuthResult;
   UserInfo;
   UnifiedAuthConfig;
   ```

2. **Generic caching**

   ```typescript
   CacheManager (no layer-specific logic)
   CacheKeyBuilder (generic keys)
   ```

3. **Type adapters**

   ```typescript
   authResultToSessionData();
   applyTokenRefreshToSession();
   ```

4. **Security utilities**

   ```typescript
   EncryptionManager;
   EncryptionKeyManager;
   ```

5. **Constants**
   ```typescript
   ONE_MINUTE_MS;
   DEFAULT_SESSION_TIMEOUT;
   ```

---

## Communication Patterns

### Token Layer → Session Layer: ❌ FORBIDDEN

```typescript
// Token layer should NEVER import from session
import { SessionData } from "@session/types"; // ❌ WRONG!
```

### Session Layer → Token Layer: ✅ ALLOWED (Delegation)

```typescript
// Session layer delegates to token layer
import { ITokenValidator } from "@token/interfaces"; // ✅ CORRECT

class SessionValidator {
  constructor(private tokenValidator: ITokenValidator) {}

  async validateSession(session: SessionData) {
    // Delegate token validation
    const authResult = await this.tokenValidator.validateJwt(
      session.accessToken
    );

    // Use result in session context
    if (!authResult.success) {
      return { isValid: false, reason: "invalid_token" };
    }
  }
}
```

### Both Layers → Shared: ✅ ALLOWED

```typescript
// Both layers can use shared utilities
import { CacheManager } from "@shared/cache"; // ✅ CORRECT
import { AuthResult } from "@shared/types"; // ✅ CORRECT
import { TypeAdapters } from "@shared/adapters"; // ✅ CORRECT
```

---

## Dependency Injection Patterns

### Token Layer Factory

```typescript
export function createTokenValidator(
  config: TokenConfig,
  cacheManager: ICacheManager,
  metrics?: IMetricsCollector
): ITokenValidator {
  const jwtValidator = new JWTValidator(
    config.validation.jwksUrl,
    config.validation.issuer,
    config.validation.audience,
    metrics,
    cacheManager
  );

  return new TokenManager(
    jwtValidator
    /* other dependencies */
  );
}
```

### Session Layer Factory

```typescript
export function createSessionManager(
  dbClient: PostgreSQLClient,
  tokenValidator: ITokenValidator, // ✅ Injected from token layer
  tokenRefreshService: ITokenRefreshService, // ✅ Injected from token layer
  cacheManager: ICacheManager, // ✅ Shared cache
  config: SessionConfig
): KeycloakSessionManager {
  const tokenCoordinator = new SessionTokenCoordinator(
    tokenValidator, // ✅ Uses injected token services
    tokenRefreshService
  );

  const sessionValidator = new SessionValidator(
    tokenCoordinator // ✅ Delegates to coordinator
  );

  return new KeycloakSessionManager(
    sessionStore,
    tokenCoordinator,
    sessionValidator
    /* other components */
  );
}
```

---

## Data Flow Example

### Token Validation Flow

```
┌─────────────────────────────────────────────────────────┐
│ 1. Request comes in with JWT token                     │
└────────────────────────┬────────────────────────────────┘
                         │
         ┌───────────────┴────────────────┐
         │ SessionValidator               │
         │ (Session Layer)                │
         └───────────────┬────────────────┘
                         │ delegates to
         ┌───────────────┴────────────────┐
         │ SessionTokenCoordinator        │
         │ (Session Layer)                │
         └───────────────┬────────────────┘
                         │ delegates to
         ┌───────────────┴────────────────┐
         │ TokenManager                   │
         │ (Token Layer)                  │
         └───────────────┬────────────────┘
                         │ uses
         ┌───────────────┴────────────────┐
         │ JWTValidator                   │
         │ (Token Layer)                  │
         └───────────────┬────────────────┘
                         │ returns
                  ┌──────┴──────┐
                  │ AuthResult  │
                  └──────┬──────┘
                         │ flows back through layers
         ┌───────────────┴────────────────┐
         │ SessionValidator               │
         │ Uses AuthResult to determine   │
         │ session validity               │
         └────────────────────────────────┘
```

### Token Refresh Flow

```
┌─────────────────────────────────────────────────────────┐
│ 1. Session token expires soon                          │
└────────────────────────┬────────────────────────────────┘
                         │
         ┌───────────────┴────────────────┐
         │ SessionTokenCoordinator        │
         │ checkTokenRefreshNeeded()      │
         └───────────────┬────────────────┘
                         │ calls
         ┌───────────────┴────────────────┐
         │ TokenRefreshService            │
         │ refreshTokens(RefreshContext)  │
         └───────────────┬────────────────┘
                         │ uses
         ┌───────────────┴────────────────┐
         │ RefreshTokenManager            │
         │ (Token Layer - NO session      │
         │  awareness, uses storageKey)   │
         └───────────────┬────────────────┘
                         │ calls
         ┌───────────────┴────────────────┐
         │ KeycloakClient                 │
         │ (HTTP to Keycloak)             │
         └───────────────┬────────────────┘
                         │ returns
                  ┌──────┴──────┐
                  │ TokenSet    │
                  └──────┬──────┘
                         │ flows back
         ┌───────────────┴────────────────┐
         │ SessionStore                   │
         │ Updates session with new tokens│
         └────────────────────────────────┘
```

---

## Checklist for New Code

### Before Adding Token Code

- [ ] Does this code validate tokens? → Token Layer
- [ ] Does this code refresh tokens? → Token Layer
- [ ] Does this code check roles/permissions? → Token Layer
- [ ] Does this code parse JWT claims? → Token Layer
- [ ] Does this code need session context? → Use generic `storageKey`

### Before Adding Session Code

- [ ] Does this code manage session lifecycle? → Session Layer
- [ ] Does this code validate sessions? → Session Layer
- [ ] Does this code need token validation? → Delegate to TokenManager
- [ ] Does this code need token refresh? → Delegate to TokenManager
- [ ] Does this code store tokens? → Store reference, not implementation

### Before Adding Shared Code

- [ ] Is this used by both layers? → Shared Layer
- [ ] Is this a common type? → Shared Layer
- [ ] Is this generic caching? → Shared Layer
- [ ] Is this type conversion? → Shared Layer
- [ ] Is this a utility function? → Shared Layer

---

## Common Mistakes to Avoid

### ❌ WRONG: Token Layer with Session Awareness

```typescript
// token/RefreshTokenManager.ts
async refreshUserTokens(
  userId: string,
  sessionId: string  // ❌ Token layer shouldn't know about sessions
) {
  // ...
}
```

### ✅ CORRECT: Token Layer with Generic Storage

```typescript
// token/RefreshTokenManager.ts
async refreshTokens(
  context: RefreshContext  // ✅ Generic context
) {
  const storageKey = context.storageKey;  // ✅ Could be anything
  // ...
}
```

---

### ❌ WRONG: Session Layer Implementing Token Logic

```typescript
// session/SessionTokenManager.ts
async validateToken(token: string) {
  // ❌ Session layer implementing JWT validation
  const decoded = jwt.decode(token);
  // ... token validation logic ...
}
```

### ✅ CORRECT: Session Layer Delegating to Token Layer

```typescript
// session/SessionTokenCoordinator.ts
async validateSessionToken(session: SessionData) {
  // ✅ Delegate to token layer
  return this.tokenValidator.validateJwt(session.accessToken);
}
```

---

### ❌ WRONG: Direct HTTP Calls in Session Layer

```typescript
// session/SessionTokenManager.ts
async refreshAccessToken() {
  // ❌ Session layer making HTTP calls to Keycloak
  const response = await fetch(tokenEndpoint, { ... });
}
```

### ✅ CORRECT: Delegation to Token Layer

```typescript
// session/SessionTokenCoordinator.ts
async refreshSessionTokens(session: SessionData) {
  // ✅ Delegate to token layer
  const context: RefreshContext = {
    storageKey: session.id,
    userId: session.userId,
    refreshToken: session.refreshToken,
  };
  return this.tokenRefreshService.refreshTokens(context);
}
```

---

### ❌ WRONG: Layer-Specific Cache Manager

```typescript
// token/SecureCacheManager.ts
class SecureCacheManager {
  // ❌ Token-specific cache implementation
  async cacheToken(token: string) { ... }
}
```

### ✅ CORRECT: Shared Generic Cache Manager

```typescript
// shared/cache/CacheManager.ts
class CacheManager {
  // ✅ Generic caching (no layer-specific logic)
  async set<T>(key: string, value: T, ttl: number) { ... }
}
```

---

## Testing Patterns

### Token Layer Tests (NO Session Mocks)

```typescript
describe("TokenManager", () => {
  let tokenManager: ITokenValidator;
  let mockCache: ICacheManager;

  beforeEach(() => {
    mockCache = createMockCache();
    tokenManager = createTokenValidator(config, mockCache);
  });

  it("should validate JWT token", async () => {
    // ✅ Test token validation
    // ❌ NO session-specific logic
    const result = await tokenManager.validateJwt(validToken);
    expect(result.success).toBe(true);
  });
});
```

### Session Layer Tests (Mock Token Services)

```typescript
describe("SessionValidator", () => {
  let sessionValidator: SessionValidator;
  let mockTokenValidator: ITokenValidator;

  beforeEach(() => {
    mockTokenValidator = createMockTokenValidator();
    sessionValidator = new SessionValidator(
      new SessionTokenCoordinator(mockTokenValidator, mockRefreshService)
    );
  });

  it("should validate session using token layer", async () => {
    // ✅ Mock token validation
    mockTokenValidator.validateJwt.mockResolvedValue({
      success: true,
      user: mockUser,
    });

    const result = await sessionValidator.validateSession(mockSession);

    // ✅ Verify delegation
    expect(mockTokenValidator.validateJwt).toHaveBeenCalledWith(
      mockSession.accessToken
    );
  });
});
```

---

## Quick Decision Tree

```
┌─────────────────────────────────────┐
│ Need to add new functionality?     │
└────────────┬────────────────────────┘
             │
    ┌────────┴─────────┐
    │ What does it do? │
    └────────┬─────────┘
             │
    ┌────────┴─────────────────────────────────────┐
    │                                              │
    ▼                                              ▼
┌────────────────┐                     ┌─────────────────┐
│ Token-related? │                     │ Session-related?│
└────────┬───────┘                     └────────┬────────┘
         │                                      │
         ├─ Validate token? → Token Layer      ├─ Create session? → Session Layer
         ├─ Refresh token?  → Token Layer      ├─ Validate session? → Session Layer
         ├─ Check roles?    → Token Layer      ├─ Track session? → Session Layer
         ├─ Parse JWT?      → Token Layer      ├─ Check fingerprint? → Session Layer
         │                                      │
         └─ But needs session context?         └─ But needs token validation?
            → Use generic storageKey                → Delegate to Token Layer
            → NO session-specific logic             → DON'T implement token logic
```

---

## Directory Structure Quick Reference

```
src/
├── shared/              ← Common code used by both layers
│   ├── cache/          ← Generic caching (no layer logic)
│   ├── config/         ← Unified configuration
│   ├── security/       ← Encryption, key management
│   ├── types/          ← Common types (AuthResult, etc)
│   ├── adapters/       ← Type conversions between layers
│   ├── utils/          ← Generic utilities
│   └── constants/      ← Shared constants
│
├── services/
│   ├── token/          ← Token validation, refresh, authorization
│   │   ├── interfaces/    ← ITokenValidator, ITokenRefreshService
│   │   ├── TokenManager.ts
│   │   ├── JWTValidator.ts
│   │   ├── RefreshTokenManager.ts  ← NO session awareness!
│   │   └── RolePermissionExtractor.ts
│   │
│   └── session/        ← Session lifecycle, validation, security
│       ├── SessionStore.ts
│       ├── SessionTokenCoordinator.ts  ← Delegates to token layer
│       ├── SessionValidator.ts         ← Uses coordinator
│       ├── SessionSecurity.ts
│       ├── SessionMetrics.ts
│       ├── SessionCleaner.ts
│       └── KeycloakSessionManager.ts
```

---

## Import Rules

### ✅ ALLOWED Imports

```typescript
// Token layer can import from shared
import { CacheManager } from '@shared/cache';           ✅
import { AuthResult } from '@shared/types';             ✅

// Session layer can import from token (interfaces only)
import { ITokenValidator } from '@token/interfaces';    ✅
import { ITokenRefreshService } from '@token/interfaces'; ✅

// Session layer can import from shared
import { CacheManager } from '@shared/cache';           ✅
import { TypeAdapters } from '@shared/adapters';        ✅

// Both layers can import from shared
import { UnifiedAuthConfig } from '@shared/config';     ✅
```

### ❌ FORBIDDEN Imports

```typescript
// Token layer CANNOT import from session
import { SessionData } from '@session/types';           ❌
import { SessionStore } from '@session/SessionStore';   ❌

// Session layer CANNOT import token implementations
import { JWTValidator } from '@token/JWTValidator';     ❌
import { RefreshTokenManager } from '@token/RefreshTokenManager'; ❌

// Only import interfaces from token layer:
import { ITokenValidator } from '@token/interfaces';    ✅
```

---

**Quick Reference Version:** 1.0  
**Last Updated:** October 1, 2025  
**See Also:** REFACTORING_ACTION_PLAN.md
