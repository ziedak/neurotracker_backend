# AuthV2 Enterprise Authentication - Complete Usage Guide

## Table of Contents

1. [Quick Start Guide](#quick-start-guide)
2. [Service Integration](#service-integration)
3. [Basic Authentication](#basic-authentication)
4. [Multi-Tenant Authentication](#multi-tenant-authentication)
5. [Enhanced Security Features](#enhanced-security-features)
6. [Session Management](#session-management)
7. [Permission System](#permission-system)
8. [Error Handling](#error-handling)
9. [Configuration](#configuration)
10. [Migration Guide](#migration-guide)

## Quick Start Guide

### Installation

```bash
# Install dependencies
npm install @libs/authV2 @libs/database @libs/config

# Import the main services
import {
  AuthenticationServiceV2,
  SessionServiceV2,
  PermissionServiceV2,
  JWTServiceV2,
  APIKeyServiceV2
} from '@libs/authV2';
```

### Basic Setup

```typescript
import { Container } from "@libs/config";
import { AuthenticationServiceV2 } from "@libs/authV2";

// Initialize container with dependencies
const container = Container.getInstance();

// Get the authentication service
const authService = container.get<AuthenticationServiceV2>(
  "AuthenticationServiceV2"
);

// Basic authentication
async function basicLogin() {
  const result = await authService.authenticate({
    email: "user@company.com",
    password: "securePassword123",
  });

  if (result.success) {
    console.log("Authentication successful!");
    console.log("User:", result.user?.email);
    console.log("Session ID:", result.session?.id);
    console.log("Permissions:", result.permissions);
  }
}
```

## Service Integration

### Dependency Injection Setup

```typescript
// container.config.ts
import { Container } from "@libs/config";
import {
  AuthenticationServiceV2,
  JWTServiceV2,
  SessionServiceV2,
  PermissionServiceV2,
  APIKeyServiceV2,
  CacheServiceV2,
  AuditServiceV2,
  UserServiceV2,
} from "@libs/authV2";

export function configureAuthServices(container: Container) {
  // Core services
  container
    .bind<JWTServiceV2>("JWTServiceV2")
    .to(JWTServiceV2)
    .inSingletonScope();
  container
    .bind<SessionServiceV2>("SessionServiceV2")
    .to(SessionServiceV2)
    .inSingletonScope();
  container
    .bind<PermissionServiceV2>("PermissionServiceV2")
    .to(PermissionServiceV2)
    .inSingletonScope();
  container
    .bind<APIKeyServiceV2>("APIKeyServiceV2")
    .to(APIKeyServiceV2)
    .inSingletonScope();
  container
    .bind<CacheServiceV2>("CacheServiceV2")
    .to(CacheServiceV2)
    .inSingletonScope();
  container
    .bind<AuditServiceV2>("AuditServiceV2")
    .to(AuditServiceV2)
    .inSingletonScope();
  container
    .bind<UserServiceV2>("UserServiceV2")
    .to(UserServiceV2)
    .inSingletonScope();

  // Main authentication service
  container
    .bind<AuthenticationServiceV2>("AuthenticationServiceV2")
    .to(AuthenticationServiceV2)
    .inSingletonScope();
}
```

### Manual Service Creation

```typescript
// manual-setup.ts
import {
  AuthenticationServiceV2,
  JWTServiceV2,
  SessionServiceV2,
  PermissionServiceV2,
  APIKeyServiceV2,
  CacheServiceV2,
  AuditServiceV2,
  UserServiceV2,
} from "@libs/authV2";

// Create service instances
const jwtService = new JWTServiceV2(/* JWT config */);
const sessionService = new SessionServiceV2(/* session config */);
const permissionService = new PermissionServiceV2(/* permission config */);
const apiKeyService = new APIKeyServiceV2(/* API key config */);
const cacheService = new CacheServiceV2(/* cache config */);
const auditService = new AuditServiceV2(/* audit config */);
const userService = new UserServiceV2(/* user config */);

// Create main authentication service
const authService = new AuthenticationServiceV2(
  jwtService,
  sessionService,
  permissionService,
  apiKeyService,
  cacheService,
  auditService,
  userService,
  {
    validation: { strictMode: true, passwordComplexity: true },
    rateLimit: { enabled: true, maxAttempts: 5, windowMs: 900000 },
    cache: { enabled: true, authenticationResultTTL: 300 },
    audit: { enabled: true, detailedLogging: true },
  }
);
```

## Basic Authentication

### Password-Based Authentication

```typescript
import { IAuthenticationCredentials } from "@libs/authV2";

async function passwordAuthentication() {
  const credentials: IAuthenticationCredentials = {
    email: "user@company.com",
    password: "mySecurePassword",
  };

  try {
    const result = await authService.authenticate(credentials);

    if (result.success) {
      console.log("✅ Authentication successful");
      console.log("User ID:", result.user?.id);
      console.log("Email:", result.user?.email);
      console.log("Session ID:", result.session?.id);
      console.log("Access Token:", result.accessToken);
      console.log("Permissions:", result.permissions);
      console.log("Expires At:", result.expiresAt);
    } else {
      console.log("❌ Authentication failed");
      console.log("Errors:", result.errors);
    }
  } catch (error) {
    console.error("Authentication error:", error);
  }
}
```

### API Key Authentication

```typescript
async function apiKeyAuthentication() {
  const credentials: IAuthenticationCredentials = {
    apiKey: "ak_1234567890abcdef",
  };

  const result = await authService.authenticate(credentials);

  if (result.success) {
    console.log("API Key authentication successful");
    console.log("API Key metadata:", result.metadata);
  }
}
```

### JWT Token Authentication

```typescript
async function jwtAuthentication() {
  const credentials: IAuthenticationCredentials = {
    token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  };

  const result = await authService.authenticate(credentials);

  if (result.success) {
    console.log("JWT authentication successful");
    console.log("Token payload:", result.metadata);
  }
}
```

## Multi-Tenant Authentication

### Store-Based Multi-Tenancy

```typescript
async function storeBasedAuthentication() {
  const credentials: IAuthenticationCredentials = {
    email: "store-manager@company.com",
    password: "storePassword123",
  };

  const storeId = "store_12345";

  // Authenticate with tenant context
  const result = await authService.authenticateWithTenantContext(
    credentials,
    storeId
  );

  if (result.success) {
    console.log("✅ Multi-tenant authentication successful");
    console.log("Store ID:", result.metadata?.tenantId);
    console.log("User Store Access:", result.user?.storeId);
    console.log("Tenant Validated:", result.metadata?.tenantValidated);
  } else {
    console.log("❌ Tenant access denied");
    console.log("Error:", result.metadata?.error);
  }
}
```

### Organization-Based Multi-Tenancy

```typescript
async function organizationBasedAuthentication() {
  const credentials: IAuthenticationCredentials = {
    email: "org-admin@enterprise.com",
    password: "orgAdminPassword",
  };

  const organizationId = "org_67890";

  const result = await authService.authenticateWithTenantContext(
    credentials,
    organizationId
  );

  if (result.success && result.user) {
    console.log("Organization authentication successful");
    console.log("Organization ID:", result.user.organizationId);
    console.log("User Role:", result.user.roleId);
  }
}
```

### Tenant Context Validation

```typescript
async function validateUserTenantAccess() {
  // Get current user context
  const context = await authService.getContextBySession(
    "session_abc123" as SessionId
  );

  if (context) {
    // Validate access to specific tenant
    const hasStoreAccess = await authService.validateTenantContext(
      context,
      "store_12345"
    );
    const hasOrgAccess = await authService.validateTenantContext(
      context,
      "org_67890"
    );

    console.log("Store access:", hasStoreAccess);
    console.log("Organization access:", hasOrgAccess);

    // Enhanced user properties
    if (context.metadata?.enhancedSecurity) {
      const security = context.metadata.enhancedSecurity;
      console.log("Failed login attempts:", security.failedLoginAttempts);
      console.log("MFA enabled:", security.mfaEnabled);
      console.log("Trusted devices:", security.trustedDevicesCount);
    }
  }
}
```

## Enhanced Security Features

### Secure Authentication with Validation

```typescript
async function secureAuthentication() {
  const credentials: IAuthenticationCredentials = {
    email: "admin@company.com",
    password: "complexAdminPassword123!",
  };

  const result = await authService.authenticateSecure(credentials, {
    validateInput: true, // Enable runtime input validation
    securityLevel: "maximum", // Use highest security level
    tenantId: "store_12345", // Include tenant validation
  });

  if (result.success) {
    console.log("✅ Secure authentication successful");
    console.log("Security level:", result.metadata?.securityLevel);
    console.log("Input validated:", result.metadata?.inputValidated);
    console.log("Enhanced security:", result.metadata?.enhancedSecurity);
    console.log("Phase 4 features:", result.metadata?.phase4Features);
  } else {
    console.log("❌ Secure authentication failed");
    console.log("Validation errors:", result.metadata?.validationErrors);
  }
}
```

### Configurable Security Levels

```typescript
// Basic security (minimal validation)
const basicResult = await authService.authenticateSecure(credentials, {
  securityLevel: "basic",
  validateInput: false,
});

// Standard security (moderate validation)
const standardResult = await authService.authenticateSecure(credentials, {
  securityLevel: "standard",
  validateInput: true,
});

// Enhanced security (comprehensive validation)
const enhancedResult = await authService.authenticateSecure(credentials, {
  securityLevel: "enhanced",
  validateInput: true,
  tenantId: "store_12345",
});

// Maximum security (full validation + audit)
const maximumResult = await authService.authenticateSecure(credentials, {
  securityLevel: "maximum",
  validateInput: true,
  tenantId: "org_67890",
});
```

## Session Management

### Creating and Managing Sessions

```typescript
async function sessionManagement() {
  // Authenticate and create session
  const authResult = await authService.authenticate({
    email: "user@company.com",
    password: "userPassword",
  });

  if (authResult.success && authResult.session) {
    const sessionId = authResult.session.id as SessionId;

    // Get session context
    const context = await authService.getContextBySession(sessionId);
    console.log("Session context:", context);

    // Validate session
    const validation = await authService.validateContext(context!);
    console.log("Session valid:", validation.success);

    // End session
    const ended = await authService.logout(context!);
    console.log("Session ended:", ended);
  }
}
```

### Multi-Session Management

```typescript
async function multiSessionManagement() {
  const sessionService = container.get<SessionServiceV2>("SessionServiceV2");

  const userId = "user_12345" as EntityId;

  // Get all user sessions
  const sessions = await sessionService.findByUserId(userId);
  console.log("Active sessions:", sessions.length);

  // End all sessions except current
  const currentSessionId = "session_current" as SessionId;
  for (const session of sessions) {
    if (session.sessionId !== currentSessionId) {
      await sessionService.end(session.sessionId as SessionId);
      console.log("Ended session:", session.sessionId);
    }
  }

  // Session analytics
  const analytics = await sessionService.getSessionAnalytics(userId);
  console.log("Session analytics:", analytics);
}
```

## Permission System

### Role-Based Access Control

```typescript
async function permissionManagement() {
  const permissionService = container.get<PermissionServiceV2>(
    "PermissionServiceV2"
  );

  const userId = "user_12345" as EntityId;

  // Get user permissions
  const permissions = await permissionService.getUserPermissions(userId);
  console.log(
    "User permissions:",
    permissions.map((p) => p.name)
  );

  // Check specific permission
  const canEditUsers = await permissionService.hasPermission(
    userId,
    "user",
    "edit"
  );
  console.log("Can edit users:", canEditUsers);

  // Check multiple permissions
  const hasPermissions = await permissionService.hasPermissions(userId, [
    "user:create",
    "user:read",
    "user:update",
  ]);
  console.log("Has user management permissions:", hasPermissions);

  // Get role permissions
  const roleId = "role_admin" as EntityId;
  const rolePermissions = await permissionService.getRolePermissions(roleId);
  console.log(
    "Role permissions:",
    rolePermissions.map((p) => p.name)
  );
}
```

### Dynamic Permission Evaluation

```typescript
async function dynamicPermissions() {
  const permissionService = container.get<PermissionServiceV2>(
    "PermissionServiceV2"
  );

  const userId = "user_12345" as EntityId;
  const resource = "document_sensitive";

  // Context-based permission check
  const context = {
    userId,
    tenantId: "store_12345",
    timeOfDay: new Date().getHours(),
    location: "office",
    riskScore: 0.2,
  };

  const hasAccess = await permissionService.evaluatePermission(
    userId,
    "document",
    "read",
    context
  );

  console.log("Context-based access granted:", hasAccess);
}
```

## Error Handling

### Comprehensive Error Handling

```typescript
import { AuthenticationError } from "@libs/authV2";

async function robustAuthentication() {
  try {
    const result = await authService.authenticate({
      email: "user@company.com",
      password: "password",
    });

    if (!result.success) {
      // Handle authentication failure
      console.log("Authentication failed");

      // Check specific error types
      if (result.errors.includes("invalid_credentials")) {
        console.log("Invalid email or password");
      } else if (result.errors.includes("account_locked")) {
        console.log("Account is locked due to too many failed attempts");
      } else if (result.errors.includes("tenant_access_denied")) {
        console.log("User does not have access to this tenant");
      }

      // Metadata provides additional context
      if (result.metadata?.error) {
        console.log("Error details:", result.metadata.error);
      }
    }
  } catch (error) {
    if (error instanceof AuthenticationError) {
      console.log("Authentication service error:", error.message);
    } else {
      console.log("Unexpected error:", error);
    }
  }
}
```

### Rate Limiting Errors

```typescript
async function handleRateLimiting() {
  try {
    const result = await authService.authenticate(credentials);

    if (!result.success && result.metadata?.rateLimited) {
      console.log("Rate limit exceeded");
      console.log("Retry after:", result.metadata.retryAfter);
      console.log("Attempts remaining:", result.metadata.attemptsRemaining);
    }
  } catch (error) {
    console.log("Rate limit error:", error);
  }
}
```

## Configuration

### Enterprise Configuration

```typescript
// auth.config.ts
import { IAuthenticationServiceConfig } from "@libs/authV2";

export const enterpriseAuthConfig: IAuthenticationServiceConfig = {
  validation: {
    strictMode: true,
    passwordComplexity: true,
    deviceValidation: true,
  },
  rateLimit: {
    enabled: true,
    maxAttempts: 3, // Strict rate limiting
    windowMs: 1800000, // 30 minutes
    progressivePenalty: true, // Increase penalties
  },
  cache: {
    enabled: true,
    authenticationResultTTL: 300, // 5 minutes
    validationResultTTL: 60, // 1 minute
  },
  audit: {
    enabled: true,
    detailedLogging: true, // Full audit trail
  },
  metrics: {
    enabled: true,
    responseTimeTracking: true,
  },
  security: {
    sessionTimeout: 3600000, // 1 hour
    tokenRefreshThreshold: 300000, // 5 minutes
  },
};

// Initialize with enterprise config
const authService = new AuthenticationServiceV2(
  jwtService,
  sessionService,
  permissionService,
  apiKeyService,
  cacheService,
  auditService,
  userService,
  enterpriseAuthConfig
);
```

### Development Configuration

```typescript
// dev.config.ts
export const developmentAuthConfig: IAuthenticationServiceConfig = {
  validation: {
    strictMode: false, // Relaxed for development
    passwordComplexity: false,
    deviceValidation: false,
  },
  rateLimit: {
    enabled: false, // Disabled for development
  },
  cache: {
    enabled: true,
    authenticationResultTTL: 60, // Shorter cache for dev
    validationResultTTL: 30,
  },
  audit: {
    enabled: true,
    detailedLogging: false, // Less verbose logging
  },
  metrics: {
    enabled: false, // Disabled for dev
  },
  security: {
    sessionTimeout: 86400000, // 24 hours for dev
    tokenRefreshThreshold: 600000, // 10 minutes
  },
};
```

## Migration Guide

### From AuthV1 to AuthV2

```typescript
// OLD AuthV1 approach
import { AuthService } from "@libs/auth";

const oldAuthService = new AuthService();
const result = await oldAuthService.login(email, password);

// NEW AuthV2 approach
import { AuthenticationServiceV2 } from "@libs/authV2";

const newAuthService = container.get<AuthenticationServiceV2>(
  "AuthenticationServiceV2"
);
const result = await newAuthService.authenticate({ email, password });

// Migration helper
class AuthMigrationHelper {
  constructor(
    private oldService: AuthService,
    private newService: AuthenticationServiceV2
  ) {}

  async migrateUser(userId: string) {
    // Get old user context
    const oldContext = await this.oldService.getUserContext(userId);

    // Migrate to new context
    const newContext = await this.newService.getContextBySession(
      oldContext.sessionId as SessionId
    );

    return newContext;
  }
}
```

### Enhanced Models Migration

```typescript
// OLD basic user handling
interface BasicUser {
  id: string;
  email: string;
  name: string;
}

// NEW enhanced user handling
import { IEnhancedUser, EnhancedTypeGuards } from "@libs/authV2";

function handleEnhancedUser(user: IEnhancedUser) {
  // Validate enhanced user
  if (!EnhancedTypeGuards.isEnhancedUser(user)) {
    throw new Error("Invalid enhanced user");
  }

  // Access enhanced properties
  console.log("Security metadata:", user.securityMetadata);
  console.log("User preferences:", user.preferences);
  console.log(
    "Failed login attempts:",
    user.securityMetadata.failedLoginAttempts
  );
  console.log("MFA enabled:", user.securityMetadata.mfaEnabled);
  console.log("Theme preference:", user.preferences.theme);
}
```

## Best Practices

### 1. Always Use Dependency Injection

```typescript
// ✅ GOOD - Use dependency injection
class UserController {
  constructor(
    @inject("AuthenticationServiceV2")
    private authService: AuthenticationServiceV2
  ) {}
}

// ❌ BAD - Direct instantiation
class UserController {
  private authService = new AuthenticationServiceV2(/* manual deps */);
}
```

### 2. Implement Proper Error Handling

```typescript
// ✅ GOOD - Comprehensive error handling
async function authenticateUser(credentials: IAuthenticationCredentials) {
  try {
    const result = await authService.authenticate(credentials);

    if (!result.success) {
      // Log specific errors
      logger.warn("Authentication failed", {
        errors: result.errors,
        metadata: result.metadata,
      });
      return { success: false, message: "Authentication failed" };
    }

    return { success: true, user: result.user };
  } catch (error) {
    logger.error("Authentication error", error);
    return { success: false, message: "Internal authentication error" };
  }
}

// ❌ BAD - No error handling
async function authenticateUser(credentials: IAuthenticationCredentials) {
  const result = await authService.authenticate(credentials);
  return result.user; // This could throw or return undefined
}
```

### 3. Use Multi-Tenant Authentication for Enterprise

```typescript
// ✅ GOOD - Multi-tenant aware
async function enterpriseLogin(
  credentials: IAuthenticationCredentials,
  tenantId: string
) {
  const result = await authService.authenticateWithTenantContext(
    credentials,
    tenantId
  );

  if (result.success) {
    // Ensure tenant validation
    if (result.metadata?.tenantValidated) {
      return result;
    } else {
      throw new Error("Tenant validation failed");
    }
  }
}

// ❌ BAD - No tenant awareness
async function basicLogin(credentials: IAuthenticationCredentials) {
  return await authService.authenticate(credentials); // No tenant context
}
```

### 4. Leverage Enhanced Security Features

```typescript
// ✅ GOOD - Use enhanced security
const result = await authService.authenticateSecure(credentials, {
  validateInput: true,
  securityLevel: "enhanced",
  tenantId: userTenantId,
});

// ❌ BAD - Basic authentication only
const result = await authService.authenticate(credentials);
```

### 5. Monitor and Audit

```typescript
// ✅ GOOD - Enable comprehensive monitoring
const authConfig = {
  audit: { enabled: true, detailedLogging: true },
  metrics: { enabled: true, responseTimeTracking: true },
};

// Check health regularly
const health = await authService.getHealth();
if (health.status !== "healthy") {
  logger.warn("Auth service health degraded", health);
}
```

This comprehensive guide provides everything needed to successfully implement and use the AuthV2 enterprise authentication system with all its advanced features including multi-tenancy, enhanced security, and comprehensive session management.
