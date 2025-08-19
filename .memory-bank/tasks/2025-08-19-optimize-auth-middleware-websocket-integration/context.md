# Context Documentation

## Current Authentication Architecture

### Overview

The system currently has separate authentication implementations for HTTP and WebSocket protocols, with some shared utilities but no unified approach.

### Current Implementation Files

#### libs/auth/

```
├── src/
│   ├── index.ts (exports)
│   ├── jwt.ts (JWTService)
│   ├── auth-guard.ts (HTTP-only AuthGuard)
│   ├── password.ts (PasswordService)
│   └── types.ts (shared types)
```

#### libs/middleware/

```
├── src/
│   ├── index.ts (exports)
│   ├── auth.ts (HTTP auth middleware)
│   ├── websocket/
│   │   ├── BaseWebSocketMiddleware.ts
│   │   ├── WebSocketAuthMiddleware.ts
│   │   └── WebSocketRateLimitMiddleware.ts
│   └── ... (other middleware)
```

### Current Pain Points

#### 1. Fragmented Authentication Context

- HTTP requests use standard Elysia context
- WebSocket messages use custom WebSocket context
- No shared authentication data structures
- Different error handling patterns

#### 2. Session Management Gaps

- No centralized session store
- No session persistence across protocol switches
- Limited session lifecycle management
- No session analytics

#### 3. Performance Limitations

- No permission caching
- Repeated database queries for auth checks
- No optimized JWT token validation
- Limited rate limiting coordination

#### 4. Security Concerns

- No JWT token revocation mechanism
- Limited API key management
- No comprehensive audit trail
- Missing CSRF protection for WebSocket

## Requirements from User

### Primary Goals

1. **Professional-level application** with enterprise-grade authentication
2. **Dual protocol support** (HTTP + WebSocket) with seamless authentication
3. **Redis/PostgreSQL session management** for high availability
4. **Production-grade code** without shortcuts

### Technical Specifications

- Support 1000+ concurrent authenticated sessions
- Authentication latency < 50ms (95th percentile)
- Session lookup < 10ms
- Permission checks < 5ms
- Comprehensive logging and monitoring
- JWT token rotation every 15 minutes

### Integration Requirements

- Use existing libs/database for data access
- Integrate with libs/monitoring for telemetry
- Maintain backward compatibility with current HTTP auth
- Support horizontal scaling and high availability

## Success Metrics

### Functional Metrics

- [ ] 100% feature parity between HTTP and WebSocket auth
- [ ] Zero authentication bypasses or privilege escalations
- [ ] Complete session lifecycle management
- [ ] Comprehensive permission system

### Performance Metrics

- [ ] < 50ms authentication latency (95th percentile)
- [ ] < 10ms session lookup latency
- [ ] < 5ms permission check latency
- [ ] > 1000 concurrent authenticated sessions

### Security Metrics

- [ ] Zero authentication vulnerabilities
- [ ] 100% audit trail coverage
- [ ] Proper token rotation and revocation
- [ ] CSRF and session fixation prevention
