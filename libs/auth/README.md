# 🔐 @libs/auth - Complete Usage Documentation

## 📋 Table of Contents

1. [Installation & Setup](#installation--setup)
2. [Quick Start Guide](#quick-start-guide)
3. [Configuration](#configuration)
4. [Authentication Methods](#authentication-methods)
5. [Authorization & Permissions](#authorization--permissions)
6. [Middleware Integration](#middleware-integration)
7. [API Reference](#api-reference)
8. [Advanced Features](#advanced-features)
9. [Security Best Practices](#security-best-practices)
10. [Troubleshooting](#troubleshooting)
11. [Examples](#examples)

---

## 🚀 Installation & Setup

### Prerequisites

- Node.js 18+
- TypeScript 5.0+
- ElysiaJS 1.0+
- PostgreSQL database
- Redis instance
- Keycloak server (optional)

### Installation

```bash
# Install the auth library (workspace package)
cd libs/auth
npm install

# Build the library
npm run build
```

### Environment Variables

Create a `.env` file with the following variables:

```bash
# Database Configuration
DATABASE_URL="postgresql://user:password@localhost:5432/mydb"

# Redis Configuration
REDIS_HOST="localhost"
REDIS_PORT=6379
REDIS_PASSWORD=""
REDIS_DB=0

# JWT Configuration
JWT_SECRET="your-super-secret-jwt-key-min-32-chars"
JWT_EXPIRES_IN="15m"
JWT_REFRESH_EXPIRES_IN="7d"
JWT_ISSUER="your-app"
JWT_AUDIENCE="your-app-users"

# Keycloak Configuration (Optional)
KEYCLOAK_SERVER_URL="http://localhost:8080"
KEYCLOAK_REALM="your-realm"
KEYCLOAK_CLIENT_ID="your-client-id"
KEYCLOAK_CLIENT_SECRET="your-client-secret"
KEYCLOAK_ADMIN_USERNAME="admin"
KEYCLOAK_ADMIN_PASSWORD="your-admin-password"

# Session Configuration
SESSION_TTL=3600
SESSION_REFRESH_THRESHOLD=900

# API Key Configuration
API_KEY_PREFIX="nk_"
API_KEY_LENGTH=32
```

---

## 🏁 Quick Start Guide

### Basic Setup

```typescript
import { setupBasicAuth } from "@libs/auth";
import { getEnv } from "@libs/config";
import { createLogger } from "@libs/monitoring";
import { ConnectionPoolManager } from "@libs/database";

// 1. Create dependencies
const logger = createLogger("auth");
const database = new ConnectionPoolManager(logger);
const redis = new Redis({
  host: getEnv("REDIS_HOST"),
  port: parseInt(getEnv("REDIS_PORT")),
});

const config = {
  jwt: {
    secret: getEnv("JWT_SECRET"),
    expiresIn: getEnv("JWT_EXPIRES_IN", "15m"),
    refreshExpiresIn: getEnv("JWT_REFRESH_EXPIRES_IN", "7d"),
    issuer: getEnv("JWT_ISSUER", "your-app"),
    audience: getEnv("JWT_AUDIENCE", "your-app-users"),
  },
  keycloak: {
    serverUrl: getEnv("KEYCLOAK_SERVER_URL"),
    realm: getEnv("KEYCLOAK_REALM"),
    clientId: getEnv("KEYCLOAK_CLIENT_ID"),
    clientSecret: getEnv("KEYCLOAK_CLIENT_SECRET"),
  },
  redis: {
    host: getEnv("REDIS_HOST"),
    port: parseInt(getEnv("REDIS_PORT")),
    password: getEnv("REDIS_PASSWORD"),
    db: parseInt(getEnv("REDIS_DB", "0")),
  },
  session: {
    ttl: parseInt(getEnv("SESSION_TTL", "3600")),
    refreshThreshold: parseInt(getEnv("SESSION_REFRESH_THRESHOLD", "900")),
  },
  apiKey: {
    prefix: getEnv("API_KEY_PREFIX", "nk_"),
    length: parseInt(getEnv("API_KEY_LENGTH", "32")),
  },
};

const deps = {
  database,
  redis,
  monitoring: { logger },
  config,
};

// 2. Setup authentication
const auth = await setupBasicAuth(config, deps);

// 3. Use in your ElysiaJS app
import { Elysia } from "elysia";

const app = new Elysia()
  // Public routes
  .post("/login", async ({ body }) => {
    const result = await auth.authService.login(body);
    return result;
  })
  .post("/register", async ({ body }) => {
    const result = await auth.authService.register(body);
    return result;
  })

  // Protected routes
  .use(auth.requireAuth()) // Require authentication for all routes below
  .get("/profile", ({ user }) => {
    return { message: `Hello ${user.name}!`, user };
  })

  // Role-based protection
  .use(auth.requireRole(["admin"]))
  .get("/admin/users", ({ user }) => {
    return { message: "Admin only content", user };
  })

  // Permission-based protection
  .use(auth.requirePermission(["read:users"]))
  .get("/users", ({ user }) => {
    return { message: "Users list", user };
  })

  .listen(3000);
```

---

## ⚙️ Configuration

### Complete Configuration Object

```typescript
import { AuthConfig } from "@libs/auth";

const config: AuthConfig = {
  jwt: {
    secret: "your-jwt-secret-min-32-characters",
    expiresIn: "15m", // 15 minutes
    refreshExpiresIn: "7d", // 7 days
    issuer: "your-app-name",
    audience: "your-app-users",
  },
  keycloak: {
    serverUrl: "http://localhost:8080",
    realm: "your-realm",
    clientId: "your-client-id",
    clientSecret: "your-client-secret",
    publicKey: "optional-public-key", // For JWT verification
  },
  redis: {
    host: "localhost",
    port: 6379,
    password: "optional-password",
    db: 0,
  },
  session: {
    ttl: 3600, // 1 hour
    refreshThreshold: 900, // 15 minutes
  },
  apiKey: {
    prefix: "nk_", // API key prefix
    length: 32, // API key length
  },
};
```

### Service Dependencies

```typescript
import { ServiceDependencies } from "@libs/auth";

const deps: ServiceDependencies = {
  database: connectionPoolManager, // Your database connection
  redis: redisClient, // Your Redis client
  monitoring: { logger }, // Your logger instance
  config: config, // Auth configuration
};
```

---

## 🔐 Authentication Methods

### 1. Email/Password Authentication

```typescript
import { AuthenticationService } from "@libs/auth";

const authService = new AuthenticationService(config, deps);

// Login
const loginResult = await authService.login({
  email: "user@example.com",
  password: "userpassword",
  deviceInfo: {
    name: "192.168.1.1",
    type: "web",
    os: "macOS",
    browser: "Chrome",
  },
});

if (loginResult.success) {
  console.log("Login successful:", loginResult.user);
  console.log("Access token:", loginResult.tokens?.accessToken);
} else {
  console.error("Login failed:", loginResult.error);
}
```

### 2. User Registration

```typescript
// Register new user
const registerResult = await authService.register({
  email: "newuser@example.com",
  password: "securepassword123",
  name: "New User",
  roles: ["user"], // Optional, defaults to ["user"]
  metadata: {
    // Optional
    department: "engineering",
    location: "remote",
  },
});

if (registerResult.success) {
  console.log("Registration successful:", registerResult.user);
} else {
  console.error("Registration failed:", registerResult.error);
}
```

### 3. JWT Token Operations

```typescript
import { JWTService } from "@libs/auth";

const jwtService = new JWTService(config, deps);

// Generate tokens for a user
const tokens = await jwtService.generateTokens(user);
console.log("Access Token:", tokens.accessToken);
console.log("Refresh Token:", tokens.refreshToken);

// Verify token
try {
  const verifiedUser = await jwtService.verifyToken(accessToken);
  console.log("Token valid for user:", verifiedUser.email);
} catch (error) {
  console.error("Token verification failed:", error.message);
}

// Refresh token
try {
  const newTokens = await jwtService.refreshToken(refreshToken);
  console.log("New tokens:", newTokens);
} catch (error) {
  console.error("Token refresh failed:", error.message);
}

// Revoke token
await jwtService.revokeToken(accessToken);
```

### 4. Session Management

```typescript
import { SessionService } from "@libs/auth";

const sessionService = new SessionService(deps);

// Create session
const session = await sessionService.createSession(user, {
  deviceInfo: {
    name: "192.168.1.1",
    type: "mobile",
    os: "iOS",
    browser: "Safari",
  },
  metadata: { loginMethod: "password" },
});

// Get session
const activeSession = await sessionService.getSession(session.id);

// Update session activity
await sessionService.updateLastActivity(session.id);

// Get all user sessions
const userSessions = await sessionService.getUserSessions(user.id);

// Revoke session
await sessionService.revokeSession(session.id);

// Revoke all user sessions
await sessionService.revokeAllUserSessions(user.id);
```

### 5. API Key Authentication

```typescript
import { ApiKeyService } from "@libs/auth";

const apiKeyService = new ApiKeyService(deps);

// Create API key
const apiKey = await apiKeyService.createApiKey(user.id, {
  name: "Production API Key",
  permissions: ["read:users", "write:data"],
  expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
  metadata: { purpose: "mobile-app" },
});

console.log("API Key:", apiKey.key); // nk_abc123... (only shown once)

// Verify API key
const verification = await apiKeyService.verifyApiKey("nk_abc123...");
if (verification.valid) {
  console.log("API key belongs to user:", verification.userId);
}

// List user API keys
const userApiKeys = await apiKeyService.getUserApiKeys(user.id);

// Revoke API key
await apiKeyService.revokeApiKey(apiKey.id);
```

---

## 🛡️ Authorization & Permissions

### 1. CASL-based Permissions

```typescript
import { PermissionService } from "@libs/auth";

const permissionService = new PermissionService(deps);

// Check if user can perform action
const canReadUsers = permissionService.can(user, "read", "user");
const canUpdateOwnProfile = permissionService.can(user, "update", "user", {
  id: user.id,
});

// Create ability instance for advanced checks
const ability = permissionService.createAbility(user);

// Context-aware permissions
if (ability.can("read", "document", { authorId: user.id })) {
  // User can read their own documents
}

if (
  ability.can("delete", "comment", {
    createdBy: user.id,
    createdAt: { $gte: yesterday },
  })
) {
  // User can delete their recent comments
}

// Field-level permissions
const allowedFields = permissionService.getPermittedFields(
  user,
  "read",
  "user"
);
// Returns: ["name", "email"] but not ["password", "ssn"]
```

### 2. Role Management

```typescript
// Define custom roles
const customRole = {
  id: "analyst",
  name: "analyst",
  description: "Data analyst with reporting permissions",
  permissions: [
    { action: "read", resource: "user" },
    { action: "read", resource: "report" },
    { action: "create", resource: "report" },
    { action: "read", resource: "analytics" },
  ],
};

// Add role to system
permissionService.addRole(customRole);

// Add permission to existing role
permissionService.addPermissionToRole("analyst", {
  action: "export",
  resource: "report",
  conditions: { classification: "public" }, // Only public reports
});

// Check if user has role
const isAnalyst = permissionService.userHasRole(user, "analyst");

// Get all user permissions (from roles + direct permissions)
const allPermissions = permissionService.getUserPermissions(user);
```

### 3. Authorization Context

```typescript
// Create authorization context for user
const authContext = permissionService.createAuthContext(user);

console.log("Is authenticated:", authContext.isAuthenticated);
console.log("User roles:", authContext.roles);
console.log("User permissions:", authContext.permissions);

// Use ability for fine-grained checks
if (authContext.ability.can("manage", "all")) {
  // Super admin capabilities
}
```

---

## 🔌 Middleware Integration

### 1. HTTP Middleware (ElysiaJS)

```typescript
import { createAuthMiddleware } from "@libs/auth";

const authMiddleware = createAuthMiddleware(authService, deps);

const app = new Elysia()
  // Optional authentication (sets user if token provided)
  .use(authMiddleware.optional())
  .get("/public", ({ user }) => {
    return {
      message: "Public endpoint",
      user: user || "Anonymous",
    };
  })

  // Required authentication
  .use(authMiddleware.create({ requireAuth: true }))
  .get("/protected", ({ user }) => {
    return { message: "Protected content", user };
  })

  // Role-based access
  .use(authMiddleware.requireRole(["admin", "moderator"]))
  .get("/admin", ({ user }) => {
    return { message: "Admin content", user };
  })

  // Permission-based access
  .use(authMiddleware.requirePermission(["read:sensitive-data"]))
  .get("/sensitive", ({ user }) => {
    return { message: "Sensitive data", user };
  })

  // CASL ability-based access
  .use(authMiddleware.requireAbility("manage", "user"))
  .post("/users/:id", ({ user, params }) => {
    // Only users who can manage users can access
    return { message: `Managing user ${params.id}`, user };
  })

  // API Key authentication
  .use(authMiddleware.requireApiKey(["read:api", "write:api"]))
  .get("/api/data", ({ user, apiKey }) => {
    return {
      message: "API data",
      user,
      apiKeyName: apiKey.name,
    };
  })

  // Custom authorization logic
  .use(
    authMiddleware.requireCustomAuth(async (user, context) => {
      // Custom business logic
      if (user.department !== "finance" && context.path.includes("financial")) {
        return { authorized: false, reason: "Department access denied" };
      }
      return { authorized: true };
    })
  )
  .get("/financial/reports", ({ user }) => {
    return { message: "Financial reports", user };
  });
```

### 2. WebSocket Middleware

```typescript
import { createWebSocketAuthMiddleware } from "@libs/auth";

const wsAuthMiddleware = createWebSocketAuthMiddleware(authService, deps);

const wsApp = new Elysia().ws("/ws", {
  beforeHandle: wsAuthMiddleware.authenticate(),
  message: async (ws, message) => {
    // ws.data.user contains authenticated user
    const { user } = ws.data;

    if (message.type === "subscribe") {
      // Check permissions for subscription
      const canSubscribe = permissionService.can(user, "read", message.channel);

      if (!canSubscribe) {
        ws.send({ error: "Permission denied for channel" });
        return;
      }

      // Handle subscription
      ws.subscribe(message.channel);
      ws.send({ success: `Subscribed to ${message.channel}` });
    }
  },
});
```

### 3. Middleware Options

```typescript
// Complete middleware configuration
const middleware = authMiddleware.create({
  requireAuth: true,
  roles: ["admin", "user"],
  permissions: ["read:data", "write:data"],
  resource: "user",
  action: "read",
  skipHealthCheck: false,
  customValidation: async (user, context) => {
    // Custom validation logic
    return { valid: true };
  },
});
```

---

## 📚 API Reference

### AuthenticationService

```typescript
class AuthenticationService {
  // Authentication
  async login(credentials: LoginCredentials): Promise<AuthResult>;
  async register(data: RegisterData): Promise<AuthResult>;
  async logout(userId: string, sessionId?: string): Promise<boolean>;

  // User management
  async getUser(userId: string): Promise<User | null>;
  async updateUser(userId: string, updates: Partial<User>): Promise<boolean>;
  async deleteUser(userId: string): Promise<boolean>;

  // Health and monitoring
  async healthCheck(): Promise<HealthStatus>;
}
```

### JWTService

```typescript
class JWTService {
  async generateTokens(user: User): Promise<AuthToken>;
  async verifyToken(token: string): Promise<User>;
  async refreshToken(refreshToken: string): Promise<AuthToken>;
  async revokeToken(token: string): Promise<boolean>;
  async authenticateUser(email: string, password: string): Promise<User | null>;
}
```

### PermissionService

```typescript
class PermissionService {
  createAbility(user: User): AppAbility;
  can(user: User, action: Action, resource: Resource, subject?: any): boolean;
  cannot(
    user: User,
    action: Action,
    resource: Resource,
    subject?: any
  ): boolean;
  getPermittedFields(user: User, action: Action, resource: Resource): string[];
  createAuthContext(user: User): AuthContext;

  // Role management
  addRole(role: Role): void;
  removeRole(roleName: string): void;
  getRole(roleName: string): Role | undefined;
  getAllRoles(): Role[];

  // Permission management
  addPermissionToRole(roleName: string, permission: Permission): void;
  removePermissionFromRole(roleName: string, permissionId: string): void;

  // User utilities
  userHasRole(user: User, roleName: string): boolean;
  userHasPermission(user: User, permission: string): boolean;
  getUserPermissions(user: User): string[];
}
```

### SessionService

```typescript
class SessionService {
  async createSession(user: User, options: SessionOptions): Promise<Session>;
  async getSession(sessionId: string): Promise<Session | null>;
  async updateLastActivity(sessionId: string): Promise<boolean>;
  async getUserSessions(userId: string): Promise<Session[]>;
  async revokeSession(sessionId: string): Promise<boolean>;
  async revokeAllUserSessions(userId: string): Promise<boolean>;
  async cleanupExpiredSessions(): Promise<number>;
}
```

### ApiKeyService

```typescript
class ApiKeyService {
  async createApiKey(userId: string, data: ApiKeyCreateData): Promise<ApiKey>;
  async verifyApiKey(key: string): Promise<ApiKeyVerification>;
  async getUserApiKeys(userId: string): Promise<ApiKey[]>;
  async updateApiKey(keyId: string, updates: Partial<ApiKey>): Promise<boolean>;
  async revokeApiKey(keyId: string): Promise<boolean>;
  async getApiKeyUsage(keyId: string): Promise<ApiKeyUsage>;
}
```

---

## 🚀 Advanced Features

### 1. Enhanced Monitoring

```typescript
import { EnhancedMonitoringService } from "@libs/auth";

const monitoring = new EnhancedMonitoringService(deps);

// Record authentication events
monitoring.recordAuthEvent("login_success", userId, {
  ipAddress: "192.168.1.1",
  userAgent: "Chrome/91.0",
  method: "password",
});

// Get metrics
const metrics = await monitoring.getMetrics();
console.log("Login attempts:", metrics.loginAttempts);
console.log("Success rate:", metrics.loginSuccesses / metrics.loginAttempts);

// Set up alerts
monitoring.addAlertRule({
  id: "high-failure-rate",
  name: "High Login Failure Rate",
  condition: (metrics) => {
    const failureRate = metrics.loginFailures / metrics.loginAttempts;
    return failureRate > 0.5; // 50% failure rate
  },
  severity: "critical",
  message: "Login failure rate exceeded 50%",
  cooldown: 5, // 5 minutes
});
```

### 2. Threat Detection

```typescript
import { AdvancedThreatDetectionService } from "@libs/auth";

const threatDetector = new AdvancedThreatDetectionService(deps);

// Configure threat detection
const threatConfig = {
  maxFailedAttempts: 5,
  lockoutDuration: 30, // minutes
  bruteForceWindow: 15, // minutes
  suspiciousActivityThreshold: 10,
  ipBlockDuration: 60, // minutes
  enableAutoLockout: true,
  enableIPBlocking: true,
  notifyOnThreat: true,
};

await threatDetector.configure(threatConfig);

// Check for threats during login
const loginAttempt = await authService.login(credentials);
if (!loginAttempt.success) {
  await threatDetector.recordFailedAttempt(
    credentials.email,
    ipAddress,
    userAgent,
    { reason: "invalid_password" }
  );
}

// Check if account is locked
const isLocked = threatDetector.isAccountLocked(email);
const isBlocked = threatDetector.isIPBlocked(ipAddress);

if (isLocked || isBlocked) {
  return { error: "Access temporarily restricted" };
}
```

### 3. Permission Caching

```typescript
import { EnhancedPermissionCacheService } from "@libs/auth";

const permissionCache = new EnhancedPermissionCacheService(deps);

// Cache user permissions
await permissionCache.setUserPermissions(
  userId,
  permissions,
  roles,
  { ttl: 3600 } // 1 hour
);

// Get cached permissions
const cachedPermissions = await permissionCache.getUserPermissions(userId);

// Invalidate cache when permissions change
await permissionCache.invalidateUserPermissions(userId);

// Get cache statistics
const stats = await permissionCache.getStats();
console.log("Cache hit rate:", stats.hitRate);
console.log("Memory usage:", stats.memoryUsage);
```

### 4. Config Validation

```typescript
import { ConfigValidationService } from "@libs/auth";

const configValidator = new ConfigValidationService();

// Validate configuration
const validation = configValidator.validateConfig(config);

if (!validation.isValid) {
  console.error("Configuration errors:");
  validation.errors.forEach((error) => {
    console.error(`- ${error.field}: ${error.message}`);
    if (error.suggestion) {
      console.log(`  Suggestion: ${error.suggestion}`);
    }
  });
}

// Check security recommendations
const securityCheck = configValidator.checkSecurityRecommendations(config);
securityCheck.warnings.forEach((warning) => {
  console.warn(`Security warning: ${warning.message}`);
});
```

---

## 🔒 Security Best Practices

### 1. Environment Configuration

```bash
# Use strong, unique secrets
JWT_SECRET=$(openssl rand -base64 32)

# Secure token lifetimes
JWT_EXPIRES_IN="15m"        # Short access token lifetime
JWT_REFRESH_EXPIRES_IN="7d"  # Reasonable refresh token lifetime

# Enable security features
SESSION_SECURE_COOKIES=true
SESSION_HTTP_ONLY=true
SESSION_SAME_SITE="strict"

# Rate limiting
RATE_LIMIT_ENABLED=true
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_WINDOW_MS=900000  # 15 minutes
```

### 2. Password Security

```typescript
// Strong password requirements
const passwordValidation = {
  minLength: 12,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
  forbidCommonPasswords: true,
  maxPasswordAge: 90, // days
};

// Hash passwords with bcrypt (already implemented)
const hashedPassword = await bcrypt.hash(password, 12);
```

### 3. Token Security

```typescript
// JWT best practices
const jwtConfig = {
  secret: process.env.JWT_SECRET, // Strong random secret
  expiresIn: "15m", // Short lifetime
  issuer: "your-app", // Specific issuer
  audience: "your-app-users", // Specific audience
  algorithm: "HS256", // Secure algorithm
};

// Token rotation
const tokens = await jwtService.refreshToken(refreshToken);
// Always use new tokens, invalidate old ones
```

### 4. API Security

```typescript
// Always validate input
app.post(
  "/api/users",
  {
    body: t.Object({
      email: t.String({ format: "email" }),
      password: t.String({ minLength: 12 }),
      name: t.String({ minLength: 1, maxLength: 100 }),
    }),
  },
  async ({ body, user }) => {
    // Check permissions
    if (!permissionService.can(user, "create", "user")) {
      throw new Error("Forbidden");
    }

    // Sanitize input
    const sanitizedData = sanitizeInput(body);

    // Create user
    return await createUser(sanitizedData);
  }
);
```

---

## 🔧 Troubleshooting

### Common Issues

#### 1. Authentication Fails

```typescript
// Check token validity
try {
  const user = await jwtService.verifyToken(token);
  console.log("Token valid:", user);
} catch (error) {
  console.error("Token invalid:", error.message);
  // Possible causes:
  // - Token expired
  // - Invalid secret
  // - Token revoked
  // - Malformed token
}
```

#### 2. Permission Denied

```typescript
// Debug permission checks
const user = await authService.getUser(userId);
const ability = permissionService.createAbility(user);

console.log("User roles:", user.roles);
console.log("User permissions:", user.permissions);
console.log("Can read users:", ability.can("read", "user"));
console.log("CASL rules:", ability.rules);

// Check if role exists
const role = permissionService.getRole("admin");
console.log("Admin role:", role);
```

#### 3. Database Connection Issues

```typescript
// Test database connectivity
try {
  const connection = await deps.database.getConnectionPrisma();
  const result = await connection.prisma.$queryRaw`SELECT 1`;
  console.log("Database connected:", result);
  connection.release();
} catch (error) {
  console.error("Database connection failed:", error);
}
```

#### 4. Redis Connection Issues

```typescript
// Test Redis connectivity
try {
  await deps.redis.ping();
  console.log("Redis connected");
} catch (error) {
  console.error("Redis connection failed:", error);
}
```

### Debug Mode

```typescript
// Enable debug logging
const config = {
  // ... other config
  debug: true,
  logLevel: "debug",
};

// The library will log detailed information about:
// - Authentication attempts
// - Permission checks
// - Token operations
// - Database queries
// - Cache operations
```

---

## 📖 Examples

### Example 1: E-commerce Application

```typescript
// E-commerce specific roles and permissions
const roles = {
  customer: {
    permissions: [
      "read:own-orders",
      "create:orders",
      "update:own-profile",
      "read:products",
    ],
  },
  seller: {
    permissions: [
      "manage:own-products",
      "read:own-orders",
      "update:order-status",
    ],
  },
  admin: {
    permissions: ["manage:all"],
  },
};

// Usage in routes
app.post(
  "/orders",
  authMiddleware.requirePermission(["create:orders"]),
  async ({ user, body }) => {
    // Only customers can create orders
    return await createOrder(user.id, body);
  }
);

app.get(
  "/admin/orders",
  authMiddleware.requireRole(["admin"]),
  async ({ user }) => {
    // Only admins can see all orders
    return await getAllOrders();
  }
);
```

### Example 2: Multi-tenant SaaS

```typescript
// Tenant-aware permissions
const ability = permissionService.createAbility(user);

// Users can only access their tenant's data
if (ability.can("read", "user", { tenantId: user.tenantId })) {
  const tenantUsers = await getUsers({ tenantId: user.tenantId });
  return tenantUsers;
}

// Tenant admin can manage users in their tenant
if (ability.can("manage", "user", { tenantId: user.tenantId })) {
  return await updateUser(userId, updates, { tenantId: user.tenantId });
}
```

### Example 3: Healthcare Application

```typescript
// Healthcare-specific permissions with HIPAA compliance
const healthcareRoles = {
  doctor: {
    permissions: [
      "read:patient-records",
      "write:patient-records",
      "read:own-patients",
    ],
  },
  nurse: {
    permissions: ["read:patient-records", "update:patient-vitals"],
  },
  patient: {
    permissions: ["read:own-records", "schedule:appointments"],
  },
};

// Context-aware access control
app.get(
  "/patients/:id/records",
  authMiddleware.requirePermission(["read:patient-records"]),
  async ({ user, params }) => {
    const ability = permissionService.createAbility(user);

    // Doctors can only access their assigned patients
    if (user.role === "doctor") {
      const canAccess = ability.can("read", "patient", {
        assignedDoctorId: user.id,
        id: params.id,
      });

      if (!canAccess) {
        throw new Error("Access denied - not your patient");
      }
    }

    return await getPatientRecords(params.id);
  }
);
```

---

## 📝 API Documentation

For complete API documentation with all interfaces, types, and method signatures, see the [TypeScript definitions](./src/types/index.ts).

## 🆘 Support

- **Issues**: Report bugs on GitHub Issues
- **Documentation**: Check the inline code documentation
- **Examples**: See the `/examples` directory for complete implementations

## 📄 License

MIT License - see LICENSE file for details.

---

**🎉 You're ready to build secure, scalable applications with @libs/auth!**

The library provides enterprise-grade authentication and authorization with modern security practices, fine-grained permissions, and excellent developer experience.
