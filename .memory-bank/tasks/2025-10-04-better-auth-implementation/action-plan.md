# Task: Better-Auth Library Implementation

**Date**: 2025-10-04  
**Status**: Active  
**Priority**: High  
**Risk Level**: Low-Medium

---

## 🔴 CRITICAL ACTION PLAN CORRECTION

**Date**: 2025-10-05  
**Issue**: Skipped core service layer - went directly to middleware implementation

### The Correct Architecture (From Functional Spec)

```
Request → Middleware → Services → Better-Auth APIs → Database
         (extract)    (business   (framework)
                      logic)
```

**NOT** the incomplete architecture I was building:

```
Request → Middleware → Better-Auth APIs → Database
         (extract +   (framework)
          business
          logic)
```

### What I Got Wrong

1. **❌ WRONG**: Services are "optional wrappers"
   **✅ CORRECT**: Services are **core business logic layer** providing authentication operations

2. **❌ WRONG**: Middleware call `auth.api.getSession()` directly
   **✅ CORRECT**: Middleware call **services**, services call Better-Auth APIs

3. **❌ WRONG**: Phase 2 is implementing middleware
   **✅ CORRECT**: Phase 2 is implementing **services** (sign-up, sign-in, sign-out, refresh, revoke, sessions)

4. **❌ WRONG**: Start with middleware (Session ✅, Bearer ✅)
   **✅ CORRECT**: Start with services, THEN build middleware on top

### Current Gap - Missing Core Services

**What's Missing** (From Functional Spec Section 3-7):

- ❌ `PasswordAuthService`: sign-up, sign-in, sign-out, password reset, email verification
- ❌ `BearerTokenService`: validate, revoke bearer tokens, token refresh
- ❌ `JWTService`: get JWT, verify, validate claims, JWKS management
- ❌ `ApiKeyService`: create, verify, update, delete, list API keys
- ❌ `SessionService`: get, list, **revoke**, update activity, enforce limits
- ❌ `OrganizationService`: manage organizations, members, teams

**What I Built** (Incomplete - middleware without service layer):

- ✅ Session middleware (but calls Better-Auth directly - missing service layer)
- ✅ Bearer middleware (but calls Better-Auth directly - missing service layer)

### Corrected Phase Structure

**Phase 1** (COMPLETE ✅): Foundation - AuthLibrary + Plugin Configuration  
**Phase 2** (NOT STARTED ❌): **Core Services** - Authentication operations

- ⏳ PasswordAuthService (sign-up, sign-in, sign-out, password management)
- ⏳ SessionService (get, list, **revoke**, **refresh**, activity tracking)
- ⏳ BearerTokenService (validate, **revoke**, extract)
- ⏳ JWTService (generate, verify, JWKS, **refresh**)
- ⏳ ApiKeyService (create, verify, update, delete, permissions)

**Phase 3** (NOT STARTED ❌): **Middleware** - Extract credentials, call services

- ⏳ Session middleware → calls SessionService
- ⏳ Bearer middleware → calls BearerTokenService
- ⏳ JWT middleware → calls JWTService
- ⏳ API Key middleware → calls ApiKeyService

**Phase 4** (PENDING): WebSocket, optimization, @libs integration  
**Phase 5** (PENDING): Elysia plugin, testing, documentation

---

## Objective

Implement production-ready Better-Auth authentication library in `libs/better-auth` following the comprehensive functional specification. The library provides **thin wrappers** around Better-Auth native APIs, NOT custom authentication implementations.

**CRITICAL ARCHITECTURAL PRINCIPLE**:

> This is an **INTEGRATION project**, not a custom authentication system. We use Better-Auth plugins (Bearer, JWT, API Key, Organization) directly through their native APIs. Middleware extract credentials and call `auth.api.getSession({ headers })`. Services wrap Better-Auth plugin methods. We do NOT implement custom authentication logic.

## Success Criteria

- [ ] Better-Auth core installed with Prisma adapter
- [ ] All plugins configured (Bearer, JWT, API Key, Organization, 2FA, Multi-Session)
- [ ] **4 middleware components** calling Better-Auth APIs directly (Session ✅, Bearer ✅, JWT ⏳, API Key ⏳)
- [ ] WebSocket authentication handler using Better-Auth validation
- [ ] Integration with @libs/\* infrastructure (ratelimit, database, monitoring, utils)
- [ ] Elysia plugin for easy integration
- [ ] > 90% test coverage (~160+ tests)
- [ ] Production-ready error handling and monitoring
- [ ] Complete documentation (README, ARCHITECTURE, API)
- [ ] Performance targets met (session validation <50ms P95)
- [ ] Zero critical security vulnerabilities

## Strategy: Integration Over Implementation

**Key Insight**: This is an **INTEGRATION project**, not a custom authentication build. We orchestrate Better-Auth framework with existing infrastructure.

**What Better-Auth Provides (Use Directly)**:

- ✅ Complete user/session/password management
- ✅ Bearer token authentication via `bearer()` plugin
- ✅ JWT with JWKS via `jwt()` plugin
- ✅ API key management via `apiKey()` plugin (rate limiting, permissions, expiration)
- ✅ Organization/team/role management via `organization()` plugin
- ✅ Two-factor authentication via `twoFactor()` plugin
- ✅ Multi-session support via `multiSession()` plugin

**What We Build (Thin Integration Layer)**:

- Configuration builder (`BetterAuthConfigBuilder`) ✅ DONE
- Middleware that call `auth.api.getSession({ headers })`:
  - Session middleware ✅ DONE (18 tests)
  - Bearer middleware ✅ DONE (25 tests)
  - JWT middleware ⏳ NEXT (targeting ~25 tests)
  - API Key middleware ⏳ AFTER JWT (targeting ~25 tests)
- WebSocket handler using Better-Auth validation
- Elysia plugin for easy integration
- Route protection utilities

**What Existing Infrastructure Provides**:

- ✅ @libs/ratelimit - Enterprise-grade rate limiting (DO NOT DUPLICATE)
- ✅ @libs/elysia-server - Production middleware (CORS, logging, errors)
- ✅ @libs/database - Prisma client, repositories, CacheService
- ✅ @libs/monitoring - MetricsCollector, structured logging
- ✅ @libs/utils - executeWithRetry, circuit breaker patterns

**Critical Architecture Rules**:

1. **Middleware Pattern**: Extract credential → Call `auth.api.getSession()` → Attach response to context
2. **NO Custom Auth Logic**: Use Better-Auth plugin methods exclusively
3. **Services Are Optional**: Only needed for complex multi-step business logic
4. **Use @libs Infrastructure**: Never duplicate rate limiting, caching, monitoring

---

### Phase 2: Core Authentication Services (Day 2) - **CURRENT PRIORITY**

**Objective**: Implement core service layer providing authentication operations (sign-up, sign-in, **refresh**, **revoke**, session management)

**Timeline**: 8-10 hours  
**Complexity**: Medium

**Dependencies**:

- Phase 1 completed (AuthLibrary with Better-Auth configured)
- Redis available for caching
- @libs/monitoring available for metrics

**CRITICAL**: These services are the **business logic layer** between middleware and Better-Auth. They:

- Call Better-Auth APIs
- Handle caching and performance optimization
- Integrate monitoring and metrics
- Provide token refresh and revocation
- Manage session lifecycle

**Sub-tasks**:

1. **PasswordAuthService** (2h)

   Create `services/password-auth.service.ts` with:

   - `signUp(email, password, name, metadata)` → calls `auth.api.signUp.email()`
   - `signIn(email, password)` → calls `auth.api.signIn.email()`
   - `signOut(sessionToken)` → calls `auth.api.signOut()`
   - `forgetPassword(email)` → calls Better-Auth password reset
   - `resetPassword(token, newPassword)` → completes password reset
   - `changePassword(userId, currentPassword, newPassword)` → password change
   - `verifyEmail(token)` → email verification

   **Integration**:

   - Cache user lookup with @libs/database CacheService
   - Record metrics with @libs/monitoring
   - Use executeWithRetry for database operations

2. **SessionService** (2h) - **CRITICAL FOR REVOKE/REFRESH**

   Create `services/session.service.ts` with:

   - `getSession(sessionToken)` → calls `auth.api.getSession()` with caching
   - `listUserSessions(userId)` → gets all active sessions
   - **`revokeSession(sessionId)`** → revokes specific session, invalidates cache
   - **`revokeAllUserSessions(userId)`** → signs out all devices
   - **`refreshSession(sessionToken)`** → extends session expiration
   - `updateSessionActivity(sessionToken)` → updates last activity timestamp
   - `enforceSessionLimit(userId, maxSessions)` → limits concurrent sessions
   - `getSessionMetadata(sessionId)` → gets IP, user agent, etc.
   - `isSessionActive(sessionId)` → checks validity

   **Integration**:

   - Multi-layer caching (L1: memory 5min, L2: Redis 30min)
   - Invalidate cache on revoke/logout
   - Record session metrics (active sessions, revocations)

3. **BearerTokenService** (2h) - **CRITICAL FOR BEARER AUTH**

   Create `services/bearer-token.service.ts` with:

   - `extractBearerToken(request)` → extracts from Authorization header
   - `validateBearerToken(token)` → calls `auth.api.getSession()` with Bearer token
   - `getSessionFromBearer(token)` → retrieves session from Bearer token
   - **`revokeBearerSession(token)`** → revokes session tied to Bearer token
   - `handleBearerResponse(response)` → extracts `set-auth-token` header

   **Integration**:

   - Cache Bearer token validations (5min TTL)
   - Integrate with SessionService for revocation
   - Record Bearer auth metrics

4. **JWTService** (2h) - **CRITICAL FOR JWT + REFRESH**

   Create `services/jwt.service.ts` with:

   - `getJWTFromSession(sessionToken)` → calls `/api/auth/token` endpoint
   - `extractJWTFromHeaders(response)` → gets JWT from `set-auth-jwt` header
   - **`verifyJWT(jwt)`** → verifies using JWKS public key (jose library)
   - **`refreshJWT(refreshToken)`** → generates new JWT from refresh token
   - `getJWKS()` → fetches from `/api/auth/jwks` endpoint
   - `cacheJWKS()` → caches JWKS (24 hour TTL)
   - `validateJWTClaims(jwt)` → checks issuer, audience, expiration
   - `refreshJWKSIfNeeded(kid)` → refetches if key ID not found

   **Integration**:

   - Cache JWKS aggressively (1 hour L1, 24 hours L2)
   - Cache JWT validations (until expiration)
   - Record JWT metrics (verifications, cache hits)

5. **ApiKeyService** (2h)

   Create `services/api-key.service.ts` with:

   - `createApiKey(name, expiresIn, prefix, metadata, permissions)` → creates via Better-Auth
   - `verifyApiKey(key, requiredPermissions?)` → validates and checks permissions
   - `getApiKey(keyId)` → retrieves details (without key value)
   - `updateApiKey(keyId, updates)` → updates name/permissions
   - `deleteApiKey(keyId)` → deletes key (checks ownership)
   - `listApiKeys(userId)` → lists user's keys
   - `revokeApiKey(keyId)` → revokes key, invalidates cache
   - `checkApiKeyPermissions(key, permissions)` → validates permissions

   **Integration**:

   - Cache API key validations (5min TTL)
   - Integrate @libs/ratelimit for per-key rate limiting
   - Record API key usage metrics

**Testing** (2h):

- Unit tests for each service (~20 tests per service = ~100 tests)
- Test caching behavior (hits, misses, invalidation)
- Test error handling and retry logic
- Test metrics integration
- **Test revoke/refresh operations**

**Deliverables**:

- ⏳ PasswordAuthService complete with tests
- ⏳ SessionService complete with **revoke** and **refresh** operations
- ⏳ BearerTokenService complete with token management
- ⏳ JWTService complete with JWKS and **refresh** support
- ⏳ ApiKeyService complete with permissions
- ⏳ ~100 service tests passing
- ⏳ Caching integrated and tested
- ⏳ Monitoring integrated

**Validation**:

```bash
# Test services directly
const sessionService = new SessionService(auth, cache, metrics);
await sessionService.revokeSession(sessionId);  # Should invalidate cache

const jwtService = new JWTService(auth, cache, metrics);
const newJWT = await jwtService.refreshJWT(refreshToken);  # Should generate new JWT

# All service tests passing
pnpm test services/  # Should show ~100 tests passing
```

---

### Phase 2.5: Refactor Existing Middleware to Use Services (Day 3)

**Objective**: Refactor the middleware I already created to use the service layer

**Timeline**: 2-3 hours  
**Complexity**: Low

**What Needs Refactoring**:

1. **Session Middleware** (Currently: calls `auth.api.getSession()` directly)

   - Refactor to call `SessionService.getSession()`
   - Benefits: Gets caching, metrics, retry logic from service

2. **Bearer Middleware** (Currently: calls `auth.api.getSession()` directly)
   - Refactor to call `BearerTokenService.validateBearerToken()`
   - Benefits: Gets caching, metrics from service

**Correct Pattern**:

```typescript
// OLD (what I built):
const session = await auth.api.getSession({ headers });

// NEW (correct with service layer):
const session = await sessionService.getSession(sessionToken);
```

---

### Phase 3: Remaining Middleware Components (Day 3-4)

**Objective**: Install Better-Auth, configure with Prisma, set up basic authentication flow

**Timeline**: 6-8 hours  
**Complexity**: Low

**Dependencies**:

- Existing Prisma schema in @libs/database
- Environment configuration system
- Monitoring infrastructure

**Sub-tasks**:

1. **Install Better-Auth Dependencies** (1h)

   - Install `better-auth` package and required peer dependencies
   - Install plugin packages: `@better-auth/bearer`, `@better-auth/jwt`, `@better-auth/api-key`, `@better-auth/organization`
   - Configure package.json with proper versions
   - Verify compatibility with Bun runtime

2. **Project Structure Setup** (1h)

   ```
   libs/better-auth/src/
   ├── config/              # Configuration builders
   │   ├── auth.config.ts   # Better-Auth configuration
   │   └── plugins.config.ts # Plugin configurations
   ├── core/                # Core services
   │   └── AuthLibrary.ts   # Main auth library class
   ├── services/            # Auth services
   │   ├── password-auth.service.ts
   │   ├── bearer-token.service.ts
   │   ├── jwt.service.ts
   │   ├── api-key.service.ts
   │   ├── session.service.ts
   │   └── organization.service.ts
   ├── middleware/          # Elysia middleware
   │   ├── session.middleware.ts
   │   ├── bearer.middleware.ts
   │   ├── jwt.middleware.ts
   │   └── api-key.middleware.ts
   ├── websocket/           # WebSocket handlers
   │   └── ws-auth.handler.ts
   ├── utils/               # Utilities
   │   ├── errors.ts
   │   └── validators.ts
   ├── types/               # TypeScript types
   │   └── index.ts
   └── index.ts             # Public exports
   ```

3. **Prisma Schema Integration** (2h)

   - Verify existing User, Session, ApiKey models in @libs/database
   - Add Better-Auth required fields if missing (use Prisma migrations)
   - Configure Better-Auth Prisma adapter
   - Test database connectivity

4. **Better-Auth Core Configuration** (2h)

   - Create `AuthLibrary` class as main entry point
   - Configure Better-Auth with Prisma adapter
   - Set up environment-based configuration
   - Implement basic authentication flow (email/password)
   - Configure session management with cookies

5. **Initial Testing** (2h)
   - Create test setup with Jest
   - Write unit tests for AuthLibrary initialization
   - Test basic sign-up/sign-in flows
   - Verify session creation and validation
   - Test error handling

**Deliverables**:

- ✅ Better-Auth installed and configured
- ✅ Basic email/password authentication working
- ✅ Session management functional
- ✅ Initial test suite passing
- ✅ Project structure established

**Validation**:

```bash
# User can register
POST /api/auth/sign-up/email

# User can login
POST /api/auth/sign-in/email

# Session is validated
GET /api/auth/session
```

---

### Phase 2: Middleware Components (Day 2)

**Objective**: Implement middleware that call Better-Auth APIs directly for authentication validation

**Timeline**: 6-8 hours  
**Complexity**: Low-Medium

**Dependencies**:

- Phase 1 completed (AuthLibrary with Better-Auth instance)
- Redis available for token caching

**CRITICAL ARCHITECTURAL PRINCIPLE**:

> **Middleware are thin wrappers** that extract credentials and call Better-Auth native APIs. They do NOT implement custom authentication logic. They call `auth.api.getSession({ headers })` and attach the response unchanged to Elysia context.

**Sub-tasks**:

1. **Session Middleware** (COMPLETED ✅)

   - ✅ `createSessionMiddleware()` - Required authentication
   - ✅ `createOptionalSessionMiddleware()` - Non-blocking authentication
   - ✅ Uses `auth.api.getSession({ headers })` directly
   - ✅ Type-safe with `UserWithPermissions` interface
   - ✅ 18/18 tests passing

2. **Bearer Middleware** (COMPLETED ✅)

   - ✅ `createBearerMiddleware()` - Required Bearer token authentication
   - ✅ `createOptionalBearerMiddleware()` - Non-blocking Bearer authentication
   - ✅ `extractBearerToken()` - Token extraction helper
   - ✅ Calls `auth.api.getSession({ headers })` for validation
   - ✅ 25/25 tests passing

3. **JWT Middleware** (NEXT - 2h)

   - Create `jwt.middleware.ts` with:
     - `createJWTMiddleware(auth, options)` - Required JWT authentication
     - `createOptionalJWTMiddleware(auth, options)` - Non-blocking JWT authentication
     - `extractJWT(request)` - Extract JWT from Authorization header
   - **CRITICAL**: Use Better-Auth JWT plugin APIs directly
   - Call `auth.api.getSession({ headers })` with JWT token
   - Verify JWT signature using JWKS from Better-Auth
   - Validate JWT claims (issuer, audience, expiration)
   - Support custom header names
   - Path bypass for health checks
   - Optional logging
   - **DO NOT implement custom JWT verification**
   - **DO NOT write JWT decoding logic**
   - **USE Better-Auth JWT plugin exclusively**

4. **API Key Middleware** (2h)

   - Create `api-key.middleware.ts` with:
     - `createApiKeyMiddleware(auth, options)` - Required API key authentication
     - `createOptionalApiKeyMiddleware(auth, options)` - Non-blocking API key authentication
     - `extractApiKey(request)` - Extract from x-api-key header
   - **CRITICAL**: Use Better-Auth API Key plugin directly
   - Call Better-Auth `verifyApiKey` API
   - Check API key permissions/scopes
   - Support custom header names
   - Path bypass support
   - Optional logging
   - **DO NOT implement custom API key validation**
   - **USE Better-Auth API Key plugin exclusively**

5. **Testing & Validation** (2h)
   - Write comprehensive tests for JWT middleware (~25 tests)
   - Write comprehensive tests for API Key middleware (~25 tests)
   - Test JWT validation (valid/expired/invalid signatures)
   - Test JWKS integration
   - Test API key validation (valid/revoked/expired)
   - Test permission checking
   - Performance testing (target: <30ms JWT validation P95)

**Deliverables**:

- ✅ Session middleware working (COMPLETE)
- ✅ Bearer middleware working (COMPLETE)
- ⏳ JWT middleware working (NEXT)
- ⏳ API Key middleware working (AFTER JWT)
- ✅ All middleware call Better-Auth APIs directly
- ⏳ Test coverage >90% (target: ~114 tests when complete)

**Validation**:

```bash
# JWT authentication
GET /protected -H "Authorization: Bearer JWT_TOKEN"

# API Key authentication
GET /protected -H "x-api-key: YOUR_API_KEY"

# JWKS endpoint (provided by Better-Auth)
GET /api/auth/jwks

# All middleware tests passing
pnpm test  # Should show ~114 tests passing
```

**Architecture Pattern** (ALL middleware follow this):

```typescript
// 1. Extract credential
const token = extractCredential(context.request, options);

// 2. Validate with Better-Auth (NO custom logic)
const session = await auth.api.getSession({ headers });

// 3. Attach unchanged to context
context["session"] = session.session;
context["user"] = session.user;
```

---

### Phase 3: Plugin Configuration & Services (Day 3)

**Objective**: Configure Better-Auth plugins (already done in Phase 1) and create optional service wrappers for complex operations

**Timeline**: 4-6 hours  
**Complexity**: Medium

**Dependencies**:

- Phase 2 completed (all middleware working)
- Better-Auth plugins already configured in `auth.config.ts`

**ARCHITECTURAL CLARIFICATION**:

> Better-Auth plugins (Bearer, JWT, API Key, Organization) are **already configured** in Phase 1's `BetterAuthConfigBuilder`. Phase 3 focuses on:
>
> 1. **Optional service wrappers** for complex multi-step operations
> 2. **Integration with @libs/ratelimit** for rate limiting
> 3. **Testing organization and API key management flows**

**Sub-tasks**:

1. **Service Wrappers for Complex Operations** (2h) **(OPTIONAL - NOT REQUIRED)**

   - Create `services/organization.service.ts` (if needed for complex org operations)
   - Create `services/api-key.service.ts` (if needed for custom key management logic)
   - **IMPORTANT**: Services call Better-Auth plugin methods directly, NOT custom implementation
   - Examples:
     ```typescript
     // Organization service wraps Better-Auth organization plugin
     class OrganizationService {
       async createOrganization(userId: string, name: string) {
         // Call Better-Auth directly
         return auth.api.organization.create({ userId, name });
       }
     }
     ```

2. **Rate Limiting Integration with @libs/ratelimit** (2h)

   - Integrate @libs/ratelimit with auth endpoints
   - Configure per-method rate limits:
     - Login: 5 requests/15min per IP
     - API Key: 10,000 requests/min per key
     - JWT: Stateless (no rate limit needed)
     - Organization operations: 100 requests/min per user
   - Add distributed rate limiting coordination
   - Implement circuit breaker patterns from @libs/utils
   - **USE @libs/ratelimit - DO NOT implement custom rate limiting**

3. **Organization & API Key Testing** (2h)
   - Test organization creation via Better-Auth plugin
   - Test member invitation flow
   - Test role assignment
   - Test API key creation via Better-Auth plugin
   - Test API key permissions validation
   - Test API key expiration
   - **Test Better-Auth native features, not custom implementations**

**Deliverables**:

- ⏳ Optional service wrappers (if needed for business logic)
- ⏳ Rate limiting fully integrated with @libs/ratelimit
- ⏳ Organization plugin tested end-to-end
- ⏳ API Key plugin tested end-to-end
- ⏳ All tests passing (~140+ tests total)

**Validation**:

```bash
# Organization operations (via Better-Auth)
POST /api/auth/organization  # Create org
POST /api/auth/organization/:id/invite  # Invite member

# API Key operations (via Better-Auth)
POST /api/auth/api-key  # Create key
GET /api/auth/api-key  # List keys

# Rate limiting enforcement
# Should block after 5 login attempts
for i in {1..6}; do curl POST /api/auth/sign-in/email; done
```

**Critical Principle**:

- ✅ Better-Auth plugins provide all authentication functionality
- ✅ Services are thin wrappers for business logic only
- ✅ Middleware call Better-Auth APIs directly
- ❌ NO custom authentication/validation logic
- ❌ NO reinventing Better-Auth features

---

### Phase 4: WebSocket Authentication & Optimization (Day 4)

**Objective**: Implement WebSocket authentication handler, optimize caching, integrate monitoring

**Timeline**: 6-8 hours  
**Complexity**: Medium-High

**Dependencies**:

- Phase 3 completed
- All @libs/\* infrastructure available

**Sub-tasks**:

1. **WebSocket Authentication Handler** (3h)

   - Create `websocket/ws-auth.handler.ts` with `WebSocketAuthHandler` class
   - Implement authentication methods:
     - `authenticateWithSessionCookie()` - Use Better-Auth session validation
     - `authenticateWithBearerToken()` - Use Better-Auth bearer validation
     - `authenticateWithJWT()` - Use Better-Auth JWT validation
     - `authenticateWithApiKey()` - Use Better-Auth API key validation
   - **CRITICAL**: Call `auth.api.getSession({ headers })` for all methods
   - Implement connection management:
     - `registerConnection(userId, sessionId, ws)`
     - `deregisterConnection(ws)`
     - `validateConnectionSession(ws, sessionId)`
   - Add heartbeat/keepalive (30-second ping interval)
   - Add authentication timeout (10 seconds)
   - Add connection limits per user
   - Integrate with @libs/monitoring for connection metrics

2. **WebSocket Session Sync** (1h)

   - Create `WebSocketSessionSync` class
   - Monitor session validity during WebSocket connection
   - Close WebSocket if session revoked
   - Close WebSocket if API key revoked
   - Sync session expiration with connection timeout

3. **Multi-Layer Caching Optimization** (2h)

   - Integrate @libs/database CacheService fully
   - Configure L1 (memory) and L2 (Redis) caching:
     - User sessions: 5min (L1), 30min (L2)
     - JWKS: 1 hour (L1), 24 hours (L2)
     - API keys: 5min (L1), 15min (L2)
     - Org membership: 10min (L1), 1 hour (L2)
   - Implement cache invalidation on:
     - Password change → invalidate user sessions
     - Logout → invalidate specific session
     - API key revoke → invalidate key cache
     - JWT rotation → invalidate JWKS cache
   - Add cache hit rate monitoring (target: >85%)

4. **Production Monitoring Integration** (2h)
   - Integrate @libs/monitoring MetricsCollector
   - Add metrics for all operations:
     - `auth.login.success` / `auth.login.failure`
     - `auth.jwt.verify` / `auth.bearer.verify`
     - `auth.apikey.validate`
     - `auth.session.cache.hit` / `auth.session.cache.miss`
     - `auth.websocket.connections` (gauge)
   - Implement health checks:
     - Database connectivity
     - Redis connectivity
     - Better-Auth API availability
     - JWKS endpoint reachability
   - Add error tracking and alerting
   - Create performance dashboards

**Deliverables**:

- ⏳ WebSocket authentication fully functional
- ⏳ Session synchronization working
- ⏳ Multi-layer caching optimized (>85% hit rate)
- ⏳ Comprehensive monitoring active
- ⏳ Health checks passing
- ⏳ Performance targets met (<50ms P95 session validation)

**Validation**:

```bash
# WebSocket connection with session cookie
wscat -c ws://localhost:3000/ws --header "Cookie: better-auth.session-token=TOKEN"

# WebSocket with Bearer token
wscat -c ws://localhost:3000/ws --header "Authorization: Bearer TOKEN"

# WebSocket with API key
wscat -c ws://localhost:3000/ws --header "x-api-key: YOUR_KEY"

# Cache performance
hey -n 1000 GET /api/auth/session  # Should show <50ms P95

# Health check
curl GET /health
```

---

### Phase 5: Elysia Integration, Testing & Documentation (Day 5)

**Objective**: Complete Elysia plugin integration, comprehensive testing, production-ready documentation

**Timeline**: 6-8 hours  
**Complexity**: Medium

**Dependencies**:

- Phase 4 completed
- All middleware and WebSocket handlers working

**Sub-tasks**:

1. **Elysia Plugin Integration** (2h)

   - Create `ElysiaAuthPlugin` class for easy integration
   - Implement `install(app, config)` method that:
     - Mounts Better-Auth handler at `/api/auth/*`
     - Registers all middleware (session, bearer, jwt, api-key)
     - Sets up WebSocket handlers
     - Configures CORS for auth endpoints
   - Create `ElysiaContextDecorator` to add auth helpers:
     - `context.user` - Current authenticated user
     - `context.session` - Current session
     - `context.organization` - Active organization
     - `context.apiKey` - API key details (if using API key auth)
     - `context.isAuthenticated` - Boolean flag
   - Add convenience methods:
     - `context.hasOrgPermission(action, resource)`
     - `context.requireRole(roleName)`
     - `context.getActiveOrganization()`

2. **Route Protection Utilities** (1h)

   - Create `AuthGuard` class with declarative route protection:
     - `requireBetterAuthSession()` - Require valid session
     - `requireBearer()` - Require Bearer token
     - `requireJWT()` - Require JWT token
     - `requireApiKey(permissions?)` - Require API key
     - `requireOrganizationMembership(organizationId)`
     - `requireOrganizationRole(organizationId, role)`
     - `either(...guards)` - Any auth method
     - `all(...guards)` - All auth methods
   - Example usage:
     ```typescript
     app.get("/protected", auth.guard.requireBetterAuthSession(), (context) => {
       return { user: context.user };
     });
     ```

3. **Comprehensive Testing** (3h)

   - **Unit Tests**: Test each middleware in isolation (~25 tests each)
   - **Integration Tests**: Test complete auth flows
     - Email/password registration → login → protected route
     - Bearer token generation → validation → refresh
     - JWT generation → validation → microservice call
     - API key creation → validation → permission check
     - Organization creation → member invitation → role assignment
   - **WebSocket Tests**: Test all WebSocket auth methods
   - **End-to-End Tests**: Test real-world scenarios
   - **Security Tests**: SQL injection, XSS, CSRF protection
   - **Performance Tests**: Load testing under 10k concurrent users
   - **Target**: >90% coverage (~160+ tests total)

4. **Production-Ready Documentation** (2h)

   - Create `README.md` with:
     - Quick start guide (5-minute setup)
     - Installation instructions
     - Basic configuration examples
     - All authentication methods with examples
     - Middleware usage patterns
     - WebSocket authentication examples
     - Troubleshooting guide
   - Create `ARCHITECTURE.md` explaining:
     - Component architecture
     - Better-Auth integration approach
     - Middleware pattern explanation
     - Caching strategy
     - Rate limiting strategy
   - Create `API.md` documenting:
     - All exported functions and classes
     - Configuration options
     - TypeScript types
     - Error codes and handling
   - Update `docs/fonctional.md` with implementation notes

**Deliverables**:

- ⏳ Elysia plugin complete and tested
- ⏳ Route protection utilities functional
- ⏳ Comprehensive test suite (>90% coverage)
- ⏳ Production-ready documentation
- ⏳ Migration guide from legacy auth
- ⏳ All tests passing (~160+ total)

**Validation**:

```bash
# Easy Elysia integration
import { ElysiaAuthPlugin } from '@libs/better-auth';
app.use(ElysiaAuthPlugin.install(app, config));

# Route protection
app.get('/protected', auth.guard.requireBetterAuthSession(), handler);

# All tests passing
pnpm test  # Should show 160+ tests passing

# Documentation complete
ls -la README.md ARCHITECTURE.md API.md
```

---

## Risk Assessment

### Low Risk (Mitigated)

- **Better-Auth Framework**: Battle-tested, production-ready
- **Existing Infrastructure**: Proven @libs/\* components
- **Clear Documentation**: Comprehensive 4,856-line spec

### Medium Risk (Monitored)

- **WebSocket Integration**: Custom implementation needed
- **Performance Targets**: Require optimization and caching
- **Migration**: Need to coexist with existing auth systems

### Mitigation Strategies

1. **Incremental Development**: Build and test phase by phase
2. **Leverage Existing Code**: Use @libs/\* extensively
3. **Comprehensive Testing**: 90%+ coverage, load testing
4. **Monitoring First**: Instrument everything from start
5. **Security Reviews**: Audit each phase before proceeding

---

## Resources

### Documentation

- **Primary**: `libs/better-auth/docs/fonctional.md` (4,856 lines)
- **Summary**: `libs/better-auth/docs/FINAL_UPDATE_SUMMARY.md`
- **Architecture**: Diagrams in functional spec

### Dependencies

- **Better-Auth**: https://better-auth.com
- **Plugins**: Bearer, JWT, API Key, Organization, 2FA, Multi-Session
- **Infrastructure**: @libs/elysia-server, @libs/ratelimit, @libs/database, @libs/monitoring, @libs/utils

### Reference Implementations

- **Keycloak-AuthV2**: Similar patterns in `libs/keycloak-authV2`
- **Existing Auth**: `libs/auth` (legacy, to be replaced)
- **Elysia Middleware**: `libs/elysia-server/src/middleware`

---

## Technical Debt Prevention

**CRITICAL - Avoid These Common Mistakes**:

- ❌ **NO custom authentication logic** - Use Better-Auth plugin methods via `auth.api.*`
- ❌ **NO custom token validation** - Call `auth.api.getSession({ headers })` for all auth types
- ❌ **NO custom JWT verification** - Use Better-Auth JWT plugin's JWKS validation
- ❌ **NO custom API key validation** - Use Better-Auth API Key plugin's `verifyApiKey`
- ❌ **NO custom rate limiting** - Use @libs/ratelimit exclusively
- ❌ **NO custom caching** - Use @libs/database CacheService
- ❌ **NO custom monitoring** - Use @libs/monitoring MetricsCollector
- ❌ **NO service classes unless needed** - Middleware call Better-Auth directly

**Correct Patterns to Embrace**:

- ✅ Middleware extract credentials and call `auth.api.getSession({ headers })`
- ✅ Attach Better-Auth response unchanged to Elysia context
- ✅ Use Better-Auth plugin methods directly (no wrappers unless complex multi-step)
- ✅ Leverage @libs/\* infrastructure for cross-cutting concerns
- ✅ Comprehensive testing of integration points
- ✅ Production monitoring from the start

**Middleware Architecture Pattern** (ALL middleware follow this):

```typescript
export function createAuthMiddleware(auth: BetterAuth, options: Options) {
  return async (context: Context) => {
    // 1. Extract credential from request
    const token = extractCredential(context.request, options);

    // 2. Validate with Better-Auth (NO custom logic)
    const result = await auth.api.getSession({
      headers: context.request.headers,
    });

    if (!result.session || !result.user) {
      throw new InvalidTokenError("Authentication failed");
    }

    // 3. Attach Better-Auth response unchanged to context
    context["session"] = result.session;
    context["user"] = result.user;
  };
}
```

---

## Definition of Done

### Technical Requirements

- [x] Better-Auth installed with Prisma adapter (Phase 1 ✅)
- [x] AuthLibrary class created and tested (Phase 1 ✅)
- [x] All plugins configured in `BetterAuthConfigBuilder` (Phase 1 ✅)
- [x] Session middleware working (Phase 2 ✅ - 18 tests passing)
- [x] Bearer middleware working (Phase 2 ✅ - 25 tests passing)
- [ ] JWT middleware working (Phase 2 ⏳ - next)
- [ ] API Key middleware working (Phase 2 ⏳ - after JWT)
- [ ] WebSocket authentication handler (Phase 4 ⏳)
- [ ] Rate limiting integrated with @libs/ratelimit (Phase 3 ⏳)
- [ ] Multi-layer caching optimized (Phase 4 ⏳)
- [ ] Monitoring and metrics comprehensive (Phase 4 ⏳)
- [ ] Elysia plugin complete (Phase 5 ⏳)
- [ ] Route protection utilities (Phase 5 ⏳)
- [ ] Error handling production-ready (Phase 5 ⏳)
- [ ] Test coverage >90% (Phase 5 ⏳ - targeting ~160+ tests)
- [ ] Performance targets met (<50ms P95 session validation)

### Documentation Requirements

- [ ] README.md with quick start (Phase 5 ⏳)
- [ ] ARCHITECTURE.md explaining design (Phase 5 ⏳)
- [ ] API.md documenting exports (Phase 5 ⏳)
- [ ] Examples for each auth method (Phase 5 ⏳)
- [ ] Troubleshooting guide (Phase 5 ⏳)
- [ ] Migration guide from legacy auth (Phase 5 ⏳)

### Quality Requirements

- [x] Zero TypeScript errors (Current ✅)
- [x] Phase 1 tests passing (46 tests ✅)
- [x] Phase 2 session tests passing (18 tests ✅)
- [x] Phase 2 bearer tests passing (25 tests ✅)
- [ ] All middleware tests passing (targeting ~114 tests by end of Phase 2)
- [ ] Integration tests passing (Phase 5 ⏳)
- [ ] Security audit passed (Phase 5 ⏳)
- [ ] Performance benchmarks met (Phase 5 ⏳)
- [ ] Production readiness checklist completed (Phase 5 ⏳)

### Current Progress: 50% Complete (2/4 middleware done)

**Completed**:

- ✅ Phase 1: Foundation & Core Setup (100%)
- ✅ Phase 2 (Session): Session middleware (100%)
- ✅ Phase 2 (Bearer): Bearer middleware (100%)

**In Progress**:

- ⏳ Phase 2 (JWT): JWT middleware (NEXT)
- ⏳ Phase 2 (API Key): API Key middleware (AFTER JWT)

**Pending**:

- ⏳ Phase 3: Plugin testing & rate limiting
- ⏳ Phase 4: WebSocket & optimization
- ⏳ Phase 5: Elysia integration & documentation

---

## Next Actions

1. **Immediate**: Install Better-Auth and dependencies
2. **Today**: Complete Phase 1 (Foundation & Core Setup)
3. **This Week**: Complete Phases 2-3 (Token auth, API Keys, Organizations)
4. **Next Week**: Complete Phases 4-5 (Advanced features, polish, documentation)

---

## Notes

**Conservative Approach**: This implementation leverages battle-tested Better-Auth framework and existing infrastructure. We're not building a custom auth system - we're orchestrating proven components into a production-ready solution.

**Scalability**: All patterns support microservices architecture with distributed caching, rate limiting, and monitoring.

**Maintainability**: Clear separation of concerns, comprehensive testing, and documentation ensure long-term maintainability.

**Security**: Industry-standard practices throughout, with multiple layers of protection and comprehensive audit logging.
