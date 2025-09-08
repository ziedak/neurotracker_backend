# Security WebSocket Middleware Implementation

## Executive Summary

The SecurityWebSocketMiddleware has been implemented to provide comprehensive security for WebSocket connections, following the established BaseWebSocketMiddleware patterns. This implementation extends the security capabilities to real-time WebSocket communications with connection-level protection, message filtering, rate limiting, and suspicious behavior detection.

## Key Features

### 1. **Connection Security**

- **Origin Validation**: Configurable allowed origins with CORS support
- **Secure Connection Enforcement**: Require WSS in production environments
- **IP-based Connection Limits**: Prevent connection flooding from single sources
- **Protocol Validation**: Ensure only allowed WebSocket protocols are used

### 2. **Message Security**

- **Message Size Limits**: Prevent large message attacks
- **Message Type Filtering**: Whitelist/blacklist message types
- **Payload Sanitization**: Remove sensitive data from message payloads
- **Content Validation**: Validate message structure and content

### 3. **Rate Limiting**

- **Per-Connection Limits**: Messages per minute/hour limits
- **Bandwidth Limiting**: Bytes per minute limits
- **Sliding Window**: Accurate rate limiting with time windows
- **Violation Tracking**: Track and respond to rate limit violations

### 4. **Suspicious Behavior Detection**

- **Header Validation**: Detect malicious header patterns
- **Connection Monitoring**: Track connection behavior patterns
- **Automatic Blocking**: Block connections with suspicious behavior
- **Security Violation Logging**: Comprehensive security event logging

## Architecture Compliance

### Base Class Extension

```typescript
export class SecurityWebSocketMiddleware extends BaseWebSocketMiddleware<SecurityWebSocketConfig>
```

- Properly extends `BaseWebSocketMiddleware` following established patterns
- Uses `WebSocketMiddlewareConfig` interface compliance
- Implements required abstract methods with WebSocket-specific logic

### Configuration Management

```typescript
export interface SecurityWebSocketConfig extends WebSocketMiddlewareConfig {
  readonly allowedOrigins?: readonly string[];
  readonly maxConnectionsPerIP?: number;
  readonly maxMessageSize?: number;
  // ... additional security options
}
```

- Immutable configuration with readonly properties
- Intelligent default values with environment awareness
- Flexible partial configuration support

## Security Controls Implemented

### 1. **Connection-Level Controls**

#### Origin Validation

```typescript
private isOriginAllowed(context: WebSocketContext): boolean {
  const allowedOrigins = this.config.allowedOrigins!;
  if (allowedOrigins.includes("*")) return true;

  const origin = this.getOrigin(context);
  return allowedOrigins.includes(origin);
}
```

#### Connection Limits

```typescript
// Per-IP connection tracking
private readonly ipConnectionCounts = new Map<string, number>();

// Enforce limits
if (currentCount >= this.config.maxConnectionsPerIP!) {
  throw new Error(`Too many connections from IP: ${clientIp}`);
}
```

#### Secure Connection Enforcement

```typescript
private isSecureConnection(context: WebSocketContext): boolean {
  return (
    context.metadata.headers["x-forwarded-proto"] === "https" ||
    context.metadata.headers["origin"]?.startsWith("https://") ||
    process.env["NODE_ENV"] === "development"
  );
}
```

### 2. **Message-Level Controls**

#### Message Size Validation

```typescript
const messageSize = this.calculateMessageSize(message);
if (messageSize > this.config.maxMessageSize!) {
  throw new Error(`Message too large: ${messageSize} bytes`);
}
```

#### Message Type Filtering

```typescript
// Whitelist check
if (
  this.config.messageTypeWhitelist!.length > 0 &&
  !this.config.messageTypeWhitelist!.includes(message.type)
) {
  throw new Error(`Message type not in whitelist: ${message.type}`);
}

// Blacklist check
if (this.config.messageTypeBlacklist!.includes(message.type)) {
  throw new Error(`Message type blacklisted: ${message.type}`);
}
```

#### Payload Sanitization

```typescript
private sanitizeMessagePayload(context: WebSocketContext): void {
  if (context.message.payload && typeof context.message.payload === "object") {
    context.message.payload = this.sanitizeObject(context.message.payload, [
      "password", "token", "secret", "key", "auth", "credential"
    ]);
  }
}
```

### 3. **Rate Limiting System**

#### Sliding Window Rate Limiting

```typescript
interface RateLimitInfo {
  minuteWindow: number;
  hourWindow: number;
  messagesThisMinute: number;
  messagesThisHour: number;
  bytesThisMinute: number;
}
```

#### Multi-Level Limits

- **Messages per minute**: Short-term burst protection
- **Messages per hour**: Long-term abuse prevention
- **Bytes per minute**: Bandwidth consumption control

#### Dynamic Window Management

```typescript
// Reset windows if needed
if (now - rateLimitInfo.minuteWindow >= 60000) {
  rateLimitInfo.minuteWindow = now;
  rateLimitInfo.messagesThisMinute = 0;
  rateLimitInfo.bytesThisMinute = 0;
}
```

## Environment-Specific Configurations

### Development Configuration

```typescript
static createDevelopmentConfig(): Partial<SecurityWebSocketConfig> {
  return {
    allowedOrigins: ["*"],          // Allow all origins
    maxConnectionsPerIP: 50,        // Higher limits
    requireSecureConnection: false, // Allow insecure connections
    blockSuspiciousConnections: false,
    validateHeaders: false,         // Relaxed validation
  };
}
```

### Production Configuration

```typescript
static createProductionConfig(): Partial<SecurityWebSocketConfig> {
  return {
    allowedOrigins: [],             // Must be explicitly configured
    maxConnectionsPerIP: 5,         // Strict limits
    requireSecureConnection: true,  // Require WSS
    blockSuspiciousConnections: true,
    messageTypeBlacklist: ["eval", "script", "admin", "system"],
    validateHeaders: true,
  };
}
```

### High-Security Configuration

```typescript
static createHighSecurityConfig(): Partial<SecurityWebSocketConfig> {
  return {
    maxConnectionsPerIP: 2,         // Very strict
    messageTypeWhitelist: ["chat", "heartbeat", "auth"], // Only allowed types
    rateLimitPerConnection: {
      messagesPerMinute: 10,        // Very conservative
      messagesPerHour: 100,
      bytesPerMinute: 128 * 1024,   // 128KB
    },
    connectionTimeout: 10000,       // 10 seconds
    maxMessageSize: 512 * 1024,     // 512KB
  };
}
```

### Specialized Configurations

#### Chat Application

```typescript
export const ChatWebSocketSecurityPreset: Partial<SecurityWebSocketConfig> = {
  messageTypeWhitelist: ["message", "typing", "join", "leave", "heartbeat"],
  rateLimitPerConnection: {
    messagesPerMinute: 60, // Allow frequent messaging
    messagesPerHour: 2000,
    bytesPerMinute: 1024 * 1024, // 1MB for media sharing
  },
  maxMessageSize: 2 * 1024 * 1024, // 2MB for file sharing
};
```

#### Gaming Application

```typescript
export const GamingWebSocketSecurityPreset: Partial<SecurityWebSocketConfig> = {
  messageTypeWhitelist: ["move", "action", "state", "ping", "heartbeat"],
  rateLimitPerConnection: {
    messagesPerMinute: 300, // High frequency for real-time
    messagesPerHour: 10000,
    bytesPerMinute: 512 * 1024, // Smaller messages
  },
  maxMessageSize: 64 * 1024, // Small for efficiency
  heartbeatInterval: 5000, // Frequent heartbeat
};
```

## Memory Management & Performance

### Connection Registry

```typescript
private readonly connectionRegistry = new Map<string, ConnectionInfo>();
```

- Tracks active connections with metadata
- Monitors message counts and byte usage
- Records security violations per connection

### Automatic Cleanup

```typescript
private startCleanupInterval(): void {
  setInterval(() => {
    this.cleanupStaleConnections();
    this.cleanupRateLimitData();
  }, 60000); // Every minute
}
```

- Removes stale connection data
- Cleans up rate limiting information
- Prevents memory leaks in long-running applications

### Efficient Data Structures

- Map-based lookups for O(1) performance
- Minimal memory footprint per connection
- Lazy initialization of rate limit data

## Factory Functions & Usage

### Environment-Based Factories

```typescript
// Development
const devSecurity = SecurityWebSocketMiddleware.createDevelopment(
  metrics,
  config
);

// Production
const prodSecurity = SecurityWebSocketMiddleware.createProduction(
  metrics,
  config
);

// High Security
const strictSecurity = SecurityWebSocketMiddleware.createHighSecurity(
  metrics,
  config
);

// API Gateway
const apiSecurity = SecurityWebSocketMiddleware.createApiGateway(
  metrics,
  config
);
```

### Framework-Agnostic Usage

```typescript
import { createSecurityWebSocketMiddleware } from "@libs/middleware";

const middleware = createSecurityWebSocketMiddleware(metrics, {
  allowedOrigins: ["https://myapp.com"],
  maxConnectionsPerIP: 10,
});

// Use with any WebSocket framework
wsServer.use(middleware);
```

### Combined HTTP & WebSocket Security

```typescript
import { createFullStackSecurity } from "@libs/middleware";

const security = createFullStackSecurity(
  "production",
  metrics,
  httpConfig,
  wsConfig
);

// Apply both
app.use(security.httpFunction);
wsServer.use(security.websocketFunction);
```

## Security Benefits

### Attack Vector Mitigation

- **Connection Flooding**: IP-based connection limits
- **Message Flooding**: Rate limiting per connection
- **Large Message Attacks**: Message size limits
- **Protocol Attacks**: Protocol and header validation
- **Cross-Origin Attacks**: Origin validation
- **Data Exfiltration**: Payload sanitization
- **Suspicious Behavior**: Behavioral monitoring

### Compliance Support

- **WebSocket Security Standards**: Industry best practices
- **Data Privacy**: Automatic payload sanitization
- **Audit Requirements**: Comprehensive logging
- **Performance SLAs**: Rate limiting and resource control

## Monitoring & Metrics

### Security Metrics

```typescript
await this.recordMetric("websocket_security_message_processed", 1, {
  messageType: context.message.type,
  origin: this.getOrigin(context),
  clientIp: context.metadata.clientIp,
});
```

### Performance Metrics

```typescript
await this.recordHistogram("websocket_security_message_size", messageSize, {
  messageType: context.message.type,
});
```

### Security Violations

```typescript
await this.recordMetric("websocket_security_violation", 1, {
  violationType: error.message,
  messageType: context.message.type,
  origin: this.getOrigin(context),
});
```

## Integration Examples

### Basic WebSocket Security

```typescript
import { SecurityWebSocketMiddleware } from "@libs/middleware";

const security = new SecurityWebSocketMiddleware(metrics, {
  name: "chat-security",
  allowedOrigins: ["https://chat.example.com"],
  maxConnectionsPerIP: 5,
  messageTypeWhitelist: ["message", "heartbeat"],
});

wsServer.use(security.middleware());
```

### Environment-Specific Setup

```typescript
import { createWebSocketSecurityForEnvironment } from "@libs/middleware";

const security = createWebSocketSecurityForEnvironment(
  process.env.NODE_ENV === "production" ? "production" : "development",
  metrics,
  {
    allowedOrigins: process.env.ALLOWED_ORIGINS?.split(",") || ["*"],
  }
);
```

### Chat Application Setup

```typescript
import { ChatWebSocketSecurityPreset } from "@libs/middleware";

const chatSecurity = new SecurityWebSocketMiddleware(metrics, {
  ...ChatWebSocketSecurityPreset,
  allowedOrigins: ["https://chat.myapp.com"],
  maxConnectionsPerIP: 3, // Override preset
});
```

## Testing Support

### Mock Middleware

```typescript
import { createMockWebSocketSecurity } from "@libs/middleware";

const mockSecurity = createMockWebSocketSecurity(); // Disabled for testing
```

### Test Configuration

```typescript
import { createTestWebSocketSecurity } from "@libs/middleware";

const testSecurity = createTestWebSocketSecurity(metrics, {
  allowedOrigins: ["*"],
  requireSecureConnection: false,
});
```

## Conclusion

The SecurityWebSocketMiddleware provides enterprise-grade WebSocket security with:

- **Comprehensive Protection**: Multi-layered security controls
- **Performance Optimization**: Efficient memory and CPU usage
- **Flexible Configuration**: Environment-specific presets
- **Production Ready**: Extensive monitoring and logging
- **Framework Agnostic**: Works with any WebSocket implementation
- **Developer Friendly**: Simple configuration and testing utilities

This implementation ensures secure WebSocket communications while maintaining the flexibility and performance required for modern real-time applications.
