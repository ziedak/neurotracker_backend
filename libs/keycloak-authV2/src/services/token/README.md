# Keycloak AuthV2 - Token Management Library

A comprehensive TypeScript library for Keycloak authentication and token management, featuring JWT validation, token introspection, automatic refresh token handling, and secure caching.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Basic Usage](#basic-usage)
- [Advanced Usage](#advanced-usage)
- [API Reference](#api-reference)
- [Configuration](#configuration)
- [Event Handling](#event-handling)
- [Health Monitoring](#health-monitoring)
- [Security Considerations](#security-considerations)
- [Examples](#examples)
- [Troubleshooting](#troubleshooting)

## Features

- ✅ **JWT Validation** - Signature verification with JWKS
- ✅ **Token Introspection** - Keycloak introspection endpoint support
- ✅ **Automatic Token Refresh** - Background refresh with TTL-based locking
- ✅ **Secure Caching** - Encrypted token storage with automatic cleanup
- ✅ **Role-Based Access Control** - Permission and role validation
- ✅ **Health Monitoring** - Comprehensive health checks and metrics
- ✅ **Event-Driven Architecture** - Extensible event handling
- ✅ **Type Safety** - Full TypeScript support with Zod validation
- ✅ **Memory Safe** - Automatic resource cleanup and leak prevention

## Installation

```bash
# Using pnpm (recommended)
pnpm add @libs/keycloak-authv2

# Using npm
npm install @libs/keycloak-authv2

# Using yarn
yarn add @libs/keycloak-authv2
```

## Dependencies

```json
{
  "dependencies": {
    "@libs/utils": "^1.0.0",
    "@libs/monitoring": "^1.0.0",
    "@libs/database": "^1.0.0",
    "zod": "^3.22.0",
    "jose": "^4.14.0"
  }
}
```

## Quick Start

```typescript
import { createTokenManagerWithRefresh } from '@libs/keycloak-authv2';
import { KeycloakClient } from '@libs/keycloak-authv2';

// Basic configuration
const config = {
  jwt: {
    issuer: 'https://your-keycloak/realms/your-realm',
    audience: 'your-client-id'
  },
  cache: {
    enabled: true,
    ttl: { jwt: 300, introspect: 60 }
  }
};

// Create Keycloak client
const keycloakClient = new KeycloakClient({
  baseUrl: 'https://your-keycloak',
  realm: 'your-realm',
  clientId: 'your-client-id',
  clientSecret: 'your-client-secret'
});

// Create token manager with refresh support
const tokenManager = await createTokenManagerWithRefresh(
  keycloakClient,
  config,
  {
    refreshBuffer: 300, // Refresh 5 minutes before expiry
    enableEncryption: true
  }
);

// Validate a token
const result = await tokenManager.validateToken('your-jwt-token');
if (result.success) {
  console.log('Token is valid for user:', result.user?.id);
}
```

## Basic Usage

### Token Validation

```typescript
// JWT validation only
const jwtResult = await tokenManager.validateJwt('jwt-token');

// Introspection validation only
const introspectResult = await tokenManager.introspectToken('jwt-token');

// Fallback validation (JWT first, then introspection)
const fallbackResult = await tokenManager.validateToken('jwt-token', false);

// Force introspection first
const forceIntrospectResult = await tokenManager.validateToken('jwt-token', true);
```

### Token Extraction

```typescript
// Extract token from Authorization header
const token = tokenManager.extractBearerToken('Bearer eyJhbGciOiJSUzI1NiIs...');

// Returns null for invalid headers
const invalidToken = tokenManager.extractBearerToken('Invalid header');
```

### Role and Permission Checks

```typescript
const authResult = await tokenManager.validateToken('jwt-token');

if (authResult.success) {
  // Check roles
  const isAdmin = tokenManager.hasRole(authResult, 'admin');
  const hasAnyRole = tokenManager.hasAnyRole(authResult, ['user', 'moderator']);
  const hasAllRoles = tokenManager.hasAllRoles(authResult, ['user', 'verified']);

  // Check permissions
  const canRead = tokenManager.hasPermission(authResult, 'read:documents');
  const canWrite = tokenManager.hasAnyPermission(authResult, ['write:documents', 'admin']);
  const isOwner = tokenManager.hasAllPermissions(authResult, ['read:documents', 'write:documents']);

  // Check expiration
  const isExpired = tokenManager.isTokenExpired(authResult);
  const expiresSoon = tokenManager.willExpireSoon(authResult, 300); // Within 5 minutes
  const lifetime = tokenManager.getTokenLifetime(authResult); // Seconds remaining
}
```

## Advanced Usage

### Automatic Token Refresh

```typescript
import { RefreshTokenEventHandlers } from '@libs/keycloak-authv2';

// Configure event handlers
const eventHandlers: RefreshTokenEventHandlers = {
  onTokenStored: async (event) => {
    console.log(`Tokens stored for user ${event.userId}`);
  },
  onTokenRefreshed: async (event) => {
    console.log(`Tokens refreshed for user ${event.userId}`);
    // Update session store, notify client, etc.
  },
  onTokenExpired: async (event) => {
    console.log(`Token expired for user ${event.userId}, reason: ${event.reason}`);
    // Handle logout, redirect, etc.
  },
  onRefreshFailed: async (userId, sessionId, error) => {
    console.log(`Refresh failed for ${userId}:${sessionId}: ${error}`);
    // Handle refresh failure (logout, retry, etc.)
  }
};

// Create token manager with refresh support
const tokenManager = await createTokenManagerWithRefresh(
  keycloakClient,
  config,
  {
    refreshBuffer: 300,        // Refresh 5 minutes before expiry
    enableEncryption: true,    // Encrypt stored tokens
    cleanupInterval: 300000,   // Cleanup every 5 minutes
    encryptionKey: 'your-32-char-encryption-key' // Optional custom key
  },
  metricsCollector,
  eventHandlers
);

// Store tokens with automatic refresh
await tokenManager.storeTokensWithRefresh(
  'user123',
  'session456',
  'access-token-jwt',
  'refresh-token-jwt',
  3600,     // Access token expires in 1 hour
  86400     // Refresh token expires in 24 hours
);

// Tokens will be automatically refreshed in background
// Manual refresh if needed
const refreshResult = await tokenManager.refreshUserTokens('user123', 'session456');

// Check if valid tokens exist
const hasValidTokens = await tokenManager.hasValidStoredTokens('user123', 'session456');

// Get stored token info
const storedTokens = await tokenManager.getStoredTokens('user123', 'session456');

// Remove tokens and cancel refresh
await tokenManager.removeStoredTokens('user123', 'session456');
```

### Custom Configuration

```typescript
const advancedConfig = {
  jwt: {
    issuer: 'https://keycloak.example.com/realms/my-realm',
    audience: 'my-client',
    jwksUrl: 'https://keycloak.example.com/realms/my-realm/protocol/openid_connect/certs' // Optional custom JWKS URL
  },
  cache: {
    enabled: true,
    ttl: {
      jwt: 300,        // Cache JWT validation for 5 minutes
      introspect: 60   // Cache introspection for 1 minute
    }
  }
};

const refreshConfig = {
  refreshBuffer: 600,           // Refresh 10 minutes before expiry
  enableEncryption: true,       // Encrypt stored refresh tokens
  cleanupInterval: 600000,      // Run cleanup every 10 minutes
  encryptionKey: process.env.TOKEN_ENCRYPTION_KEY // Environment variable
};
```

### Health Monitoring

```typescript
// Get comprehensive health status
const health = await tokenManager.healthCheck();
console.log('Health status:', health.status);
console.log('Active timers:', health.details.activeTimers);
console.log('Cache health:', health.details.cacheHealth);

// Get refresh token statistics
if (tokenManager.hasRefreshTokenSupport()) {
  const stats = tokenManager.getRefreshTokenStats();
  console.log('Refresh config:', stats.config);
  console.log('Active timers:', stats.activeTimers);
}
```

### Memory Management

```typescript
// Clear sensitive data from memory
tokenManager.clearTokenFromMemory(sensitiveToken);

// Graceful shutdown
await tokenManager.dispose();
```

## API Reference

### TokenManager Class

#### Constructor
```typescript
new TokenManager(keycloakClient: KeycloakClient, config: AuthV2Config, metrics?: IMetricsCollector)
```

#### Methods

##### Initialization
- `initialize(refreshConfig?, eventHandlers?): Promise<void>` - Initialize the token manager

##### Token Validation
- `validateJwt(token: string): Promise<AuthResult>` - Validate JWT signature
- `introspectToken(token: string): Promise<AuthResult>` - Validate via Keycloak introspection
- `validateToken(token: string, useIntrospection?: boolean): Promise<AuthResult>` - Fallback validation

##### Token Extraction
- `extractBearerToken(authorizationHeader?: string): string | null` - Extract token from header

##### Role & Permission Checks
- `hasRole(authResult: AuthResult, role: string): boolean`
- `hasAnyRole(authResult: AuthResult, roles: string[]): boolean`
- `hasAllRoles(authResult: AuthResult, roles: string[]): boolean`
- `hasPermission(authResult: AuthResult, permission: string): boolean`
- `hasAnyPermission(authResult: AuthResult, permissions: string[]): boolean`
- `hasAllPermissions(authResult: AuthResult, permissions: string[]): boolean`

##### Token Expiration
- `isTokenExpired(authResult: AuthResult): boolean`
- `getTokenLifetime(authResult: AuthResult): number`
- `willExpireSoon(authResult: AuthResult, withinSeconds: number): boolean`

##### Refresh Token Management
- `storeTokensWithRefresh(userId, sessionId, accessToken, refreshToken, expiresIn, refreshExpiresIn?): Promise<void>`
- `refreshUserTokens(userId: string, sessionId: string): Promise<RefreshResult>`
- `getStoredTokens(userId: string, sessionId: string): Promise<StoredTokenInfo | null>`
- `hasValidStoredTokens(userId: string, sessionId: string): Promise<boolean>`
- `removeStoredTokens(userId: string, sessionId: string): Promise<void>`

##### Utility Methods
- `hasRefreshTokenSupport(): boolean`
- `getRefreshTokenStats(): RefreshTokenStats | null`
- `healthCheck(): Promise<HealthStatus>`
- `clearTokenFromMemory(token: string): void`
- `dispose(): Promise<void>`

### Configuration Types

#### AuthV2Config
```typescript
interface AuthV2Config {
  jwt: {
    issuer: string;
    audience: string;
    jwksUrl?: string;  // Optional custom JWKS endpoint
  };
  cache: {
    enabled: boolean;
    ttl: {
      jwt: number;      // Seconds to cache JWT validation
      introspect: number; // Seconds to cache introspection
    };
  };
}
```

#### RefreshTokenConfig
```typescript
interface RefreshTokenConfig {
  refreshBuffer: number;     // Seconds before expiry to refresh
  enableEncryption: boolean; // Whether to encrypt stored tokens
  cleanupInterval: number;   // Milliseconds between cleanup runs
  encryptionKey?: string;    // Optional custom encryption key
}
```

## Event Handling

### Token Refresh Events

```typescript
const eventHandlers: RefreshTokenEventHandlers = {
  onTokenStored: async (event: TokenRefreshEvent) => {
    // Fired when tokens are first stored
    console.log(`Tokens stored for ${event.userId}:${event.sessionId}`);
  },

  onTokenRefreshed: async (event: TokenRefreshEvent) => {
    // Fired when tokens are automatically refreshed
    console.log(`Tokens refreshed for ${event.userId}:${event.sessionId}`);

    // Update your session store
    await updateSession(event.userId, event.sessionId, event.newTokens);

    // Notify connected clients via WebSocket
    await notifyClients(event.userId, 'tokens_refreshed');
  },

  onTokenExpired: async (event: TokenExpiryEvent) => {
    // Fired when tokens expire and can't be refreshed
    console.log(`Tokens expired for ${event.userId}:${event.sessionId}, reason: ${event.reason}`);

    // Handle logout
    await logoutUser(event.userId, event.sessionId);

    // Clean up session data
    await cleanupSession(event.userId, event.sessionId);
  },

  onRefreshFailed: async (userId: string, sessionId: string, error: string) => {
    // Fired when automatic refresh fails
    console.error(`Refresh failed for ${userId}:${sessionId}: ${error}`);

    // Log for monitoring
    await logRefreshFailure(userId, sessionId, error);

    // Optional: Attempt manual refresh or notify user
    if (shouldAttemptManualRefresh(error)) {
      await attemptManualRefresh(userId, sessionId);
    }
  }
};
```

## Security Considerations

### Encryption
- **Always enable encryption** for production deployments
- Use strong encryption keys (32+ characters)
- Rotate encryption keys periodically
- Store keys securely (environment variables, key management service)

### Token Storage
- Tokens are encrypted at rest using AES encryption
- Automatic cleanup prevents token accumulation
- TTL-based expiration ensures tokens don't persist indefinitely

### Memory Safety
- Sensitive token data is cleared from memory after use
- Automatic timer cleanup prevents memory leaks
- Health checks monitor for resource issues

### Network Security
- HTTPS required for all Keycloak communication
- JWKS endpoints should be validated
- Token validation includes signature verification

## Examples

### Express.js Middleware

```typescript
import express from 'express';
import { createTokenManagerWithRefresh } from '@libs/keycloak-authv2';

const app = express();

// Initialize token manager
const tokenManager = await createTokenManagerWithRefresh(keycloakClient, config);

// Authentication middleware
const authenticate = async (req: express.Request, res: express.Response, next: express.Function) => {
  const token = tokenManager.extractBearerToken(req.headers.authorization);

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const result = await tokenManager.validateToken(token);

  if (!result.success) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  // Attach user info to request
  (req as any).user = result.user;
  (req as any).auth = result;

  next();
};

// Protected route
app.get('/api/protected', authenticate, async (req, res) => {
  const user = (req as any).user;
  const auth = (req as any).auth;

  // Check permissions
  if (!tokenManager.hasPermission(auth, 'read:protected')) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  res.json({ message: 'Access granted', user: user.id });
});
```

### Session Management with Redis

```typescript
import Redis from 'ioredis';
import { createTokenManagerWithRefresh } from '@libs/keycloak-authv2';

class SessionManager {
  private redis = new Redis();
  private tokenManager: TokenManager;

  constructor() {
    this.tokenManager = await createTokenManagerWithRefresh(
      keycloakClient,
      config,
      refreshConfig,
      metrics,
      {
        onTokenRefreshed: async (event) => {
          // Update Redis session with new tokens
          await this.updateSessionTokens(event.userId, event.sessionId, event.newTokens);
        },
        onTokenExpired: async (event) => {
          // Clean up Redis session
          await this.destroySession(event.userId, event.sessionId);
        }
      }
    );
  }

  async createSession(userId: string, tokens: KeycloakTokenResponse): Promise<string> {
    const sessionId = generateSessionId();

    // Store tokens with automatic refresh
    await this.tokenManager.storeTokensWithRefresh(
      userId,
      sessionId,
      tokens.access_token,
      tokens.refresh_token,
      tokens.expires_in,
      tokens.refresh_expires_in
    );

    // Store session metadata in Redis
    await this.redis.setex(
      `session:${sessionId}`,
      tokens.expires_in,
      JSON.stringify({ userId, createdAt: Date.now() })
    );

    return sessionId;
  }

  async validateSession(sessionId: string): Promise<AuthResult | null> {
    // Check if session exists in Redis
    const sessionData = await this.redis.get(`session:${sessionId}`);
    if (!sessionData) return null;

    // Validate tokens
    const hasValidTokens = await this.tokenManager.hasValidStoredTokens(
      JSON.parse(sessionData).userId,
      sessionId
    );

    if (!hasValidTokens) return null;

    // Get stored tokens for validation
    const storedTokens = await this.tokenManager.getStoredTokens(
      JSON.parse(sessionData).userId,
      sessionId
    );

    if (!storedTokens) return null;

    // Validate the access token
    return await this.tokenManager.validateJwt(storedTokens.accessToken);
  }

  async destroySession(userId: string, sessionId: string): Promise<void> {
    // Remove tokens
    await this.tokenManager.removeStoredTokens(userId, sessionId);

    // Remove session from Redis
    await this.redis.del(`session:${sessionId}`);
  }
}
```

### Real-time WebSocket Integration

```typescript
import WebSocket from 'ws';
import { createTokenManagerWithRefresh } from '@libs/keycloak-authv2';

class WebSocketAuthManager {
  private tokenManager: TokenManager;
  private clients = new Map<string, WebSocket>();

  constructor() {
    this.tokenManager = await createTokenManagerWithRefresh(
      keycloakClient,
      config,
      refreshConfig,
      metrics,
      {
        onTokenRefreshed: async (event) => {
          // Notify client that tokens were refreshed
          const client = this.clients.get(`${event.userId}:${event.sessionId}`);
          if (client) {
            client.send(JSON.stringify({
              type: 'tokens_refreshed',
              expiresIn: event.newTokens?.expires_in
            }));
          }
        },
        onTokenExpired: async (event) => {
          // Force client logout
          const client = this.clients.get(`${event.userId}:${event.sessionId}`);
          if (client) {
            client.send(JSON.stringify({
              type: 'logout',
              reason: event.reason
            }));
            client.close();
          }
        }
      }
    );
  }

  async authenticateWebSocket(client: WebSocket, token: string): Promise<boolean> {
    const result = await this.tokenManager.validateToken(token);

    if (!result.success || !result.user) {
      client.close(1008, 'Authentication failed');
      return false;
    }

    // Store client reference for notifications
    const sessionId = generateSessionId();
    this.clients.set(`${result.user.id}:${sessionId}`, client);

    // Store tokens for automatic refresh
    await this.tokenManager.storeTokensWithRefresh(
      result.user.id,
      sessionId,
      token,
      'refresh-token-from-login', // You'd get this from login
      result.user.tokenLifetime || 3600
    );

    return true;
  }
}
```

### Microservices Integration

```typescript
import { createTokenManagerWithRefresh } from '@libs/keycloak-authv2';
import { EventEmitter } from 'events';

class AuthService extends EventEmitter {
  private tokenManager: TokenManager;

  constructor() {
    super();
    this.initializeTokenManager();
  }

  private async initializeTokenManager() {
    this.tokenManager = await createTokenManagerWithRefresh(
      keycloakClient,
      config,
      refreshConfig,
      metrics,
      {
        onTokenRefreshed: (event) => this.emit('tokenRefreshed', event),
        onTokenExpired: (event) => this.emit('tokenExpired', event),
        onRefreshFailed: (userId, sessionId, error) =>
          this.emit('refreshFailed', { userId, sessionId, error })
      }
    );
  }

  // Service methods
  async validateToken(token: string) {
    return await this.tokenManager.validateToken(token);
  }

  async createUserSession(userId: string, tokens: KeycloakTokenResponse) {
    const sessionId = generateSessionId();

    await this.tokenManager.storeTokensWithRefresh(
      userId,
      sessionId,
      tokens.access_token,
      tokens.refresh_token,
      tokens.expires_in,
      tokens.refresh_expires_in
    );

    // Emit event for other services
    this.emit('sessionCreated', { userId, sessionId, tokens });

    return sessionId;
  }

  async destroyUserSession(userId: string, sessionId: string) {
    await this.tokenManager.removeStoredTokens(userId, sessionId);
    this.emit('sessionDestroyed', { userId, sessionId });
  }
}

// Usage in other services
const authService = new AuthService();

authService.on('tokenRefreshed', (event) => {
  // Update user session in database
  updateUserSession(event.userId, event.sessionId, event.newTokens);
});

authService.on('tokenExpired', (event) => {
  // Log security event
  logSecurityEvent('token_expired', event);

  // Notify user service to invalidate session
  userService.invalidateSession(event.userId, event.sessionId);
});
```

## Troubleshooting

### Common Issues

#### JWT Validation Fails
```typescript
// Check JWKS endpoint configuration
const health = await tokenManager.healthCheck();
console.log('JWKS available:', health.details.jwksAvailable);

// Verify issuer and audience
console.log('Expected issuer:', config.jwt.issuer);
console.log('Expected audience:', config.jwt.audience);
```

#### Token Refresh Not Working
```typescript
// Check refresh token support
console.log('Refresh enabled:', tokenManager.hasRefreshTokenSupport());

// Check stored tokens
const tokens = await tokenManager.getStoredTokens(userId, sessionId);
console.log('Stored tokens:', tokens ? 'Yes' : 'No');

// Check health
const health = await tokenManager.healthCheck();
console.log('Health status:', health.status);
```

#### Memory Issues
```typescript
// Check for timer leaks
const stats = tokenManager.getRefreshTokenStats();
console.log('Active timers:', stats.activeTimers);

// Force cleanup
await tokenManager.dispose();
```

#### Cache Issues
```typescript
// Check cache health
const health = await tokenManager.healthCheck();
console.log('Cache health:', health.details.cacheHealth);

// Clear cache if needed
// Note: Cache clearing depends on your cache implementation
```

### Debug Logging

Enable detailed logging to troubleshoot issues:

```typescript
import { createLogger } from '@libs/utils';

// Set log level to debug
const logger = createLogger("TokenManager");
logger.level = 'debug';
```

### Performance Monitoring

Monitor key metrics:

```typescript
// JWT validation performance
const jwtResult = await tokenManager.validateJwt(token);
// Metrics automatically recorded

// Introspection performance
const introspectResult = await tokenManager.introspectToken(token);
// Metrics automatically recorded

// Health check
const health = await tokenManager.healthCheck();
console.log('Performance metrics:', health.details);
```

## Contributing

1. Follow TypeScript best practices
2. Add comprehensive tests
3. Update documentation
4. Ensure all linting passes
5. Add performance benchmarks for changes

## License

This library is part of the Neurotracker Backend monorepo. See the main project license for details.