# Modern Authentication Middleware

A comprehensive authentication middleware for Elysia applications using modern Oslo cryptographic packages. This implementation provides secure session management, password hashing, JWT tokens, and enterprise-grade security features.

## Features

- 🔐 **Secure Authentication**: Uses Oslo packages for cryptographic operations
- 🍪 **Session Management**: Redis-backed session storage with configurable expiration
- 🎟️ **JWT Support**: API authentication with JWT tokens
- 🛡️ **Password Security**: scrypt hashing with salt and strength validation
- 🚦 **Rate Limiting**: Brute force protection with configurable limits
- 👥 **Role-Based Access Control**: Integration with existing RBAC system
- 📊 **Audit Logging**: Comprehensive authentication event logging
- 🔄 **Session Cleanup**: Automatic expired session cleanup
- 🌐 **IP Validation**: Optional strict IP address checking
- ⚡ **High Performance**: Redis caching for session validation

## Installation

The middleware is part of the `@libs/middleware` package and uses the following dependencies:

```bash
pnpm add @oslojs/crypto@latest @oslojs/encoding@latest @oslojs/jwt@latest
```

## Quick Start

### Basic Setup

```typescript
import { Elysia } from "elysia";
import { createAuthPlugin, authGuards } from "@libs/middleware";

const app = new Elysia()
  // Add authentication middleware
  .use(
    createAuthPlugin({
      sessionExpiresInHours: 24,
      skipPaths: ["/health", "/public"],
      requireAuth: false,
    })
  )

  // Public routes
  .get("/health", () => ({ status: "ok" }))

  // Protected routes
  .use(authGuards.required)
  .get("/profile", ({ auth }) => ({
    user: auth.user,
    message: `Hello ${auth.user?.username}`,
  }));
```

### Authentication Routes

```typescript
import {
  createAuthPlugin,
  AuthService,
  UserAuthService,
  LoginCredentials,
} from "@libs/middleware";

const authService = new AuthService();
const userAuthService = new UserAuthService(authService);

const app = new Elysia()
  .use(createAuthPlugin({ requireAuth: false }))

  // Login endpoint
  .post("/auth/login", async ({ body, request, auth }) => {
    const credentials = body as LoginCredentials;
    const clientIP = request.headers.get("x-forwarded-for") || "unknown";
    const userAgent = request.headers.get("user-agent") || "unknown";

    try {
      const result = await auth.login(credentials, clientIP, userAgent);
      return {
        success: true,
        user: result.user,
        token: result.jwtToken,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  })

  // Register endpoint
  .post("/auth/register", async ({ body }) => {
    const userData = body as {
      email: string;
      password: string;
      username: string;
      firstName?: string;
      lastName?: string;
    };

    const user = await userAuthService.register(userData);
    if (user) {
      return { success: true, user: { id: user.id, email: user.email } };
    }
    return { success: false, error: "Registration failed" };
  });
```

## Configuration

### AuthMiddlewareConfig

```typescript
interface AuthMiddlewareConfig {
  // Session configuration
  sessionExpiresInHours?: number; // Default: 168 (7 days)
  cleanupIntervalMinutes?: number; // Default: 60
  maxSessionsPerUser?: number; // Default: 5
  strictIpCheck?: boolean; // Default: false

  // Middleware behavior
  skipPaths?: string[]; // Default: ['/health', '/metrics']
  requireAuth?: boolean; // Default: true
  cookieName?: string; // Default: 'session'
  headerName?: string; // Default: 'authorization'

  // Security
  jwtSecret?: string; // Required for JWT tokens

  // Rate limiting
  rateLimiting?: {
    maxAttempts: number; // Default: 5
    windowMinutes: number; // Default: 15
    blockDurationMinutes: number; // Default: 30
  };

  // Cookie configuration
  cookieOptions?: {
    name: string;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "strict" | "lax" | "none";
    maxAge: number;
    path: string;
    domain?: string;
  };
}
```

### Environment Variables

```bash
# Required
JWT_SECRET=your-super-secret-jwt-key-here
DATABASE_URL=postgresql://...
REDIS_URL=redis://localhost:6379

# Optional
NODE_ENV=production
COOKIE_DOMAIN=yourdomain.com
```

## Authentication Guards

### Basic Guards

```typescript
// Require authentication
app.use(authGuards.required).get("/protected", ({ auth }) => {
  return { user: auth.user };
});

// Optional authentication
app.use(authGuards.optional).get("/maybe-protected", ({ auth }) => {
  if (auth.isAuthenticated) {
    return { message: `Hello ${auth.user?.username}` };
  }
  return { message: "Hello guest" };
});
```

### Role-Based Guards

```typescript
// Require specific role
app.use(authGuards.role("ADMIN")).get("/admin", ({ auth }) => {
  return { message: "Admin area" };
});

// Require any of multiple roles
app
  .use(authGuards.anyRole(["ADMIN", "ANALYST"]))
  .get("/reports", ({ auth }) => {
    return { message: "Reports dashboard" };
  });
```

## Password Utilities

### Password Validation

```typescript
import { PasswordUtils } from "@libs/middleware";

const validation = PasswordUtils.validatePassword("MyPassword123!", {
  minLength: 12,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
});

console.log(validation.isValid); // boolean
console.log(validation.errors); // string[]
console.log(validation.strength); // 'weak' | 'medium' | 'strong'
```

### Password Generation

```typescript
const securePassword = PasswordUtils.generateSecurePassword(16, {
  minLength: 16,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
});

console.log(securePassword); // e.g., "X9k#mL2$nP8qW5eR"
```

### Breach Check (Placeholder)

```typescript
const breachResult = await PasswordUtils.checkPasswordBreach("password123");
console.log(breachResult.isPwned); // true for common passwords
console.log(breachResult.count); // number of times seen
```

## Session Management

### Manual Session Control

```typescript
import { AuthService } from "@libs/middleware";

const authService = new AuthService();

// Create session
const session = await authService.createSession({
  userId: "user123",
  ipAddress: "192.168.1.1",
  userAgent: "Mozilla/5.0...",
  expiresInHours: 24,
});

// Validate session
const validation = await authService.validateSession(
  session.sessionToken,
  "192.168.1.1"
);

if (validation.isValid) {
  console.log("User:", validation.user);
  console.log("Session:", validation.session);
}

// Invalidate session
await authService.invalidateSession(session.session.id);

// Invalidate all user sessions
await authService.invalidateAllUserSessions("user123");
```

## Security Features

### Rate Limiting

The middleware includes built-in rate limiting to prevent brute force attacks:

- **Login attempts**: Configurable per IP/user
- **General requests**: Configurable per IP
- **Automatic blocking**: Temporary blocks after threshold reached

### Session Security

- **Secure tokens**: Cryptographically secure random tokens
- **Token hashing**: Tokens are hashed before database storage
- **IP validation**: Optional strict IP address checking
- **Session cleanup**: Automatic cleanup of expired sessions
- **Multiple session limit**: Configurable per user

### Password Security

- **scrypt hashing**: Industry-standard password hashing
- **Salt generation**: Unique salt per password
- **Strength validation**: Enforced password complexity rules
- **Breach checking**: Integration point for password breach APIs

## Integration with Existing Systems

### Database Integration

The middleware integrates with your existing Prisma database:

```typescript
// Uses existing User and UserSession models
// Leverages existing Role model for RBAC
// Integrates with UserEvent for audit logging
```

### Redis Integration

Session caching and rate limiting use Redis:

```typescript
// Session caching for performance
// Rate limit counters
// Distributed session invalidation
```

### User Service Integration

```typescript
import { UserAuthService, AuthService } from "@libs/middleware";

class CustomUserService extends UserAuthService {
  public async authenticate(credentials: LoginCredentials) {
    // Add custom pre-authentication logic
    const result = await super.authenticate(credentials);

    if (result) {
      // Add custom post-authentication logic
      await this.customPostAuthAction(result.id);
    }

    return result;
  }

  private async customPostAuthAction(userId: string) {
    // Your custom logic here
  }
}
```

## Error Handling

The middleware provides comprehensive error handling:

```typescript
try {
  const result = await auth.login(credentials, clientIP, userAgent);
} catch (error) {
  if (error.message === "Too many login attempts") {
    // Handle rate limiting
  } else if (error.message === "Invalid credentials") {
    // Handle authentication failure
  } else {
    // Handle other errors
  }
}
```

## Monitoring and Logging

All authentication events are logged to the database:

- Login attempts (success/failure)
- Session creation/invalidation
- Password changes
- Rate limiting events
- Security violations

## Performance Considerations

- **Redis caching**: Sessions are cached for fast validation
- **Connection pooling**: Uses existing database connection pools
- **Minimal overhead**: Efficient token generation and validation
- **Background cleanup**: Non-blocking session cleanup process

## Security Best Practices

1. **Use HTTPS**: Always use HTTPS in production
2. **Secure cookies**: Enable `secure` and `httpOnly` flags
3. **Strong secrets**: Use cryptographically secure JWT secrets
4. **Regular rotation**: Rotate JWT secrets regularly
5. **Monitor logs**: Watch for suspicious authentication patterns
6. **Rate limiting**: Configure appropriate rate limits
7. **Session timeouts**: Use reasonable session expiration times

## Migration Guide

### From Legacy Auth

If migrating from the legacy auth system:

1. Install new dependencies
2. Update middleware imports
3. Configure new middleware
4. Update route handlers to use new auth context
5. Test authentication flows
6. Deploy with feature flags

### Database Considerations

The new middleware uses existing database models:

- `User`: No changes required
- `UserSession`: No changes required
- `UserEvent`: No changes required
- `Role`: No changes required

## Troubleshooting

### Common Issues

**JWT Secret Missing**

```bash
Error: JWT_SECRET environment variable required
```

Solution: Set `JWT_SECRET` environment variable

**Redis Connection Failed**

```bash
Error: Redis connection failed
```

Solution: Verify `REDIS_URL` and Redis server status

**Session Not Found**

```bash
Error: Session validation failed
```

Solution: Check session expiration and cleanup processes

**Rate Limit Exceeded**

```bash
Error: Too many login attempts
```

Solution: Wait for rate limit window to reset or adjust configuration

## API Reference

See the exported types and interfaces for complete API documentation:

- `AuthService`: Core authentication service
- `UserAuthService`: User management integration
- `ElysiaAuthMiddleware`: Elysia middleware implementation
- `PasswordUtils`: Password utilities
- `authGuards`: Authentication guards

## License

This middleware is part of the NeurotTracker backend system and follows the same licensing terms.
