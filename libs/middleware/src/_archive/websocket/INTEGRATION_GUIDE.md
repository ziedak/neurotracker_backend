/\*\*

- ELYSIA WEBSOCKET RATE LIMITER INTEGRATION GUIDE
- ==============================================
-
- This guide shows how to properly integrate ElysiaWebSocketRateLimiter
- with Elysia's built-in WebSocket support (.ws() method).
  \*/

/\*\*

- KEY INTEGRATION PATTERNS
- =======================
-
- 1.  The ElysiaWebSocketRateLimiter creates middleware functions that work
- within Elysia's .ws() handlers, NOT as standalone middleware classes.
-
- 2.  Use createElysiaWebSocketRateLimitMiddleware() to generate functions
- that integrate with Elysia's message handler flow.
-
- 3.  Rate limiting applies to the message handler - each incoming WebSocket
- message is checked against rate limits before processing.
  \*/

/\*\*

- BASIC INTEGRATION EXAMPLE
- ========================
-
- import { Elysia } from "elysia";
- import {
- ElysiaWebSocketRateLimiter,
- createElysiaWebSocketRateLimitMiddleware,
- ElysiaWebSocketRateLimitPresets
- } from "./ElysiaWebSocketRateLimiter";
-
- // Setup in your service class
- class WebSocketService {
- constructor(logger, metrics, redisClient) {
-     this.rateLimiter = new ElysiaWebSocketRateLimiter(logger, metrics, redisClient);
- }
-
- createApp() {
-     // Create the rate limiting middleware function
-     const rateLimitMiddleware = createElysiaWebSocketRateLimitMiddleware(
-       this.rateLimiter,
-       ElysiaWebSocketRateLimitPresets.general({ maxMessagesPerMinute: 30 })
-     );
-
-     return new Elysia()
-       .ws("/ws", {
-         message: async (ws, message) => {
-           // Parse message
-           const parsedMessage = JSON.parse(message.toString());
-
-           // Create context for the middleware
-           const context = {
-             ws,
-             connectionId: ws.data.connectionId || this.generateId(),
-             message: parsedMessage,
-             metadata: {
-               connectedAt: ws.data.connectedAt || new Date(),
-               lastActivity: new Date(),
-               messageCount: (ws.data.messageCount || 0) + 1,
-               clientIp: ws.data.clientIp || "unknown",
-               headers: ws.data.headers || {},
-               query: ws.data.query || {},
-             },
-             authenticated: !!ws.data.userId,
-             userId: ws.data.userId,
-           };
-
-           // Update message count
-           ws.data.messageCount = context.metadata.messageCount;
-
-           // Apply rate limiting - this is where the magic happens!
-           await rateLimitMiddleware(context, async () => {
-             // Your actual message handling logic
-             await this.handleMessage(context);
-           });
-         },
-
-         open: (ws) => {
-           ws.data.connectionId = this.generateId();
-           ws.data.connectedAt = new Date();
-           ws.data.messageCount = 0;
-           // ... setup logic
-         },
-
-         close: (ws) => {
-           // Cleanup rate limiting data
-           this.rateLimiter.cleanupConnection(
-             ws.data.connectionId,
-             `rate_limit_key_for_${ws.data.userId || ws.data.clientIp}`
-           );
-         }
-       });
- }
- }
  \*/

/\*\*

- MULTIPLE ENDPOINTS WITH DIFFERENT RATE LIMITS
- =============================================
-
- You can create different WebSocket endpoints with tailored rate limiting:
-
- const app = new Elysia();
-
- // Chat endpoint - moderate rate limiting, skip typing indicators
- const chatRateLimit = createElysiaWebSocketRateLimitMiddleware(
- rateLimiter,
- ElysiaWebSocketRateLimitPresets.chat({
-     maxMessagesPerMinute: 25,
-     skipMessageTypes: ["typing", "read_receipt", "presence"]
- })
- );
-
- app.ws("/ws/chat", {
- message: async (ws, message) => {
-     const context = createContext(ws, message, "chat");
-     await chatRateLimit(context, () => handleChatMessage(context));
- }
- });
-
- // Game endpoint - high-frequency rate limiting
- const gameRateLimit = createElysiaWebSocketRateLimitMiddleware(
- rateLimiter,
- ElysiaWebSocketRateLimitPresets.game({
-     maxMessagesPerMinute: 200,
-     skipMessageTypes: ["player_position", "heartbeat", "input"]
- })
- );
-
- app.ws("/ws/game", {
- message: async (ws, message) => {
-     const context = createContext(ws, message, "game");
-     await gameRateLimit(context, () => handleGameMessage(context));
- }
- });
-
- // API endpoint - custom key generation for API keys
- const apiRateLimit = createElysiaWebSocketRateLimitMiddleware(
- rateLimiter,
- ElysiaWebSocketRateLimitPresets.api({
-     keyGenerator: (context) => {
-       const apiKey = context.metadata.headers["x-api-key"];
-       return apiKey
-         ? `api_key:${apiKey}`
-         : `ip:${context.metadata.clientIp}`;
-     }
- })
- );
-
- app.ws("/ws/api", {
- message: async (ws, message) => {
-     const context = createContext(ws, message, "api");
-     await apiRateLimit(context, () => handleApiMessage(context));
- }
- });
  \*/

/\*\*

- CUSTOM RATE LIMITING CONFIGURATION
- ==================================
-
- For specialized use cases, create custom configurations:
-
- const customConfig = {
- name: "iot-device-rate-limit",
- enabled: true,
- maxConnections: 10000,
- maxMessagesPerMinute: 5, // Low frequency for IoT
- maxMessagesPerHour: 100,
- skipMessageTypes: ["device_status", "heartbeat", "ping"],
-
- // Device-specific key generation
- keyGenerator: (context) => {
-     const deviceId = context.metadata.headers["x-device-id"];
-     return deviceId ? `device:${deviceId}` : `ip:${context.metadata.clientIp}`;
- },
-
- // Custom rate limit exceeded handler
- onLimitExceeded: (context, limit) => {
-     context.ws.send(JSON.stringify({
-       type: "device_rate_limit_error",
-       error: {
-         code: "DEVICE_RATE_LIMIT_EXCEEDED",
-         message: `Device rate limit exceeded: ${limit}`,
-         retryAfter: 60
-       }
-     }));
- },
-
- redis: {
-     keyPrefix: "iot_rate_limit",
-     ttl: 3600
- }
- };
-
- const iotRateLimit = createElysiaWebSocketRateLimitMiddleware(
- rateLimiter,
- customConfig
- );
  \*/

/\*\*

- RATE LIMITING PRESETS AVAILABLE
- ===============================
-
- ElysiaWebSocketRateLimitPresets.general(options?)
- - Default: 60 messages/minute, 2000 messages/hour
- - Good for: General purpose WebSocket applications
-
- ElysiaWebSocketRateLimitPresets.chat(options?)
- - Default: 30 messages/minute, skip typing indicators
- - Good for: Chat applications, social features
-
- ElysiaWebSocketRateLimitPresets.game(options?)
- - Default: 120 messages/minute, skip position updates
- - Good for: Real-time games, interactive applications
-
- ElysiaWebSocketRateLimitPresets.api(options?)
- - Default: 100 messages/minute, supports API key identification
- - Good for: API endpoints, automated systems
-
- ElysiaWebSocketRateLimitPresets.dataStream(options?)
- - Default: 300 messages/minute, skip data events
- - Good for: High-frequency data streaming, telemetry
-
- ElysiaWebSocketRateLimitPresets.strict(options?)
- - Default: 10 messages/minute, very restrictive
- - Good for: Public endpoints, abuse prevention
    \*/

/\*\*

- CONTEXT CREATION HELPER
- =======================
-
- Create a helper function to consistently build contexts:
-
- function createWebSocketContext(ws, message, appType = "general") {
- const messageCount = (ws.data["messageCount"] || 0) + 1;
- ws.data["messageCount"] = messageCount;
-
- return {
-     ws,
-     connectionId: ws.data["connectionId"] || generateConnectionId(),
-     message: typeof message === "string" ? JSON.parse(message) : message,
-     metadata: {
-       connectedAt: ws.data["connectedAt"] || new Date(),
-       lastActivity: new Date(),
-       messageCount,
-       clientIp: ws.data["clientIp"] || "unknown",
-       userAgent: ws.data["userAgent"],
-       headers: ws.data["headers"] || {},
-       query: ws.data["query"] || {},
-     },
-     authenticated: !!ws.data["userId"],
-     userId: ws.data["userId"],
-     userRoles: ws.data["userRoles"] || [],
-     rooms: ws.data["rooms"] || [appType],
-     appType
- };
- }
  \*/

/\*\*

- ERROR HANDLING PATTERNS
- =======================
-
- Handle rate limiting gracefully:
-
- const rateLimitMiddleware = createElysiaWebSocketRateLimitMiddleware(
- rateLimiter,
- {
-     ...ElysiaWebSocketRateLimitPresets.general(),
-     onLimitExceeded: (context, limit) => {
-       // Log the rate limit
-       logger.warn("Rate limit exceeded", {
-         connectionId: context.connectionId,
-         userId: context.userId,
-         limit
-       });
-
-       // Send user-friendly error
-       context.ws.send(JSON.stringify({
-         type: "rate_limit_error",
-         error: {
-           code: "TOO_MANY_MESSAGES",
-           message: "You are sending messages too quickly. Please slow down.",
-           retryAfter: 60
-         },
-         timestamp: new Date().toISOString()
-       }));
-
-       // Optionally disconnect repeat offenders
-       if (limit.includes("severe")) {
-         context.ws.close();
-       }
-     }
- }
- );
  \*/

/\*\*

- TESTING UTILITIES
- ================
-
- Use the provided test utilities for unit testing:
-
- import { ElysiaWebSocketRateLimitTestUtils } from "./elysia-examples";
-
- describe("WebSocket Rate Limiting", () => {
- it("should rate limit messages", async () => {
-     const { rateLimiter, mocks } = ElysiaWebSocketRateLimitTestUtils.createTestRateLimiter();
-     const mockWs = ElysiaWebSocketRateLimitTestUtils.createMockWebSocket();
-     const context = ElysiaWebSocketRateLimitTestUtils.createMockContext({
-       ws: mockWs,
-       message: { type: "test" }
-     });
-
-     const middleware = createElysiaWebSocketRateLimitMiddleware(
-       rateLimiter,
-       ElysiaWebSocketRateLimitPresets.strict()
-     );
-
-     await middleware(context, async () => {
-       // Test your message handling
-     });
-
-     expect(mocks.logger.debug).toHaveBeenCalled();
- });
- });
  \*/

/\*\*

- PRODUCTION DEPLOYMENT TIPS
- ==========================
-
- 1.  REDIS CONFIGURATION:
- - Use Redis cluster for high availability
- - Set appropriate TTL for rate limit keys (1-2 hours typical)
- - Use key prefixes to avoid collisions
-
- 2.  MONITORING:
- - Track rate limit exceeded events
- - Monitor Redis memory usage
- - Alert on unusual rate limiting patterns
-
- 3.  SCALING:
- - Rate limits are per-Redis instance
- - Consider user-based vs IP-based limits
- - Implement connection limits at load balancer level
-
- 4.  SECURITY:
- - Use authentication where possible
- - Implement progressive penalties for repeat offenders
- - Log suspicious patterns for analysis
-
- 5.  PERFORMANCE:
- - Redis pipeline operations minimize latency
- - Skip rate limiting for certain message types
- - Use connection pooling for Redis
    \*/

export const INTEGRATION_GUIDE = {
basicPattern: "createElysiaWebSocketRateLimitMiddleware -> apply in .ws() message handler",
keyFiles: [
"ElysiaWebSocketRateLimiter.ts - Main rate limiter service",
"elysia-examples.ts - Usage examples and test utilities"
],
compatibilityNote: "Works with Elysia's native .ws() WebSocket support, NOT standalone middleware",
nextSteps: [
"1. Import ElysiaWebSocketRateLimiter in your WebSocket service",
"2. Create middleware using createElysiaWebSocketRateLimitMiddleware()",
"3. Apply middleware in your .ws() message handler",
"4. Handle rate limit exceeded events gracefully",
"5. Add cleanup in connection close handler"
]
};
