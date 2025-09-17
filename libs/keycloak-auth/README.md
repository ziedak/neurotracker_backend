# @libs/keycloak-auth

Production-ready Keycloak authentication library with WebSocket support for Elysia microservices.

## Features

- 🔐 **Multi-Client Keycloak Integration** - Support for Authorization Code, Client Credentials, Direct Grant, and WebSocket flows
- 🚀 **WebSocket Authentication** - First-class WebSocket authentication support using Elysia's native WebSocket
- 📦 **Cache Integration** - Uses existing `@libs/database` cache infrastructure for optimal performance
- 🔒 **JWT Validation** - JWKS-based JWT validation with automatic key rotation
- 🌐 **Token Introspection** - Keycloak token introspection with intelligent caching
- 📋 **TypeScript Support** - Comprehensive TypeScript types with strict mode compliance
- 🛡️ **Security First** - Built-in protection against common authentication vulnerabilities

## Installation

```bash
# Already installed as workspace dependency
pnpm install
```

## Quick Start

### 1. Environment Configuration

```bash
# Keycloak Configuration
KEYCLOAK_SERVER_URL=https://your-keycloak.com
KEYCLOAK_REALM=your-realm

# Client Configurations
KEYCLOAK_FRONTEND_CLIENT_ID=frontend-spa
KEYCLOAK_SERVICE_CLIENT_ID=backend-service
KEYCLOAK_SERVICE_CLIENT_SECRET=your-service-secret
KEYCLOAK_TRACKER_CLIENT_ID=tracker-client
KEYCLOAK_TRACKER_CLIENT_SECRET=your-tracker-secret
KEYCLOAK_WEBSOCKET_CLIENT_ID=websocket-client

# Cache Configuration
REDIS_URL=redis://localhost:6379
AUTH_CACHE_TTL=3600
AUTH_INTROSPECTION_TTL=300
```

### 2. Basic Usage

```typescript
import {
  createKeycloakClientFactory,
  createTokenIntrospectionService,
  createWebSocketTokenValidator,
  createEnvironmentConfig,
} from "@libs/keycloak-auth";
import { CacheService } from "@libs/database";

// Create services
const envConfig = createEnvironmentConfig();
const clientFactory = createKeycloakClientFactory(envConfig);
const cacheService = new CacheService(/* your cache config */);
const introspectionService = createTokenIntrospectionService(
  clientFactory,
  cacheService
);
const wsTokenValidator = createWebSocketTokenValidator(
  introspectionService,
  cacheService
);

// Validate JWT token
const result = await introspectionService.validateJWT(token);
if (result.valid) {
  console.log("User authenticated:", result.claims?.sub);
}
```

### 3. WebSocket Authentication

```typescript
import { Elysia, t } from "elysia";

const app = new Elysia()
  .ws("/ws", {
    // Query validation for WebSocket upgrade
    query: t.Object({
      token: t.Optional(t.String()),
    }),

    // Extract and validate token before connection upgrade
    beforeHandle: async ({ query, set }) => {
      const token = query.token;
      if (!token) {
        set.status = 401;
        return { error: "Token required" };
      }

      const result = await introspectionService.validateJWT(token);
      if (!result.valid) {
        set.status = 401;
        return { error: "Invalid token" };
      }
    },

    // Handle WebSocket connection
    open(ws) {
      console.log("Authenticated WebSocket connection opened");
      // Store auth context in ws.data if needed
    },

    message(ws, message) {
      // Handle authenticated WebSocket messages
      console.log("Message from authenticated user:", message);
      ws.send(`Echo: ${message}`);
    },
  })
  .listen(3000);
```

## Client Types

The library supports different client configurations for various use cases:

### Frontend (SPA) - Authorization Code Flow

```typescript
const frontendClient = clientFactory.getClient("frontend");
const authUrl = await clientFactory.createAuthorizationUrl(
  state,
  nonce,
  codeChallenge
);
```

### Service-to-Service - Client Credentials Flow

```typescript
const serviceClient = clientFactory.getClient("services");
const tokenResponse = await clientFactory.getClientCredentialsToken("services");
```

### TrackerJS - Direct Grant Flow (Limited Use)

```typescript
const trackerClient = clientFactory.getClient("tracker");
// Use with caution - Direct Grant should be limited
```

### WebSocket - Connection Authentication

```typescript
const wsClient = clientFactory.getClient("websocket");
// Used by WebSocketTokenValidator for connection authentication
```

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Elysia App    │───▶│  Auth Middleware│───▶│   Keycloak      │
│   HTTP/WebSocket│    │  JWT/Introspect │    │   Server        │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  @libs/database │    │   Token Cache   │    │   Discovery     │
│   CacheService  │    │   Redis Layer   │    │   Endpoints     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## API Reference

### Core Services

#### `KeycloakClientFactory`

- `getClient(type)` - Get client configuration by type
- `createAuthorizationUrl()` - Create OAuth authorization URL
- `exchangeCodeForToken()` - Exchange auth code for tokens
- `refreshToken()` - Refresh access token
- `getClientCredentialsToken()` - Get service token

#### `TokenIntrospectionService`

- `validateJWT()` - Validate JWT with JWKS
- `introspect()` - Introspect token with Keycloak
- `getPublicKey()` - Get public key for verification
- `cleanupExpiredTokens()` - Cache cleanup

#### `WebSocketTokenValidator`

- `extractToken()` - Extract token from request
- `validateConnectionToken()` - Validate WebSocket token
- `hasPermission()` - Check user permissions
- `refreshAuthContext()` - Refresh auth for long connections

### Utility Functions

```typescript
import {
  extractBearerToken,
  isTokenExpired,
  extractScopes,
  hasRequiredScopes,
  extractPermissions,
  hasRequiredPermissions,
} from "@libs/keycloak-auth";

// Extract token from header
const token = extractBearerToken(request.headers.authorization);

// Check expiration
if (isTokenExpired(claims.exp)) {
  // Token expired
}

// Check permissions
if (hasRequiredScopes(userScopes, ["read:users", "write:users"])) {
  // User has required scopes
}
```

## Error Handling

The library provides specific error classes:

```typescript
import {
  AuthenticationError,
  TokenValidationError,
  WebSocketAuthError,
  PermissionError,
} from "@libs/keycloak-auth";

try {
  await introspectionService.validateJWT(token);
} catch (error) {
  if (error instanceof TokenValidationError) {
    // Handle token validation error
  } else if (error instanceof AuthenticationError) {
    // Handle general auth error
  }
}
```

## Integration with Existing Middleware

The library is designed to integrate seamlessly with existing Elysia middleware:

```typescript
import { Elysia } from "elysia";
import { createAuthMiddleware } from "@libs/elysia-server"; // Your existing middleware

const app = new Elysia()
  .use(createAuthMiddleware()) // Existing middleware
  .ws("/ws", {
    // Keycloak WebSocket authentication
    beforeHandle: async ({ query, set }) => {
      // WebSocket-specific auth logic
    },
  });
```

## Performance Considerations

- **Caching**: All token validations are cached using Redis
- **JWKS**: Public keys are cached and automatically rotated
- **Connection Pooling**: Reuses HTTP connections to Keycloak
- **Background Cleanup**: Expired tokens are automatically removed

## Security Features

- **No Password Validation**: All authentication handled by Keycloak
- **Token Hashing**: Cache keys use hashed tokens for security
- **Fail Secure**: Authentication failures result in access denial
- **Audit Logging**: All authentication events are logged
- **Rate Limiting**: Integrates with existing rate limiting middleware

## Development Status

**Phase 1: Foundation ✅ (33% Complete)**

- ✅ Core library structure
- ✅ TypeScript configuration
- ✅ Comprehensive type definitions
- ✅ Keycloak client factory
- ✅ Token introspection service
- ✅ WebSocket token validator
- ✅ Cache integration with @libs/database

**Upcoming Phases:**

- Phase 2: Complete middleware integration
- Phase 3: All authentication flows
- Phase 4: Authorization and permissions
- Phase 5: Monitoring and optimization

## Contributing

This library is part of the Neurotracker backend microservices architecture. Follow the established patterns and ensure all changes include comprehensive tests.

## License

MIT - Internal use within Neurotracker project.
