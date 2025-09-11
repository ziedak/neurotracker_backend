# Rate Limiting Middleware

This directory contains comprehensive rate limiting middleware implementations for both HTTP and WebSocket protocols.

## Overview

- **RateLimitMiddleware.ts**: HTTP rate limiting middleware with enterprise-grade features
- **WebSocketRateLimitMiddleware.ts**: WebSocket rate limiting middleware with dual-level controls
- **strategies/**: Key generation strategies for rate limiting

## HTTP Rate Limiting (`RateLimitMiddleware`)

Production-grade HTTP rate limiting middleware that extends `AbstractMiddleware` with enterprise cache adapter integration.

### Features

- **Multiple Rate Limiting Algorithms**: sliding-window, fixed-window, token-bucket, leaky-bucket
- **Flexible Key Generation**: IP, user, API key, or custom strategies
- **Enterprise Cache Integration**: Uses `RateLimitingCacheAdapter` with Redis backend
- **Request Type Filtering**: Include/exclude specific routes or HTTP methods
- **Comprehensive Headers**: Standard rate limit headers (X-RateLimit-Limit, etc.)
- **Bypass Routes**: Skip rate limiting for health checks, metrics, etc.
- **Metrics Integration**: Built-in performance and usage metrics
- **Error Handling**: Graceful degradation with fail-open pattern

### Usage

```typescript
import {
  RateLimitMiddleware,
  createRateLimitMiddleware,
  RATE_LIMIT_PRESETS,
} from "@libs/middleware";

// Using factory function with preset
const rateLimitMiddleware = createRateLimitMiddleware(metrics, {
  ...RATE_LIMIT_PRESETS.general(),
  maxRequestsPerMinute: 100,
  keyStrategy: "user",
});

// Using constructor with custom configuration
const customRateLimit = new RateLimitMiddleware(metrics, {
  algorithm: "sliding-window",
  maxRequestsPerMinute: 60,
  windowMs: 60000,
  keyStrategy: "ip",
  bypassRoutes: ["/health", "/metrics"],
  standardHeaders: true,
  enabled: true,
});
```

### Configuration Presets

- **General**: Balanced settings for most applications (1000 req/min)
- **Strict**: Conservative limits for sensitive APIs (100 req/min)
- **API**: High-throughput for API services (5000 req/min)
- **Development**: Relaxed limits for development (10000 req/min)
- **Production**: Optimized for production environments

## WebSocket Rate Limiting (`WebSocketRateLimitMiddleware`)

Advanced WebSocket rate limiting with both connection-level and message-level controls.

### Features

- **Dual-Level Rate Limiting**: Separate limits for connections and messages
- **Connection Management**: Per-IP connection limits with automatic cleanup
- **Message Type Filtering**: Include/exclude specific message types
- **Warning System**: Proactive warnings before limits are reached
- **WebSocket-Specific Strategies**: Connection-based, user-based, IP-based key generation
- **Real-time Notifications**: Send rate limit status to clients
- **Connection Closure**: Optionally close connections on limit breach
- **Gaming Optimized**: Special presets for high-frequency applications

### Usage

```typescript
import {
  WebSocketRateLimitMiddleware,
  createWebSocketRateLimitMiddleware,
  WEBSOCKET_RATE_LIMIT_PRESETS,
} from "@libs/middleware";

// Using factory function with preset
const wsRateLimit = createWebSocketRateLimitMiddleware(metrics, {
  ...WEBSOCKET_RATE_LIMIT_PRESETS.chat(),
  maxMessagesPerMinute: 60,
  maxConnectionsPerIP: 10,
});

// Using constructor with custom configuration
const customWSRateLimit = new WebSocketRateLimitMiddleware(metrics, {
  algorithm: "sliding-window",
  maxMessagesPerMinute: 120,
  maxConnectionsPerIP: 5,
  windowMs: 60000,
  keyStrategy: "user",
  enableConnectionLimiting: true,
  closeOnLimit: false,
  sendWarningMessage: true,
  warningThreshold: 80,
  excludeMessageTypes: ["ping", "pong", "heartbeat"],
});
```

### Configuration Presets

- **General**: Standard WebSocket application settings
- **Strict**: Conservative limits with connection closure
- **Gaming**: High-frequency optimized for gaming applications
- **Chat**: Optimized for chat applications with typing indicators
- **Development**: Relaxed limits for development
- **Production**: Balanced production settings

## Key Generation Strategies

Both middlewares support multiple key generation strategies:

### HTTP Strategies (`strategies/`)

- **IpStrategy**: Rate limit by client IP address
- **UserStrategy**: Rate limit by authenticated user ID
- **ApiKeyStrategy**: Rate limit by API key header

### WebSocket Strategies (built-in)

- **ip**: Rate limit by client IP address
- **user**: Rate limit by authenticated user ID
- **connectionId**: Rate limit by WebSocket connection ID
- **custom**: Custom key generation function

## Enterprise Features

### Cache Integration

Both middlewares use the enterprise `RateLimitingCacheAdapter` which provides:

- **Redis Backend**: Distributed rate limiting across multiple instances
- **Batch Processing**: Optimized bulk operations
- **Compression**: Efficient storage of rate limit data
- **Metrics**: Built-in performance monitoring
- **Health Checks**: Cache connectivity monitoring

### Monitoring & Metrics

Comprehensive metrics tracking:

- Request/message processing times
- Rate limit hit rates
- Cache performance statistics
- Error rates and types
- Algorithm performance comparisons

### Error Handling

- **Fail-Open Pattern**: Continue processing if cache is unavailable
- **Graceful Degradation**: Fallback to in-memory limits
- **Comprehensive Logging**: Detailed error context and debugging information
- **Health Status**: Real-time health monitoring

## Migration Guide

### From Legacy Rate Limiting

If migrating from legacy rate limiting implementations:

1. **Update Imports**: Use new module paths
2. **Configuration Changes**: Review new configuration options
3. **Strategy Updates**: Update key generation strategies
4. **Cache Adapter**: Ensure cache service is properly configured
5. **Metrics Integration**: Update metrics collection setup

### Configuration Migration

```typescript
// Old configuration
const oldConfig = {
  windowMs: 60000,
  maxRequests: 100,
  keyStrategy: "ip",
};

// New configuration
const newConfig = {
  algorithm: "sliding-window",
  maxRequestsPerMinute: 100,
  windowMs: 60000,
  keyStrategy: "ip",
  standardHeaders: true,
  enabled: true,
};
```

## Best Practices

### Production Deployment

1. **Use Appropriate Presets**: Start with production presets and customize
2. **Monitor Metrics**: Set up alerts for rate limit violations
3. **Redis Configuration**: Ensure Redis is properly configured for your load
4. **Bypass Routes**: Always exclude health checks and metrics endpoints
5. **Gradual Rollout**: Test with relaxed limits before tightening

### WebSocket Considerations

1. **Message Type Filtering**: Exclude heartbeat/ping messages from limits
2. **Connection Limits**: Set reasonable per-IP connection limits
3. **Warning System**: Enable warnings to improve user experience
4. **Gaming Applications**: Use gaming presets for high-frequency scenarios

### Performance Optimization

1. **Key Strategy Selection**: Choose the most appropriate key strategy
2. **Algorithm Selection**: Test different algorithms for your use case
3. **Cache Configuration**: Optimize Redis settings for your load
4. **Batch Processing**: Enable batch processing for high-volume scenarios

## Troubleshooting

### Common Issues

1. **Cache Connectivity**: Ensure Redis is accessible and properly configured
2. **Key Collisions**: Verify key generation strategies are unique
3. **High Memory Usage**: Check Redis memory usage and TTL settings
4. **Performance Issues**: Monitor cache adapter metrics

### Debug Information

Both middlewares provide extensive debug logging:

```typescript
// Enable debug logging
const middleware = new RateLimitMiddleware(metrics, {
  // ... configuration
});

// Check health status
const health = await middleware.getHealth();
console.log("Rate limiter health:", health);

// Get statistics
const stats = await middleware.getRateLimitStats();
console.log("Rate limit statistics:", stats);
```

## Support

For issues or questions:

1. Check the middleware health status
2. Review debug logs for detailed error information
3. Verify cache service connectivity
4. Check configuration against provided examples
