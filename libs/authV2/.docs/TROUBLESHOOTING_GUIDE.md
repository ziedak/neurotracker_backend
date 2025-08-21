# AuthV2 Troubleshooting Guide

## Table of Contents

1. [Common Issues](#common-issues)
2. [Authentication Problems](#authentication-problems)
3. [Session Management Issues](#session-management-issues)
4. [Multi-Tenant Problems](#multi-tenant-problems)
5. [Performance Issues](#performance-issues)
6. [Cache Problems](#cache-problems)
7. [Configuration Issues](#configuration-issues)
8. [Migration Problems](#migration-problems)
9. [Debugging Tools](#debugging-tools)
10. [FAQ](#faq)

## Common Issues

### 1. Service Not Found / Dependency Injection Errors

#### Symptoms

```
Error: No matching bindings found for serviceIdentifier: AuthenticationServiceV2
```

#### Causes

- Services not properly registered in DI container
- Import order issues
- Missing service dependencies

#### Solutions

**Check Service Registration:**

```typescript
// Ensure all services are registered
import { Container } from "@libs/config";
import {
  AuthenticationServiceV2,
  JWTServiceV2,
  SessionServiceV2,
  PermissionServiceV2,
} from "@libs/authV2";

const container = Container.getInstance();

// Register all required services
container.bind<JWTServiceV2>("JWTServiceV2").to(JWTServiceV2);
container.bind<SessionServiceV2>("SessionServiceV2").to(SessionServiceV2);
container
  .bind<PermissionServiceV2>("PermissionServiceV2")
  .to(PermissionServiceV2);
container
  .bind<AuthenticationServiceV2>("AuthenticationServiceV2")
  .to(AuthenticationServiceV2);
```

**Verify Dependencies:**

```typescript
// Check if all dependencies are available
try {
  const jwtService = container.get<JWTServiceV2>("JWTServiceV2");
  const sessionService = container.get<SessionServiceV2>("SessionServiceV2");
  const authService = container.get<AuthenticationServiceV2>(
    "AuthenticationServiceV2"
  );

  console.log("All services registered successfully");
} catch (error) {
  console.error("Service registration failed:", error.message);
}
```

### 2. Enhanced Model Validation Failures

#### Symptoms

```
Error: Invalid enhanced user - missing required properties
TypeError: Cannot read property 'securityMetadata' of undefined
```

#### Causes

- User object doesn't match enhanced model structure
- Missing security metadata or preferences
- Type guard validation failures

#### Solutions

**Validate Enhanced Models:**

```typescript
import { EnhancedTypeGuards, ModelTransformers } from "@libs/authV2";

function validateAndTransformUser(user: any) {
  // Check if already enhanced
  if (EnhancedTypeGuards.isEnhancedUser(user)) {
    return user;
  }

  // Transform basic user to enhanced
  try {
    const enhancedUser = ModelTransformers.transformToEnhancedUser(user);

    // Validate transformation result
    if (!EnhancedTypeGuards.isEnhancedUser(enhancedUser)) {
      throw new Error("User transformation failed validation");
    }

    return enhancedUser;
  } catch (error) {
    console.error("User transformation error:", error);
    throw new Error(`Invalid user object: ${error.message}`);
  }
}
```

**Debug Enhanced Model Structure:**

```typescript
function debugEnhancedUser(user: any) {
  console.log("User object keys:", Object.keys(user));
  console.log("Has securityMetadata:", "securityMetadata" in user);
  console.log("Has preferences:", "preferences" in user);

  if (user.securityMetadata) {
    console.log("SecurityMetadata keys:", Object.keys(user.securityMetadata));
  }

  if (user.preferences) {
    console.log("Preferences keys:", Object.keys(user.preferences));
  }

  // Check individual required fields
  const requiredFields = [
    "id",
    "email",
    "name",
    "roleId",
    "securityMetadata",
    "preferences",
  ];
  const missingFields = requiredFields.filter((field) => !(field in user));

  if (missingFields.length > 0) {
    console.error("Missing required fields:", missingFields);
  }
}
```

### 3. Redis Connection Issues

#### Symptoms

```
Error: Redis connection failed
Error: ECONNREFUSED 127.0.0.1:6379
Warning: Falling back to memory cache
```

#### Causes

- Redis server not running
- Incorrect Redis configuration
- Network connectivity issues
- Authentication problems

#### Solutions

**Check Redis Configuration:**

```typescript
import { RedisClient } from "@libs/database";

// Test Redis connection
async function testRedisConnection() {
  try {
    const redis = new RedisClient({
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT || "6379"),
      password: process.env.REDIS_PASSWORD,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
    });

    await redis.ping();
    console.log("✅ Redis connection successful");

    // Test basic operations
    await redis.set("test", "value", "EX", 60);
    const result = await redis.get("test");

    if (result === "value") {
      console.log("✅ Redis operations working");
    } else {
      console.error("❌ Redis operations failed");
    }
  } catch (error) {
    console.error("❌ Redis connection failed:", error.message);
    console.log("Ensure Redis is running: redis-server");
  }
}
```

**Configure Fallback Cache:**

```typescript
const cacheConfig = {
  redis: {
    enabled: true,
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || "6379"),
    password: process.env.REDIS_PASSWORD,
    connectTimeout: 5000,
    lazyConnect: true,
  },
  fallback: {
    enabled: true,
    type: "memory",
    maxSize: 1000,
  },
  retryPolicy: {
    retries: 3,
    retryDelayOnFailover: 100,
    enableOfflineQueue: false,
  },
};
```

## Authentication Problems

### 1. Authentication Always Fails

#### Symptoms

```
Authentication failed with valid credentials
All login attempts return invalid_credentials
```

#### Debug Steps

**Enable Debug Logging:**

```typescript
// Enable detailed authentication logging
const authConfig = {
  audit: {
    enabled: true,
    detailedLogging: true,
  },
  debug: {
    enabled: process.env.NODE_ENV === "development",
    logCredentials: false, // Never log actual credentials
    logSteps: true,
  },
};

// Test authentication step by step
async function debugAuthentication(credentials: IAuthenticationCredentials) {
  console.log("🔍 Starting authentication debug");

  try {
    // Step 1: Validate input
    console.log("Step 1: Validating input");
    if (!credentials.email || !credentials.password) {
      console.error("❌ Missing email or password");
      return;
    }

    // Step 2: Check user exists
    console.log("Step 2: Looking up user");
    const userService = container.get<UserServiceV2>("UserServiceV2");
    const user = await userService.findByEmail(credentials.email);

    if (!user) {
      console.error("❌ User not found");
      return;
    }

    console.log("✅ User found:", user.id);

    // Step 3: Verify password
    console.log("Step 3: Verifying password");
    const passwordValid = await userService.verifyPassword(
      user.id,
      credentials.password
    );

    if (!passwordValid) {
      console.error("❌ Password verification failed");
      return;
    }

    console.log("✅ Password verified");

    // Step 4: Check account status
    console.log("Step 4: Checking account status");
    if (!user.isActive) {
      console.error("❌ Account is inactive");
      return;
    }

    console.log("✅ Account is active");

    // Step 5: Full authentication
    console.log("Step 5: Full authentication");
    const result = await authService.authenticate(credentials);

    console.log("Authentication result:", {
      success: result.success,
      errors: result.errors,
      hasUser: !!result.user,
      hasSession: !!result.session,
      hasToken: !!result.accessToken,
    });
  } catch (error) {
    console.error("Authentication debug error:", error);
  }
}
```

### 2. Token Validation Failures

#### Symptoms

```
JWT token invalid
Token expired but within expected time
Token signature verification failed
```

#### Solutions

**Debug JWT Configuration:**

```typescript
// Check JWT configuration
const jwtService = container.get<JWTServiceV2>("JWTServiceV2");

// Test token generation and validation
async function debugJWT() {
  const payload = {
    userId: "test_user_123",
    sessionId: "test_session_456",
    permissions: ["user:read"],
  };

  try {
    // Generate token
    const token = await jwtService.generateAccessToken(payload);
    console.log("✅ Token generated");

    // Validate token
    const decoded = await jwtService.verifyAccessToken(token);
    console.log("✅ Token validated");
    console.log("Decoded payload:", decoded);

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (decoded.exp && decoded.exp > now) {
      console.log("✅ Token not expired");
    } else {
      console.log("❌ Token expired");
    }
  } catch (error) {
    console.error("JWT debug error:", error.message);

    // Common JWT errors
    if (error.message.includes("invalid signature")) {
      console.log("Check JWT_SECRET environment variable");
    } else if (error.message.includes("expired")) {
      console.log("Check JWT_EXPIRES_IN configuration");
    }
  }
}
```

### 3. Rate Limiting Issues

#### Symptoms

```
Too many authentication attempts
Rate limit exceeded for valid requests
Rate limiting not working
```

#### Solutions

**Debug Rate Limiting:**

```typescript
async function debugRateLimit(email: string) {
  const authService = container.get<AuthenticationServiceV2>(
    "AuthenticationServiceV2"
  );

  // Check current rate limit status
  const rateLimitKey = `rate_limit:${email}`;
  const cacheService = container.get<CacheServiceV2>("CacheServiceV2");

  try {
    const currentAttempts = await cacheService.get(rateLimitKey);
    console.log(`Current attempts for ${email}:`, currentAttempts || 0);

    // Test authentication with rate limiting
    const result = await authService.authenticate({
      email: email,
      password: "test_password",
    });

    if (result.metadata?.rateLimited) {
      console.log("Rate limited:", {
        retryAfter: result.metadata.retryAfter,
        attemptsRemaining: result.metadata.attemptsRemaining,
        windowMs: result.metadata.windowMs,
      });
    }
  } catch (error) {
    console.error("Rate limit debug error:", error);
  }
}

// Reset rate limit for testing
async function resetRateLimit(email: string) {
  const cacheService = container.get<CacheServiceV2>("CacheServiceV2");
  const rateLimitKey = `rate_limit:${email}`;

  await cacheService.delete(rateLimitKey);
  console.log(`Rate limit reset for ${email}`);
}
```

## Session Management Issues

### 1. Sessions Not Persisting

#### Symptoms

```
Session lost after authentication
Cannot retrieve session context
Session expired immediately
```

#### Solutions

**Debug Session Creation:**

```typescript
async function debugSession(userId: string) {
  const sessionService = container.get<SessionServiceV2>("SessionServiceV2");

  try {
    // Create session
    const sessionData = {
      userId: userId as EntityId,
      deviceInfo: "Debug Device",
      ipAddress: "127.0.0.1",
      userAgent: "Debug Agent",
      metadata: {
        loginMethod: "password" as const,
        deviceFingerprint: "debug_fingerprint",
        tenantContext: "debug_tenant",
      },
      securityContext: {
        riskScore: 0.1,
        trustedDevice: true,
        mfaVerified: false,
        securityLevel: "standard" as const,
      },
    };

    const session = await sessionService.create(sessionData);
    console.log("✅ Session created:", {
      id: session.id,
      sessionId: session.sessionId,
      userId: session.userId,
      expiresAt: session.expiresAt,
    });

    // Test session retrieval
    const retrieved = await sessionService.findBySessionId(session.sessionId);

    if (retrieved) {
      console.log("✅ Session retrieved successfully");
    } else {
      console.error("❌ Session retrieval failed");
    }

    // Test session validation
    const context = await authService.getContextBySession(session.sessionId);

    if (context) {
      console.log("✅ Session context valid");
    } else {
      console.error("❌ Session context invalid");
    }
  } catch (error) {
    console.error("Session debug error:", error);
  }
}
```

### 2. Multi-Session Conflicts

#### Symptoms

```
User sessions conflicting
Cannot end specific sessions
Session analytics incorrect
```

#### Solutions

**Debug Multi-Session Management:**

```typescript
async function debugMultiSessions(userId: string) {
  const sessionService = container.get<SessionServiceV2>("SessionServiceV2");

  try {
    // Get all user sessions
    const sessions = await sessionService.findByUserId(userId as EntityId);
    console.log(`Found ${sessions.length} sessions for user ${userId}`);

    sessions.forEach((session, index) => {
      console.log(`Session ${index + 1}:`, {
        id: session.sessionId,
        deviceInfo: session.deviceInfo,
        createdAt: session.createdAt,
        lastAccessedAt: session.lastAccessedAt,
        isActive: session.isActive,
      });
    });

    // Test session analytics
    const analytics = await sessionService.getSessionAnalytics(
      userId as EntityId
    );
    console.log("Session analytics:", analytics);

    // Test ending sessions
    if (sessions.length > 1) {
      const sessionToEnd = sessions[0];
      const ended = await sessionService.end(sessionToEnd.sessionId);
      console.log(`Session ${sessionToEnd.sessionId} ended:`, ended);
    }
  } catch (error) {
    console.error("Multi-session debug error:", error);
  }
}
```

## Multi-Tenant Problems

### 1. Tenant Validation Failures

#### Symptoms

```
Valid user cannot access their tenant
Tenant validation always returns false
Cross-tenant access not properly blocked
```

#### Solutions

**Debug Tenant Context:**

```typescript
async function debugTenantValidation(userId: string, tenantId: string) {
  console.log(
    `🔍 Debugging tenant validation for user ${userId}, tenant ${tenantId}`
  );

  try {
    // Step 1: Get user context
    const userService = container.get<UserServiceV2>("UserServiceV2");
    const user = await userService.findById(userId as EntityId);

    if (!user) {
      console.error("❌ User not found");
      return;
    }

    console.log("✅ User found:", {
      id: user.id,
      email: user.email,
      storeId: user.storeId,
      organizationId: user.organizationId,
    });

    // Step 2: Check tenant associations
    const hasStoreAccess = user.storeId === tenantId;
    const hasOrgAccess = user.organizationId === tenantId;

    console.log("Tenant associations:", {
      requestedTenant: tenantId,
      userStoreId: user.storeId,
      userOrgId: user.organizationId,
      hasStoreAccess,
      hasOrgAccess,
    });

    // Step 3: Test authentication with tenant
    const authResult = await authService.authenticateWithTenantContext(
      { email: user.email, password: "test_password" },
      tenantId
    );

    console.log("Tenant authentication result:", {
      success: authResult.success,
      tenantValidated: authResult.metadata?.tenantValidated,
      errors: authResult.errors,
    });

    // Step 4: Test direct validation
    if (authResult.success) {
      const context = await authService.getContextBySession(
        authResult.session!.id as SessionId
      );

      if (context) {
        const isValid = await authService.validateTenantContext(
          context,
          tenantId
        );
        console.log("Direct tenant validation:", isValid);
      }
    }
  } catch (error) {
    console.error("Tenant validation debug error:", error);
  }
}
```

### 2. Cross-Tenant Data Leaks

#### Symptoms

```
User seeing data from other tenants
Tenant boundaries not enforced
Permission checks bypassing tenant validation
```

#### Solutions

**Test Tenant Isolation:**

```typescript
async function testTenantIsolation() {
  console.log("🔒 Testing tenant isolation");

  const testCases = [
    { userId: "user_store_123", tenantId: "store_123", shouldAccess: true },
    { userId: "user_store_123", tenantId: "store_456", shouldAccess: false },
    { userId: "user_org_789", tenantId: "org_789", shouldAccess: true },
    { userId: "user_org_789", tenantId: "org_101112", shouldAccess: false },
  ];

  for (const testCase of testCases) {
    try {
      const context = await createTestContext(testCase.userId);
      const hasAccess = await authService.validateTenantContext(
        context,
        testCase.tenantId
      );

      const result = hasAccess === testCase.shouldAccess ? "✅" : "❌";
      console.log(
        `${result} User ${testCase.userId} -> Tenant ${testCase.tenantId}: ${hasAccess} (expected: ${testCase.shouldAccess})`
      );

      if (hasAccess !== testCase.shouldAccess) {
        console.error(`Tenant isolation violation detected!`);
      }
    } catch (error) {
      console.error(
        `Error testing ${testCase.userId} -> ${testCase.tenantId}:`,
        error.message
      );
    }
  }
}
```

## Performance Issues

### 1. Slow Authentication Response

#### Symptoms

```
Authentication taking >5 seconds
High database query count
Memory usage increasing
```

#### Solutions

**Profile Authentication Performance:**

```typescript
async function profileAuthentication(credentials: IAuthenticationCredentials) {
  console.log("🚀 Profiling authentication performance");

  const startTime = Date.now();
  const startMemory = process.memoryUsage();

  try {
    // Enable performance tracking
    const authService = container.get<AuthenticationServiceV2>(
      "AuthenticationServiceV2"
    );

    // Test with different configurations
    const configs = [
      { cache: true, audit: false, validation: false },
      { cache: true, audit: true, validation: false },
      { cache: true, audit: true, validation: true },
      { cache: false, audit: true, validation: true },
    ];

    for (const config of configs) {
      const configStartTime = Date.now();

      // Temporarily update config (in real implementation, use proper config management)
      const result = await authService.authenticate(credentials);

      const configEndTime = Date.now();
      const configDuration = configEndTime - configStartTime;

      console.log(`Config ${JSON.stringify(config)}: ${configDuration}ms`);
    }

    const endTime = Date.now();
    const endMemory = process.memoryUsage();

    console.log("Performance summary:", {
      totalDuration: `${endTime - startTime}ms`,
      memoryDelta: {
        rss: `${(endMemory.rss - startMemory.rss) / 1024 / 1024}MB`,
        heapUsed: `${
          (endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024
        }MB`,
      },
    });
  } catch (error) {
    console.error("Performance profiling error:", error);
  }
}
```

### 2. High Memory Usage

#### Symptoms

```
Memory usage continuously growing
Cache not releasing memory
Session objects accumulating
```

#### Solutions

**Monitor Memory Usage:**

```typescript
function monitorMemoryUsage() {
  setInterval(() => {
    const usage = process.memoryUsage();
    console.log("Memory usage:", {
      rss: `${Math.round(usage.rss / 1024 / 1024)}MB`,
      heapUsed: `${Math.round(usage.heapUsed / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(usage.heapTotal / 1024 / 1024)}MB`,
      external: `${Math.round(usage.external / 1024 / 1024)}MB`,
    });
  }, 30000); // Every 30 seconds
}

// Cleanup resources
async function cleanupResources() {
  const cacheService = container.get<CacheServiceV2>("CacheServiceV2");
  const sessionService = container.get<SessionServiceV2>("SessionServiceV2");

  // Clear expired cache entries
  await cacheService.cleanup();

  // Clean up expired sessions
  const expiredSessions = await sessionService.findExpired();
  console.log(`Cleaning up ${expiredSessions.length} expired sessions`);

  for (const session of expiredSessions) {
    await sessionService.end(session.sessionId);
  }

  // Force garbage collection (only in debugging)
  if (global.gc) {
    global.gc();
    console.log("Forced garbage collection");
  }
}
```

## Cache Problems

### 1. Cache Miss Rate Too High

#### Symptoms

```
Cache hit rate below 50%
Frequent database queries
Poor performance despite caching
```

#### Solutions

**Analyze Cache Performance:**

```typescript
async function analyzeCachePerformance() {
  const cacheService = container.get<CacheServiceV2>("CacheServiceV2");

  // Get cache statistics
  const stats = await cacheService.getStats();
  console.log("Cache statistics:", stats);

  // Test cache operations
  const testKeys = ["user:123", "permissions:456", "session:789"];

  for (const key of testKeys) {
    const startTime = Date.now();

    // Test cache hit
    let value = await cacheService.get(key);
    const getTime = Date.now() - startTime;

    if (value) {
      console.log(`✅ Cache HIT for ${key} (${getTime}ms)`);
    } else {
      console.log(`❌ Cache MISS for ${key} (${getTime}ms)`);

      // Simulate loading data
      value = { data: `simulated_data_for_${key}` };

      const setStartTime = Date.now();
      await cacheService.set(key, value, 300);
      const setTime = Date.now() - setStartTime;

      console.log(`💾 Cache SET for ${key} (${setTime}ms)`);
    }
  }
}
```

### 2. Cache Invalidation Issues

#### Symptoms

```
Stale data served from cache
Cache not updating after data changes
Inconsistent data across requests
```

#### Solutions

**Test Cache Invalidation:**

```typescript
async function testCacheInvalidation() {
  const cacheService = container.get<CacheServiceV2>("CacheServiceV2");
  const userService = container.get<UserServiceV2>("UserServiceV2");

  const userId = "test_user_123";
  const cacheKey = `user:${userId}`;

  try {
    // Step 1: Load user and cache
    console.log("Step 1: Loading and caching user");
    const user = await userService.findById(userId as EntityId);
    await cacheService.set(cacheKey, user, 300);

    // Step 2: Verify cache
    const cachedUser = await cacheService.get(cacheKey);
    console.log("Cache contains user:", !!cachedUser);

    // Step 3: Update user
    console.log("Step 2: Updating user");
    await userService.update(userId as EntityId, { name: "Updated Name" });

    // Step 4: Check if cache invalidated
    const cachedAfterUpdate = await cacheService.get(cacheKey);
    const updatedUser = await userService.findById(userId as EntityId);

    console.log("Cache invalidation results:", {
      cacheStillHasData: !!cachedAfterUpdate,
      cacheDataCurrent: cachedAfterUpdate?.name === updatedUser?.name,
      dbDataUpdated: updatedUser?.name === "Updated Name",
    });

    // Step 5: Manual invalidation
    await cacheService.delete(cacheKey);
    const cacheAfterDelete = await cacheService.get(cacheKey);
    console.log("Cache after manual delete:", !!cacheAfterDelete);
  } catch (error) {
    console.error("Cache invalidation test error:", error);
  }
}
```

## Debugging Tools

### 1. Health Check Dashboard

```typescript
async function healthCheckDashboard() {
  console.log("🏥 AuthV2 Health Check Dashboard");
  console.log("================================");

  try {
    const authService = container.get<AuthenticationServiceV2>(
      "AuthenticationServiceV2"
    );
    const health = await authService.getHealth();

    console.log(`Overall Status: ${health.status.toUpperCase()}`);
    console.log("\n📊 Metrics:");
    console.log(`  Response Time: ${health.metrics.responseTime}ms`);
    console.log(`  Uptime: ${Math.round(health.metrics.uptime / 3600)}h`);
    console.log(`  Requests/sec: ${health.metrics.requestsPerSecond}`);
    console.log(
      `  Error Rate: ${(health.metrics.errorRate * 100).toFixed(2)}%`
    );

    console.log("\n🔗 Dependencies:");
    Object.entries(health.dependencies).forEach(([service, status]) => {
      const emoji = status === "up" ? "✅" : status === "down" ? "❌" : "⚠️";
      console.log(`  ${emoji} ${service}: ${status.toUpperCase()}`);
    });

    if (health.details) {
      console.log("\n📋 Details:");
      Object.entries(health.details).forEach(([key, value]) => {
        console.log(`  ${key}: ${JSON.stringify(value)}`);
      });
    }
  } catch (error) {
    console.error("❌ Health check failed:", error.message);
  }
}
```

### 2. Service Diagnostics

```typescript
async function runDiagnostics() {
  console.log("🔧 Running AuthV2 Diagnostics");
  console.log("============================");

  const diagnostics = {
    services: {},
    configuration: {},
    connectivity: {},
    performance: {},
  };

  // Test service availability
  console.log("\n1. Testing Service Availability...");
  const serviceNames = [
    "AuthenticationServiceV2",
    "JWTServiceV2",
    "SessionServiceV2",
    "PermissionServiceV2",
    "CacheServiceV2",
  ];

  for (const serviceName of serviceNames) {
    try {
      const service = container.get(serviceName);
      diagnostics.services[serviceName] = service ? "available" : "unavailable";
      console.log(`  ✅ ${serviceName}: Available`);
    } catch (error) {
      diagnostics.services[serviceName] = "error";
      console.log(`  ❌ ${serviceName}: Error - ${error.message}`);
    }
  }

  // Test configuration
  console.log("\n2. Testing Configuration...");
  const requiredEnvVars = ["JWT_SECRET", "DATABASE_URL", "REDIS_HOST"];

  for (const envVar of requiredEnvVars) {
    const value = process.env[envVar];
    diagnostics.configuration[envVar] = value ? "set" : "missing";
    console.log(
      `  ${value ? "✅" : "❌"} ${envVar}: ${value ? "Set" : "Missing"}`
    );
  }

  // Test connectivity
  console.log("\n3. Testing Connectivity...");

  // Database connection
  try {
    const userService = container.get<UserServiceV2>("UserServiceV2");
    await userService.findById("test" as EntityId); // This will test DB connection
    diagnostics.connectivity.database = "connected";
    console.log("  ✅ Database: Connected");
  } catch (error) {
    diagnostics.connectivity.database = "error";
    console.log(`  ❌ Database: Error - ${error.message}`);
  }

  // Redis connection
  try {
    const cacheService = container.get<CacheServiceV2>("CacheServiceV2");
    await cacheService.set("diagnostic_test", "test_value", 10);
    const result = await cacheService.get("diagnostic_test");
    diagnostics.connectivity.redis =
      result === "test_value" ? "connected" : "error";
    console.log("  ✅ Redis: Connected");
  } catch (error) {
    diagnostics.connectivity.redis = "error";
    console.log(`  ❌ Redis: Error - ${error.message}`);
  }

  console.log("\n📊 Diagnostic Summary:", JSON.stringify(diagnostics, null, 2));

  return diagnostics;
}
```

### 3. Debug Mode Configuration

```typescript
// Enable debug mode
const debugConfig = {
  debug: {
    enabled: true,
    logLevel: "verbose",
    logCredentials: false,
    logTokens: false,
    logSteps: true,
    performanceMetrics: true,
  },
  audit: {
    enabled: true,
    detailedLogging: true,
    logAuthentication: true,
    logPermissions: true,
    logSessions: true,
  },
};

// Debug authentication flow
async function debugAuthFlow(email: string, password: string) {
  console.log("🐛 Debug Mode: Authentication Flow");
  console.log("==================================");

  const steps = [];
  const startTime = Date.now();

  try {
    // Step tracking
    const logStep = (step: string, duration?: number) => {
      const timestamp = Date.now() - startTime;
      steps.push({ step, timestamp, duration });
      console.log(
        `[${timestamp}ms] ${step}${duration ? ` (${duration}ms)` : ""}`
      );
    };

    logStep("🚀 Starting authentication");

    const stepStartTime = Date.now();
    const result = await authService.authenticate({ email, password });
    const stepDuration = Date.now() - stepStartTime;

    logStep("🔍 Authentication completed", stepDuration);

    console.log("\n📋 Authentication Result:");
    console.log(`  Success: ${result.success}`);
    console.log(`  User ID: ${result.user?.id}`);
    console.log(`  Session ID: ${result.session?.id}`);
    console.log(`  Permissions: ${result.permissions?.length || 0}`);
    console.log(`  Errors: ${result.errors.join(", ")}`);

    if (result.metadata) {
      console.log("\n📊 Metadata:");
      Object.entries(result.metadata).forEach(([key, value]) => {
        console.log(`  ${key}: ${JSON.stringify(value)}`);
      });
    }

    console.log("\n⏱️  Step Timeline:");
    steps.forEach((step, index) => {
      console.log(`  ${index + 1}. [${step.timestamp}ms] ${step.step}`);
    });
  } catch (error) {
    console.error("❌ Debug authentication error:", error);
  }
}
```

## FAQ

### Q: Why is authentication slow?

**A**: Common causes and solutions:

- **Database queries**: Enable caching, optimize queries, add indexes
- **Cache misses**: Review cache configuration and hit rates
- **Network latency**: Check Redis/database connection
- **Heavy validation**: Adjust security level configuration

### Q: How do I reset a locked account?

**A**:

```typescript
async function resetLockedAccount(email: string) {
  const userService = container.get<UserServiceV2>("UserServiceV2");
  const user = await userService.findByEmail(email);

  if (user && user.securityMetadata.lockoutUntil) {
    await userService.update(user.id, {
      securityMetadata: {
        ...user.securityMetadata,
        failedLoginAttempts: 0,
        lockoutUntil: null,
      },
    });

    console.log(`Account ${email} unlocked`);
  }
}
```

### Q: How do I clear all caches?

**A**:

```typescript
async function clearAllCaches() {
  const cacheService = container.get<CacheServiceV2>("CacheServiceV2");

  await cacheService.flush(); // Clears all cache entries
  console.log("All caches cleared");
}
```

### Q: How do I migrate sessions from AuthV1?

**A**: See the [Migration Guide](./MIGRATION_GUIDE.md) for detailed session migration procedures.

### Q: Why are permissions not loading?

**A**: Check:

1. User has assigned roles
2. Roles have assigned permissions
3. Permission cache is not stale
4. Database relationships are correct
5. Permission service is properly configured

### Q: How do I test tenant isolation?

**A**: Use the tenant isolation testing functions provided in the Multi-Tenant Problems section above.

## Getting Help

If you continue to experience issues:

1. **Check Health Status**: Run the health check dashboard
2. **Enable Debug Mode**: Use debug configuration for detailed logging
3. **Run Diagnostics**: Use the service diagnostics tool
4. **Review Logs**: Check application and system logs
5. **Contact Support**: Reach out to the AuthV2 team with diagnostic output

Remember to never include actual credentials, tokens, or sensitive data in debug output or support requests.
