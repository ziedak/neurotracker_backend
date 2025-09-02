# AuthV2 Migration Guide

## Overview

This guide helps you migrate from AuthV1 to AuthV2, covering all breaking changes, new features, and step-by-step migration process.

## What's New in AuthV2

### 🆕 Major Enhancements

1. **Enhanced Models** - Rich user, session, role, and permission models with metadata
2. **Multi-Tenant Architecture** - Built-in support for store and organization-based tenancy
3. **Enterprise Security** - Advanced validation, audit logging, and configurable security levels
4. **Distributed Caching** - Redis-first caching with memory fallback
5. **Repository Pattern** - Clean data access layer with transaction support
6. **Comprehensive Monitoring** - Health checks, metrics, and observability

### 🔄 Breaking Changes

1. Service names changed (AuthService → AuthenticationServiceV2)
2. Method signatures updated for enhanced functionality
3. Return types now include rich metadata
4. Configuration structure redesigned
5. Enhanced model interfaces replace basic models

## Migration Strategy

### Phase 1: Preparation (Day 1)

- [ ] Review current AuthV1 usage
- [ ] Install AuthV2 dependencies
- [ ] Set up development environment
- [ ] Create migration plan

### Phase 2: Service Migration (Day 2-3)

- [ ] Replace service imports
- [ ] Update dependency injection
- [ ] Migrate authentication methods
- [ ] Update session management

### Phase 3: Model Migration (Day 3-4)

- [ ] Update user model handling
- [ ] Migrate session structures
- [ ] Update permission checks
- [ ] Add enhanced model validation

### Phase 4: Feature Enhancement (Day 4-5)

- [ ] Implement multi-tenancy
- [ ] Add enhanced security
- [ ] Configure caching
- [ ] Set up monitoring

### Phase 5: Testing & Deployment (Day 5-6)

- [ ] Comprehensive testing
- [ ] Performance validation
- [ ] Production deployment
- [ ] Monitor and optimize

## Step-by-Step Migration

### Step 1: Install Dependencies

```bash
# Remove old AuthV1 (optional, can run both during migration)
# npm uninstall @libs/auth

# Install AuthV2
npm install @libs/authV2 @libs/database @libs/config

# Update TypeScript if needed
npm install typescript@^4.8.0
```

### Step 2: Update Imports

**Before (AuthV1):**

```typescript
import { AuthService, SessionService, PermissionService } from "@libs/auth";
```

**After (AuthV2):**

```typescript
import {
  AuthenticationServiceV2,
  SessionServiceV2,
  PermissionServiceV2,
  JWTServiceV2,
  APIKeyServiceV2,
} from "@libs/authV2";
```

### Step 3: Update Service Initialization

**Before (AuthV1):**

```typescript
// Manual initialization
const authService = new AuthService({
  jwtSecret: process.env.JWT_SECRET,
  sessionTimeout: 3600000,
});

// Simple dependency injection
container.bind("AuthService").to(AuthService);
```

**After (AuthV2):**

```typescript
// Comprehensive configuration
const authConfig: IAuthenticationServiceConfig = {
  validation: {
    strictMode: true,
    passwordComplexity: true,
  },
  cache: {
    enabled: true,
    authenticationResultTTL: 300,
  },
  audit: {
    enabled: true,
    detailedLogging: true,
  },
};

// Enhanced dependency injection
container.bind<JWTServiceV2>("JWTServiceV2").to(JWTServiceV2);
container.bind<SessionServiceV2>("SessionServiceV2").to(SessionServiceV2);
container
  .bind<PermissionServiceV2>("PermissionServiceV2")
  .to(PermissionServiceV2);
container
  .bind<AuthenticationServiceV2>("AuthenticationServiceV2")
  .to(AuthenticationServiceV2);
```

### Step 4: Migrate Authentication Methods

**Before (AuthV1):**

```typescript
// Simple authentication
const result = await authService.login(email, password);

if (result.success) {
  console.log("User:", result.user);
  console.log("Token:", result.token);
}
```

**After (AuthV2):**

```typescript
// Rich authentication result
const result = await authService.authenticate({ email, password });

if (result.success) {
  console.log("User:", result.user); // IEnhancedUser
  console.log("Session:", result.session); // IEnhancedSession
  console.log("Permissions:", result.permissions); // IEnhancedPermission[]
  console.log("Access Token:", result.accessToken);
  console.log("Metadata:", result.metadata);
}
```

**Enhanced Authentication:**

```typescript
// Use enhanced security features
const result = await authService.authenticateSecure(
  { email, password },
  {
    validateInput: true,
    securityLevel: "enhanced",
    tenantId: "store_123",
  }
);

// Multi-tenant authentication
const result = await authService.authenticateWithTenantContext(
  { email, password },
  "store_123"
);
```

### Step 5: Update Session Management

**Before (AuthV1):**

```typescript
// Basic session operations
const session = await sessionService.create(userId, deviceInfo);
const userSession = await sessionService.getByUserId(userId);
await sessionService.delete(sessionId);
```

**After (AuthV2):**

```typescript
// Enhanced session operations
const session = await sessionService.create({
  userId,
  deviceInfo,
  ipAddress: req.ip,
  userAgent: req.headers["user-agent"],
  metadata: {
    loginMethod: "password",
    deviceFingerprint: calculateFingerprint(req),
    tenantContext: "store_123",
  },
  securityContext: {
    riskScore: 0.1,
    trustedDevice: true,
    mfaVerified: false,
    securityLevel: "standard",
  },
});

// Multi-session management
const sessions = await sessionService.findByUserId(userId);
const ended = await sessionService.endAllUserSessions(userId);
const analytics = await sessionService.getSessionAnalytics(userId);
```

### Step 6: Update Permission System

**Before (AuthV1):**

```typescript
// Basic permission check
const hasPermission = await permissionService.check(userId, "user:read");
const permissions = await permissionService.getUserPermissions(userId);
```

**After (AuthV2):**

```typescript
// Enhanced permission system
const hasPermission = await permissionService.hasPermission(
  userId,
  "user",
  "read"
);
const hasMultiple = await permissionService.hasPermissions(userId, [
  "user:create",
  "user:read",
  "user:update",
]);

// Context-aware permissions
const hasAccess = await permissionService.evaluatePermission(
  userId,
  "document",
  "read",
  {
    tenantId: "store_123",
    timeOfDay: new Date().getHours(),
    riskScore: 0.2,
  }
);

// Rich permission data
const permissions = await permissionService.getUserPermissions(userId);
permissions.forEach((permission) => {
  console.log("Permission:", permission.name);
  console.log("Resource:", permission.resource);
  console.log("Action:", permission.action);
  console.log("Effect:", permission.effect);
  console.log("Metadata:", permission.metadata);
});
```

### Step 7: Handle Enhanced Models

**Before (AuthV1):**

```typescript
interface User {
  id: string;
  email: string;
  name: string;
  role: string;
}

function handleUser(user: User) {
  console.log("User:", user.name);
  console.log("Role:", user.role);
}
```

**After (AuthV2):**

```typescript
import { IEnhancedUser, EnhancedTypeGuards } from "@libs/authV2";

function handleEnhancedUser(user: IEnhancedUser) {
  // Validate enhanced user
  if (!EnhancedTypeGuards.isEnhancedUser(user)) {
    throw new Error("Invalid enhanced user");
  }

  console.log("User:", user.name);
  console.log("Role ID:", user.roleId);
  console.log("Store ID:", user.storeId);
  console.log("Organization ID:", user.organizationId);

  // Access security metadata
  console.log(
    "Failed login attempts:",
    user.securityMetadata.failedLoginAttempts
  );
  console.log("MFA enabled:", user.securityMetadata.mfaEnabled);
  console.log("Risk score:", user.securityMetadata.riskScore);

  // Access preferences
  console.log("Theme:", user.preferences.theme);
  console.log("Language:", user.preferences.language);
}
```

### Step 8: Update Error Handling

**Before (AuthV1):**

```typescript
try {
  const result = await authService.login(email, password);
} catch (error) {
  if (error.message === "Invalid credentials") {
    // Handle error
  }
}
```

**After (AuthV2):**

```typescript
import { AuthenticationError } from "@libs/authV2";

try {
  const result = await authService.authenticate({ email, password });

  if (!result.success) {
    // Rich error information
    console.log("Errors:", result.errors);
    console.log("Metadata:", result.metadata);

    // Check specific errors
    if (result.errors.includes("invalid_credentials")) {
      return { message: "Invalid email or password" };
    } else if (result.errors.includes("account_locked")) {
      return { message: "Account locked due to failed attempts" };
    } else if (result.errors.includes("tenant_access_denied")) {
      return { message: "Access denied for this tenant" };
    }
  }
} catch (error) {
  if (error instanceof AuthenticationError) {
    console.log("Auth error:", error.code);
    console.log("Details:", error.details);
  } else {
    console.log("Unexpected error:", error);
  }
}
```

### Step 9: Add Multi-Tenancy Support

**New in AuthV2:**

```typescript
// Tenant-aware authentication
async function tenantLogin(email: string, password: string, tenantId: string) {
  const result = await authService.authenticateWithTenantContext(
    { email, password },
    tenantId
  );

  if (result.success && result.metadata?.tenantValidated) {
    return {
      success: true,
      user: result.user,
      tenantId: tenantId,
      permissions: result.permissions,
    };
  } else {
    return {
      success: false,
      message: "Tenant access denied",
      error: result.metadata?.error,
    };
  }
}

// Tenant validation middleware
async function validateTenantMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const userContext = req.user; // From auth middleware
  const tenantId = req.params.tenantId;

  const hasAccess = await authService.validateTenantContext(
    userContext,
    tenantId
  );

  if (!hasAccess) {
    return res.status(403).json({ message: "Tenant access denied" });
  }

  req.tenantId = tenantId;
  next();
}
```

### Step 10: Configure Caching

**New in AuthV2:**

```typescript
// Enable Redis caching
const cacheConfig = {
  enabled: true,
  authenticationResultTTL: 300, // 5 minutes
  validationResultTTL: 60, // 1 minute
  warmupEnabled: true, // Preload cache
  fallbackToMemory: true, // Memory fallback if Redis fails
};

// Manual cache operations
const cacheService = container.get<CacheServiceV2>("CacheServiceV2");

// Cache authentication result
await cacheService.set(`auth:${userId}`, authResult, 300);

// Get cached result
const cached = await cacheService.get(`auth:${userId}`);

// Cache warming
await cacheService.warmup([
  { key: "permissions:admin", loader: () => getAdminPermissions() },
  { key: "roles:all", loader: () => getAllRoles() },
]);
```

### Step 11: Add Monitoring

**New in AuthV2:**

```typescript
// Health checks
const health = await authService.getHealth();

console.log("Service status:", health.status);
console.log("Dependencies:", health.dependencies);
console.log("Metrics:", health.metrics);

// Service metrics
if (health.metrics) {
  console.log("Response time:", health.metrics.responseTime);
  console.log("Uptime:", health.metrics.uptime);
  console.log("Requests/sec:", health.metrics.requestsPerSecond);
  console.log("Error rate:", health.metrics.errorRate);
}

// Dependency health
Object.entries(health.dependencies).forEach(([service, status]) => {
  console.log(`${service}: ${status}`);
});
```

## Migration Helpers

### Compatibility Layer

Create a compatibility layer to ease migration:

```typescript
// auth-compatibility.ts
import {
  AuthenticationServiceV2,
  IAuthenticationCredentials,
} from "@libs/authV2";

/**
 * Compatibility wrapper for AuthV1 methods
 */
export class AuthV1Compatibility {
  constructor(private authV2: AuthenticationServiceV2) {}

  // AuthV1: login(email, password)
  async login(email: string, password: string) {
    const result = await this.authV2.authenticate({ email, password });

    return {
      success: result.success,
      user: result.user,
      token: result.accessToken,
      sessionId: result.session?.id,
    };
  }

  // AuthV1: getUser(sessionId)
  async getUser(sessionId: string) {
    const context = await this.authV2.getContextBySession(sessionId as any);
    return context?.user || null;
  }

  // AuthV1: logout(sessionId)
  async logout(sessionId: string) {
    const context = await this.authV2.getContextBySession(sessionId as any);
    if (context) {
      return await this.authV2.logout(context);
    }
    return false;
  }
}

// Usage during migration
const authV1Compat = new AuthV1Compatibility(authV2Service);
const result = await authV1Compat.login(email, password); // Works like AuthV1
```

### Data Migration Script

```typescript
// migrate-sessions.ts
import { SessionServiceV2 } from "@libs/authV2";

async function migrateSessions() {
  const sessionService = container.get<SessionServiceV2>("SessionServiceV2");

  // Get old sessions from AuthV1
  const oldSessions = await getOldSessions(); // Your AuthV1 data

  for (const oldSession of oldSessions) {
    // Create enhanced session
    const enhancedSession = await sessionService.create({
      userId: oldSession.userId,
      deviceInfo: oldSession.deviceInfo || "Unknown",
      ipAddress: oldSession.ipAddress || "0.0.0.0",
      userAgent: oldSession.userAgent || "Unknown",
      metadata: {
        loginMethod: "password",
        deviceFingerprint: generateFingerprint(oldSession),
        migrated: true,
        originalSessionId: oldSession.id,
      },
      securityContext: {
        riskScore: 0.1,
        trustedDevice: false,
        mfaVerified: false,
        securityLevel: "standard",
      },
    });

    console.log(`Migrated session ${oldSession.id} -> ${enhancedSession.id}`);
  }

  console.log(`Migrated ${oldSessions.length} sessions`);
}
```

### Configuration Migration

```typescript
// migrate-config.ts
import { IAuthenticationServiceConfig } from "@libs/authV2";

function migrateAuthV1Config(oldConfig: any): IAuthenticationServiceConfig {
  return {
    validation: {
      strictMode: oldConfig.strictValidation || false,
      passwordComplexity: oldConfig.passwordComplexity || true,
    },
    rateLimit: {
      enabled: oldConfig.rateLimit?.enabled || false,
      maxAttempts: oldConfig.rateLimit?.maxAttempts || 5,
      windowMs: oldConfig.rateLimit?.windowMs || 900000,
    },
    cache: {
      enabled: oldConfig.cache?.enabled || false,
      authenticationResultTTL: oldConfig.cache?.ttl || 300,
    },
    audit: {
      enabled: oldConfig.audit?.enabled || false,
      detailedLogging: oldConfig.audit?.detailed || false,
    },
    security: {
      sessionTimeout: oldConfig.sessionTimeout || 3600000,
      tokenRefreshThreshold: oldConfig.tokenRefresh || 300000,
    },
  };
}
```

## Testing Migration

### Unit Tests

```typescript
// auth.migration.test.ts
describe("AuthV2 Migration", () => {
  let authV2: AuthenticationServiceV2;
  let compatibility: AuthV1Compatibility;

  beforeEach(() => {
    authV2 = container.get<AuthenticationServiceV2>("AuthenticationServiceV2");
    compatibility = new AuthV1Compatibility(authV2);
  });

  test("should authenticate user with AuthV1 compatibility", async () => {
    const result = await compatibility.login("test@example.com", "password123");

    expect(result.success).toBe(true);
    expect(result.user).toBeDefined();
    expect(result.token).toBeDefined();
    expect(result.sessionId).toBeDefined();
  });

  test("should handle enhanced user properties", async () => {
    const authResult = await authV2.authenticate({
      email: "test@example.com",
      password: "password123",
    });

    expect(authResult.success).toBe(true);
    expect(authResult.user?.securityMetadata).toBeDefined();
    expect(authResult.user?.preferences).toBeDefined();
  });

  test("should validate tenant context", async () => {
    const result = await authV2.authenticateWithTenantContext(
      { email: "test@example.com", password: "password123" },
      "store_123"
    );

    expect(result.success).toBe(true);
    expect(result.metadata?.tenantValidated).toBe(true);
  });
});
```

### Integration Tests

```typescript
// auth.integration.test.ts
describe("AuthV2 Integration", () => {
  test("should maintain session consistency across services", async () => {
    // Authenticate
    const authResult = await authService.authenticate({
      email: "integration@test.com",
      password: "testPassword",
    });

    expect(authResult.success).toBe(true);

    // Verify session
    const context = await authService.getContextBySession(
      authResult.session!.id as SessionId
    );

    expect(context).toBeDefined();
    expect(context!.user.id).toBe(authResult.user!.id);

    // Check permissions
    const permissions = await permissionService.getUserPermissions(
      authResult.user!.id as EntityId
    );

    expect(permissions).toEqual(authResult.permissions);
  });
});
```

## Rollback Plan

### Safe Rollback Strategy

1. **Keep AuthV1 Running**: Run both services during migration
2. **Feature Flags**: Use feature flags to switch between AuthV1 and AuthV2
3. **Data Backup**: Backup all authentication data before migration
4. **Monitoring**: Monitor both systems during transition

```typescript
// rollback.strategy.ts
const USE_AUTH_V2 = process.env.USE_AUTH_V2 === "true";

class AuthServiceRouter {
  constructor(
    private authV1: AuthService,
    private authV2: AuthenticationServiceV2
  ) {}

  async authenticate(credentials: any) {
    if (USE_AUTH_V2) {
      try {
        return await this.authV2.authenticate(credentials);
      } catch (error) {
        console.error("AuthV2 failed, falling back to V1:", error);
        return await this.authV1.login(credentials.email, credentials.password);
      }
    } else {
      return await this.authV1.login(credentials.email, credentials.password);
    }
  }
}
```

## Common Issues and Solutions

### Issue 1: Type Compatibility

**Problem**: Enhanced models don't match existing code expectations.

**Solution**:

```typescript
// Use type guards and transformers
import { EnhancedTypeGuards, ModelTransformers } from "@libs/authV2";

function handleUser(user: any) {
  if (EnhancedTypeGuards.isEnhancedUser(user)) {
    // Handle enhanced user
    return user;
  } else {
    // Transform basic user to enhanced
    return ModelTransformers.transformToEnhancedUser(user);
  }
}
```

### Issue 2: Session Migration

**Problem**: Existing sessions become invalid after migration.

**Solution**:

```typescript
// Gradual session migration
async function migrateUserSession(oldSessionId: string) {
  const oldSession = await getOldSession(oldSessionId);

  if (oldSession) {
    const newSession = await sessionServiceV2.create({
      userId: oldSession.userId,
      deviceInfo: oldSession.deviceInfo,
      ipAddress: oldSession.ipAddress,
      userAgent: oldSession.userAgent,
      metadata: { migrated: true, originalId: oldSessionId },
    });

    // Map old session ID to new session
    await setSessionMapping(oldSessionId, newSession.id);

    return newSession;
  }
}
```

### Issue 3: Permission Structure Changes

**Problem**: Permission strings format changed.

**Solution**:

```typescript
// Permission format migration
function migratePermissionFormat(oldPermission: string): string {
  // Old format: "user:read"
  // New format: resource="user", action="read"

  const [resource, action] = oldPermission.split(":");
  return `${resource}:${action}`;
}

// Batch permission migration
async function migrateUserPermissions(userId: string) {
  const oldPermissions = await getOldUserPermissions(userId);
  const newPermissions = oldPermissions.map(migratePermissionFormat);

  for (const permission of newPermissions) {
    const [resource, action] = permission.split(":");
    await permissionServiceV2.hasPermission(
      userId as EntityId,
      resource,
      action
    );
  }
}
```

## Post-Migration Checklist

### Immediate (Day 1)

- [ ] All authentication flows working
- [ ] Session management functional
- [ ] Basic permission checks working
- [ ] Error handling updated
- [ ] Logs show successful migrations

### Short Term (Week 1)

- [ ] Performance metrics stable
- [ ] Cache hit rates acceptable
- [ ] User experience unchanged
- [ ] No increase in error rates
- [ ] Multi-tenancy working (if applicable)

### Medium Term (Month 1)

- [ ] Enhanced security features enabled
- [ ] Monitoring and alerting configured
- [ ] Team trained on new features
- [ ] Documentation updated
- [ ] AuthV1 deprecated and removed

### Long Term (Month 3)

- [ ] Full feature utilization
- [ ] Performance optimized
- [ ] Security posture improved
- [ ] Audit compliance achieved
- [ ] Development team proficient

## Conclusion

Migrating from AuthV1 to AuthV2 brings significant benefits in security, functionality, and maintainability. Follow this guide step-by-step, use the provided helpers, and maintain thorough testing throughout the process.

For additional support during migration, consult the [Complete Usage Guide](./COMPLETE_USAGE_GUIDE.md) and [API Reference](./API_REFERENCE.md), or reach out to the AuthV2 team.

The investment in migration will provide a robust, scalable, and secure authentication foundation for your enterprise applications.
