# AuthV2 API Reference

## Table of Contents

1. [Core Services](#core-services)
2. [Authentication Service](#authentication-service)
3. [Session Service](#session-service)
4. [Permission Service](#permission-service)
5. [JWT Service](#jwt-service)
6. [API Key Service](#api-key-service)
7. [Cache Service](#cache-service)
8. [Audit Service](#audit-service)
9. [Types and Interfaces](#types-and-interfaces)
10. [Error Types](#error-types)
11. [Configuration Options](#configuration-options)

## Core Services

### AuthenticationServiceV2

The main authentication orchestrator providing comprehensive authentication functionality.

```typescript
class AuthenticationServiceV2 {
  constructor(
    jwtService: JWTServiceV2,
    sessionService: SessionServiceV2,
    permissionService: PermissionServiceV2,
    apiKeyService: APIKeyServiceV2,
    cacheService: CacheServiceV2,
    auditService: AuditServiceV2,
    userService: UserServiceV2,
    config?: IAuthenticationServiceConfig
  );
}
```

## Authentication Service

### Methods

#### `authenticate(credentials: IAuthenticationCredentials): Promise<IAuthenticationResult>`

Performs standard authentication with the provided credentials.

**Parameters:**

- `credentials: IAuthenticationCredentials` - Authentication credentials

**Returns:** `Promise<IAuthenticationResult>`

**Example:**

```typescript
const result = await authService.authenticate({
  email: "user@company.com",
  password: "securePassword123",
});

if (result.success) {
  console.log("User authenticated:", result.user);
  console.log("Session created:", result.session);
  console.log("Access token:", result.accessToken);
  console.log("Permissions:", result.permissions);
}
```

---

#### `authenticateSecure(credentials: IAuthenticationCredentials, options: ISecureAuthOptions): Promise<IAuthenticationResult>`

Performs enhanced authentication with additional security validation.

**Parameters:**

- `credentials: IAuthenticationCredentials` - Authentication credentials
- `options: ISecureAuthOptions` - Security options

**Returns:** `Promise<IAuthenticationResult>`

**Options:**

- `validateInput: boolean` - Enable runtime input validation
- `securityLevel: SecurityLevel` - Security level ('basic' | 'standard' | 'enhanced' | 'maximum')
- `tenantId?: string` - Optional tenant ID for multi-tenant validation

**Example:**

```typescript
const result = await authService.authenticateSecure(
  { email: "admin@company.com", password: "adminPassword" },
  {
    validateInput: true,
    securityLevel: "maximum",
    tenantId: "store_123",
  }
);

if (result.success) {
  console.log("Secure authentication successful");
  console.log("Security level:", result.metadata?.securityLevel);
  console.log("Input validated:", result.metadata?.inputValidated);
}
```

---

#### `authenticateWithTenantContext(credentials: IAuthenticationCredentials, tenantId: string): Promise<IAuthenticationResult>`

Performs authentication with tenant context validation.

**Parameters:**

- `credentials: IAuthenticationCredentials` - Authentication credentials
- `tenantId: string` - Tenant identifier (store ID, organization ID, etc.)

**Returns:** `Promise<IAuthenticationResult>`

**Example:**

```typescript
const result = await authService.authenticateWithTenantContext(
  { email: "manager@company.com", password: "managerPassword" },
  "store_456"
);

if (result.success && result.metadata?.tenantValidated) {
  console.log("Multi-tenant authentication successful");
  console.log("Tenant ID:", result.metadata.tenantId);
}
```

---

#### `getContextBySession(sessionId: SessionId): Promise<IAuthenticationContext | null>`

Retrieves authentication context by session ID.

**Parameters:**

- `sessionId: SessionId` - Session identifier

**Returns:** `Promise<IAuthenticationContext | null>`

**Example:**

```typescript
const context = await authService.getContextBySession(
  "session_abc123" as SessionId
);

if (context) {
  console.log("User:", context.user);
  console.log("Session:", context.session);
  console.log("Permissions:", context.permissions);
}
```

---

#### `getContextByJWT(token: string): Promise<IAuthenticationContext | null>`

Retrieves authentication context by JWT token.

**Parameters:**

- `token: string` - JWT token

**Returns:** `Promise<IAuthenticationContext | null>`

**Example:**

```typescript
const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...";
const context = await authService.getContextByJWT(token);

if (context) {
  console.log("Token-based context retrieved");
  console.log("User ID:", context.user.id);
}
```

---

#### `validateTenantContext(context: IAuthenticationContext, tenantId: string): Promise<boolean>`

Validates if user has access to the specified tenant.

**Parameters:**

- `context: IAuthenticationContext` - User authentication context
- `tenantId: string` - Tenant identifier to validate

**Returns:** `Promise<boolean>`

**Example:**

```typescript
const hasAccess = await authService.validateTenantContext(
  userContext,
  "store_789"
);

if (hasAccess) {
  console.log("User has access to tenant");
} else {
  console.log("Tenant access denied");
}
```

---

#### `validateContext(context: IAuthenticationContext): Promise<IValidationResult>`

Validates the provided authentication context.

**Parameters:**

- `context: IAuthenticationContext` - Context to validate

**Returns:** `Promise<IValidationResult>`

**Example:**

```typescript
const validation = await authService.validateContext(userContext);

if (validation.success) {
  console.log("Context is valid");
} else {
  console.log("Context validation failed:", validation.errors);
}
```

---

#### `refreshContext(context: IAuthenticationContext): Promise<IAuthenticationResult>`

Refreshes the authentication context and tokens.

**Parameters:**

- `context: IAuthenticationContext` - Context to refresh

**Returns:** `Promise<IAuthenticationResult>`

**Example:**

```typescript
const refreshed = await authService.refreshContext(userContext);

if (refreshed.success) {
  console.log("Context refreshed");
  console.log("New access token:", refreshed.accessToken);
}
```

---

#### `logout(context: IAuthenticationContext): Promise<boolean>`

Logs out the user and invalidates the session.

**Parameters:**

- `context: IAuthenticationContext` - User context to logout

**Returns:** `Promise<boolean>`

**Example:**

```typescript
const loggedOut = await authService.logout(userContext);

if (loggedOut) {
  console.log("User successfully logged out");
}
```

---

#### `getHealth(): Promise<IHealthCheck>`

Returns the health status of the authentication service.

**Returns:** `Promise<IHealthCheck>`

**Example:**

```typescript
const health = await authService.getHealth();

console.log("Service status:", health.status);
console.log("Dependencies:", health.dependencies);
console.log("Metrics:", health.metrics);
```

## Session Service

### Methods

#### `create(session: ISessionCreation): Promise<IEnhancedSession>`

Creates a new session.

**Parameters:**

- `session: ISessionCreation` - Session creation data

**Returns:** `Promise<IEnhancedSession>`

---

#### `findBySessionId(sessionId: SessionId): Promise<IEnhancedSession | null>`

Finds a session by its ID.

**Parameters:**

- `sessionId: SessionId` - Session identifier

**Returns:** `Promise<IEnhancedSession | null>`

---

#### `findByUserId(userId: EntityId): Promise<IEnhancedSession[]>`

Finds all active sessions for a user.

**Parameters:**

- `userId: EntityId` - User identifier

**Returns:** `Promise<IEnhancedSession[]>`

---

#### `update(sessionId: SessionId, updates: Partial<ISessionUpdate>): Promise<IEnhancedSession | null>`

Updates a session with new data.

**Parameters:**

- `sessionId: SessionId` - Session identifier
- `updates: Partial<ISessionUpdate>` - Updates to apply

**Returns:** `Promise<IEnhancedSession | null>`

---

#### `end(sessionId: SessionId): Promise<boolean>`

Ends a specific session.

**Parameters:**

- `sessionId: SessionId` - Session to end

**Returns:** `Promise<boolean>`

---

#### `endAllUserSessions(userId: EntityId): Promise<number>`

Ends all sessions for a specific user.

**Parameters:**

- `userId: EntityId` - User whose sessions to end

**Returns:** `Promise<number>` - Number of sessions ended

---

#### `getSessionAnalytics(userId: EntityId): Promise<ISessionAnalytics>`

Gets session analytics for a user.

**Parameters:**

- `userId: EntityId` - User identifier

**Returns:** `Promise<ISessionAnalytics>`

## Permission Service

### Methods

#### `getUserPermissions(userId: EntityId): Promise<IEnhancedPermission[]>`

Gets all permissions for a user.

**Parameters:**

- `userId: EntityId` - User identifier

**Returns:** `Promise<IEnhancedPermission[]>`

---

#### `getRolePermissions(roleId: EntityId): Promise<IEnhancedPermission[]>`

Gets all permissions for a role.

**Parameters:**

- `roleId: EntityId` - Role identifier

**Returns:** `Promise<IEnhancedPermission[]>`

---

#### `hasPermission(userId: EntityId, resource: string, action: string): Promise<boolean>`

Checks if user has a specific permission.

**Parameters:**

- `userId: EntityId` - User identifier
- `resource: string` - Resource name
- `action: string` - Action name

**Returns:** `Promise<boolean>`

---

#### `hasPermissions(userId: EntityId, permissions: string[]): Promise<boolean>`

Checks if user has all specified permissions.

**Parameters:**

- `userId: EntityId` - User identifier
- `permissions: string[]` - Array of permission strings (format: 'resource:action')

**Returns:** `Promise<boolean>`

---

#### `evaluatePermission(userId: EntityId, resource: string, action: string, context?: any): Promise<boolean>`

Evaluates permission with additional context.

**Parameters:**

- `userId: EntityId` - User identifier
- `resource: string` - Resource name
- `action: string` - Action name
- `context?: any` - Additional evaluation context

**Returns:** `Promise<boolean>`

## Types and Interfaces

### Core Types

```typescript
type EntityId = string;
type SessionId = string;
type SecurityLevel = "basic" | "standard" | "enhanced" | "maximum";
```

### Authentication Interfaces

```typescript
interface IAuthenticationCredentials {
  email?: string;
  password?: string;
  token?: string;
  apiKey?: string;
}

interface IAuthenticationResult {
  success: boolean;
  user?: IEnhancedUser;
  session?: IEnhancedSession;
  permissions?: IEnhancedPermission[];
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: Date;
  errors: string[];
  metadata?: Record<string, any>;
}

interface IAuthenticationContext {
  user: IEnhancedUser;
  session: IEnhancedSession;
  permissions: IEnhancedPermission[];
  metadata?: Record<string, any>;
}

interface ISecureAuthOptions {
  validateInput: boolean;
  securityLevel: SecurityLevel;
  tenantId?: string;
}
```

### Enhanced Model Interfaces

```typescript
interface IEnhancedUser {
  id: EntityId;
  email: string;
  name: string;
  roleId: EntityId;
  storeId?: EntityId;
  organizationId?: EntityId;
  isActive: boolean;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
  securityMetadata: IUserSecurityMetadata;
  preferences: IUserPreferences;
}

interface IUserSecurityMetadata {
  failedLoginAttempts: number;
  lastFailedLoginAt?: Date;
  lockoutUntil?: Date;
  passwordChangedAt: Date;
  mfaEnabled: boolean;
  trustedDevicesCount: number;
  riskScore: number;
}

interface IUserPreferences {
  theme: "light" | "dark" | "auto";
  language: string;
  notifications: INotificationPreferences;
  privacy: IPrivacyPreferences;
}

interface IEnhancedSession {
  id: SessionId;
  userId: EntityId;
  sessionId: SessionId;
  deviceInfo: string;
  ipAddress: string;
  userAgent: string;
  createdAt: Date;
  expiresAt: Date;
  lastAccessedAt: Date;
  isActive: boolean;
  metadata: ISessionMetadata;
  securityContext: ISessionSecurityContext;
}

interface ISessionMetadata {
  loginMethod: "password" | "token" | "apiKey";
  deviceFingerprint: string;
  geoLocation?: string;
  tenantContext?: string;
}

interface ISessionSecurityContext {
  riskScore: number;
  trustedDevice: boolean;
  mfaVerified: boolean;
  securityLevel: SecurityLevel;
}

interface IEnhancedRole {
  id: EntityId;
  name: string;
  description: string;
  level: number;
  organizationId?: EntityId;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  metadata: IRoleMetadata;
}

interface IRoleMetadata {
  category: "system" | "organizational" | "functional";
  scope: "global" | "tenant" | "local";
  inheritanceLevel: number;
  customProperties: Record<string, any>;
}

interface IEnhancedPermission {
  id: EntityId;
  name: string;
  resource: string;
  action: string;
  effect: "allow" | "deny";
  conditions?: string[];
  organizationId?: EntityId;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  metadata: IPermissionMetadata;
}

interface IPermissionMetadata {
  category: "system" | "business" | "custom";
  priority: number;
  contextRequired: boolean;
  auditRequired: boolean;
}
```

### Service Configuration Interfaces

```typescript
interface IAuthenticationServiceConfig {
  validation?: {
    strictMode?: boolean;
    passwordComplexity?: boolean;
    deviceValidation?: boolean;
  };
  rateLimit?: {
    enabled?: boolean;
    maxAttempts?: number;
    windowMs?: number;
    progressivePenalty?: boolean;
  };
  cache?: {
    enabled?: boolean;
    authenticationResultTTL?: number;
    validationResultTTL?: number;
  };
  audit?: {
    enabled?: boolean;
    detailedLogging?: boolean;
  };
  metrics?: {
    enabled?: boolean;
    responseTimeTracking?: boolean;
  };
  security?: {
    sessionTimeout?: number;
    tokenRefreshThreshold?: number;
  };
}
```

### Validation and Health Interfaces

```typescript
interface IValidationResult {
  success: boolean;
  errors: string[];
  metadata?: Record<string, any>;
}

interface IHealthCheck {
  status: "healthy" | "degraded" | "unhealthy";
  dependencies: Record<string, "up" | "down" | "unknown">;
  metrics: {
    responseTime: number;
    uptime: number;
    requestsPerSecond: number;
    errorRate: number;
  };
  details?: Record<string, any>;
}
```

## Error Types

### AuthenticationError

```typescript
class AuthenticationError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, any>
  );
}
```

### Common Error Codes

- `invalid_credentials` - Invalid email or password
- `account_locked` - Account locked due to failed attempts
- `tenant_access_denied` - User doesn't have access to tenant
- `session_expired` - Session has expired
- `token_invalid` - Invalid or expired token
- `permission_denied` - Insufficient permissions
- `rate_limit_exceeded` - Too many requests
- `validation_failed` - Input validation failed
- `service_unavailable` - Authentication service unavailable

## Configuration Options

### Environment Variables

```bash
# JWT Configuration
JWT_SECRET=your-jwt-secret
JWT_EXPIRES_IN=1h
JWT_REFRESH_EXPIRES_IN=7d

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password

# Database Configuration
DATABASE_URL=postgresql://user:password@localhost:5432/database

# Service Configuration
AUTH_RATE_LIMIT_ENABLED=true
AUTH_RATE_LIMIT_MAX_ATTEMPTS=5
AUTH_RATE_LIMIT_WINDOW_MS=900000

AUTH_CACHE_ENABLED=true
AUTH_CACHE_TTL=300

AUTH_AUDIT_ENABLED=true
AUTH_AUDIT_DETAILED=true

AUTH_SECURITY_STRICT_MODE=true
AUTH_SECURITY_PASSWORD_COMPLEXITY=true
```

### Runtime Configuration

```typescript
import { IAuthenticationServiceConfig } from "@libs/authV2";

const config: IAuthenticationServiceConfig = {
  validation: {
    strictMode: process.env.NODE_ENV === "production",
    passwordComplexity: true,
    deviceValidation: process.env.NODE_ENV === "production",
  },
  rateLimit: {
    enabled: process.env.AUTH_RATE_LIMIT_ENABLED === "true",
    maxAttempts: parseInt(process.env.AUTH_RATE_LIMIT_MAX_ATTEMPTS || "5"),
    windowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS || "900000"),
  },
  cache: {
    enabled: process.env.AUTH_CACHE_ENABLED === "true",
    authenticationResultTTL: parseInt(process.env.AUTH_CACHE_TTL || "300"),
  },
  audit: {
    enabled: process.env.AUTH_AUDIT_ENABLED === "true",
    detailedLogging: process.env.AUTH_AUDIT_DETAILED === "true",
  },
};
```

## Best Practices

### Error Handling

```typescript
// Always handle authentication results properly
try {
  const result = await authService.authenticate(credentials);

  if (!result.success) {
    // Log for debugging
    logger.warn("Authentication failed", {
      errors: result.errors,
      metadata: result.metadata,
    });

    // Return user-friendly message
    return { success: false, message: "Authentication failed" };
  }

  // Success handling
  return { success: true, user: result.user };
} catch (error) {
  logger.error("Authentication error", error);
  return { success: false, message: "Authentication service error" };
}
```

### Type Guards

```typescript
import { EnhancedTypeGuards } from "@libs/authV2";

function processUser(user: any) {
  // Validate enhanced user
  if (!EnhancedTypeGuards.isEnhancedUser(user)) {
    throw new Error("Invalid user object");
  }

  // Now TypeScript knows it's IEnhancedUser
  console.log("Security metadata:", user.securityMetadata);
  console.log("Preferences:", user.preferences);
}
```

### Caching

```typescript
// Use caching for expensive operations
const cacheKey = `user:permissions:${userId}`;
let permissions = await cacheService.get(cacheKey);

if (!permissions) {
  permissions = await permissionService.getUserPermissions(userId);
  await cacheService.set(cacheKey, permissions, 300); // 5 minutes
}

return permissions;
```

This API reference provides comprehensive documentation for all AuthV2 services, types, and configuration options. Use it as a reference when implementing authentication features in your application.
