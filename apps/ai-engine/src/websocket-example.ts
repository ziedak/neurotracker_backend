import { Elysia } from "elysia";
import { Logger } from "@libs/monitoring";
import {
  createWebSocketAuthMiddleware,
  createWebSocketRateLimitMiddleware,
  type WebSocketContext,
  type WebSocketAuthConfig,
  type WebSocketRateLimitConfig,
} from "@libs/middleware";

const logger = Logger.getInstance("AI-Engine-WebSocket");

/**
 * WebSocket Configuration for AI Engine
 * Production-grade settings for real-time AI model interactions
 */
const wsAuthConfig: WebSocketAuthConfig = {
  name: "ai-engine-ws-auth",
  enabled: true,
  requireAuth: true,
  jwtSecret:
    process.env.JWT_SECRET || "development-secret-change-in-production-PLEASE",
  apiKeyHeader: "x-api-key",
  closeOnAuthFailure: true,
  skipAuthenticationForTypes: ["ping", "heartbeat"],
  messagePermissions: {
    predict: ["ai:predict", "model:inference"],
    train: ["ai:train", "model:training"],
    model_status: ["ai:monitor", "model:status"],
    batch_predict: ["ai:batch", "model:batch_inference"],
  },
  messageRoles: {
    train: ["admin", "ai_engineer"],
    model_deploy: ["admin", "ai_engineer"],
    system_config: ["admin"],
  },
};

const wsRateLimitConfig: WebSocketRateLimitConfig = {
  name: "ai-engine-ws-ratelimit",
  enabled: true,
  maxConnections: 100, // Per user/IP
  maxMessagesPerMinute: 60, // 1 prediction per second max
  maxMessagesPerHour: 1000,
  keyGenerator: (context: WebSocketContext) => {
    // Use user ID if authenticated, otherwise fall back to IP
    return context.authenticated && context.userId
      ? `ai_user:${context.userId}`
      : `ai_ip:${context.metadata.clientIp}`;
  },
  onLimitExceeded: (context: WebSocketContext, limit: string) => {
    logger.warn("AI Engine WebSocket rate limit exceeded", {
      connectionId: context.connectionId,
      userId: context.userId,
      clientIp: context.metadata.clientIp,
      limit,
    });
  },
};

/**
 * WebSocket middleware chain for AI Engine
 */
const wsAuthMiddleware = createWebSocketAuthMiddleware(wsAuthConfig);
const wsRateLimitMiddleware =
  createWebSocketRateLimitMiddleware(wsRateLimitConfig);

/**
 * AI Engine WebSocket Handler with Middleware Integration
 */
export function createAIEngineWebSocket() {
  return new Elysia().ws("/ws/predict", {
    message: async (ws, message) => {
      // Create WebSocket context for middleware
      const context: WebSocketContext = {
        ws,
        connectionId: `ai_${Date.now()}_${Math.random()
          .toString(36)
          .substring(2, 9)}`,
        message: typeof message === "string" ? JSON.parse(message) : message,
        metadata: {
          connectedAt: new Date(),
          lastActivity: new Date(),
          messageCount: 1, // This should be tracked per connection
          clientIp: ws.data?.clientIp || "unknown",
          userAgent: ws.data?.userAgent,
          headers: ws.data?.headers || {},
          query: ws.data?.query || {},
        },
        authenticated: false,
        rooms: ["ai-predictions"],
      };

      try {
        // Apply middleware chain
        let middlewareIndex = 0;
        const middlewares = [wsAuthMiddleware, wsRateLimitMiddleware];

        const next = async (): Promise<void> => {
          if (middlewareIndex < middlewares.length) {
            const currentMiddleware = middlewares[middlewareIndex++];
            await currentMiddleware(context, next);
          } else {
            // All middleware passed, process the AI request
            await handleAIRequest(context);
          }
        };

        await next();
      } catch (error) {
        logger.error("WebSocket middleware error", error as Error, {
          connectionId: context.connectionId,
          messageType: context.message.type,
        });

        // Send error response
        ws.send(
          JSON.stringify({
            type: "error",
            error: {
              code: "MIDDLEWARE_ERROR",
              message: (error as Error).message,
              timestamp: new Date().toISOString(),
            },
          })
        );
      }
    },

    open: (ws) => {
      const connectionId = `ai_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;
      logger.info("AI Engine WebSocket connection opened", { connectionId });

      // Send welcome message with connection info
      ws.send(
        JSON.stringify({
          type: "connection_established",
          connectionId,
          timestamp: new Date().toISOString(),
          capabilities: ["predict", "model_status"],
          rateLimit: {
            maxMessagesPerMinute: wsRateLimitConfig.maxMessagesPerMinute,
            maxMessagesPerHour: wsRateLimitConfig.maxMessagesPerHour,
          },
        })
      );
    },

    close: (ws) => {
      logger.info("AI Engine WebSocket connection closed", {
        connectionId: ws.data?.connectionId,
      });
    },

    error: (ws, error) => {
      logger.error("AI Engine WebSocket error", error, {
        connectionId: ws.data?.connectionId,
      });
    },
  });
}

/**
 * Handle AI prediction requests after middleware validation
 */
async function handleAIRequest(context: WebSocketContext): Promise<void> {
  const { message, ws } = context;

  switch (message.type) {
    case "predict":
      await handlePredictRequest(context);
      break;

    case "batch_predict":
      await handleBatchPredictRequest(context);
      break;

    case "model_status":
      await handleModelStatusRequest(context);
      break;

    case "ping":
      ws.send(
        JSON.stringify({
          type: "pong",
          timestamp: new Date().toISOString(),
        })
      );
      break;

    default:
      ws.send(
        JSON.stringify({
          type: "error",
          error: {
            code: "UNKNOWN_MESSAGE_TYPE",
            message: `Unknown message type: ${message.type}`,
            supportedTypes: [
              "predict",
              "batch_predict",
              "model_status",
              "ping",
            ],
          },
        })
      );
  }
}

/**
 * Handle single prediction request
 */
async function handlePredictRequest(context: WebSocketContext): Promise<void> {
  const { message, ws, userId } = context;

  try {
    logger.info("Processing AI prediction request", {
      connectionId: context.connectionId,
      userId,
      inputSize: JSON.stringify(message.payload).length,
    });

    // Simulate AI model prediction (replace with actual model inference)
    const prediction = await simulateAIPrediction(message.payload);

    ws.send(
      JSON.stringify({
        type: "prediction_result",
        requestId: message.id || Date.now().toString(),
        result: prediction,
        timestamp: new Date().toISOString(),
        processingTime: Math.random() * 100 + 50, // Simulated processing time
        modelVersion: "1.0.0",
      })
    );
  } catch (error) {
    logger.error("AI prediction error", error as Error, {
      connectionId: context.connectionId,
      userId,
    });

    ws.send(
      JSON.stringify({
        type: "prediction_error",
        requestId: message.id,
        error: {
          code: "PREDICTION_FAILED",
          message: "Failed to process prediction request",
        },
      })
    );
  }
}

/**
 * Handle batch prediction request
 */
async function handleBatchPredictRequest(
  context: WebSocketContext
): Promise<void> {
  const { message, ws, userId } = context;

  try {
    const batchSize = message.payload.inputs?.length || 0;

    logger.info("Processing AI batch prediction request", {
      connectionId: context.connectionId,
      userId,
      batchSize,
    });

    // Process batch predictions (implement actual batch processing)
    const results = await simulateBatchAIPrediction(message.payload.inputs);

    ws.send(
      JSON.stringify({
        type: "batch_prediction_result",
        requestId: message.id || Date.now().toString(),
        results,
        batchSize: results.length,
        timestamp: new Date().toISOString(),
        totalProcessingTime: Math.random() * 500 + 200,
        modelVersion: "1.0.0",
      })
    );
  } catch (error) {
    logger.error("AI batch prediction error", error as Error, {
      connectionId: context.connectionId,
      userId,
    });

    ws.send(
      JSON.stringify({
        type: "batch_prediction_error",
        requestId: message.id,
        error: {
          code: "BATCH_PREDICTION_FAILED",
          message: "Failed to process batch prediction request",
        },
      })
    );
  }
}

/**
 * Handle model status request
 */
async function handleModelStatusRequest(
  context: WebSocketContext
): Promise<void> {
  const { ws } = context;

  // Return mock model status (implement actual status check)
  ws.send(
    JSON.stringify({
      type: "model_status_result",
      status: {
        modelVersion: "1.0.0",
        status: "healthy",
        lastUpdated: new Date().toISOString(),
        accuracy: 0.95,
        uptime: "99.9%",
        totalPredictions: 145678,
        averageLatency: 85.3,
      },
      timestamp: new Date().toISOString(),
    })
  );
}

/**
 * Simulate AI model prediction (replace with actual model)
 */
async function simulateAIPrediction(input: any): Promise<any> {
  // Simulate processing delay
  await new Promise((resolve) => setTimeout(resolve, Math.random() * 100));

  return {
    confidence: Math.random() * 0.3 + 0.7, // Random confidence between 0.7-1.0
    prediction: Math.random() > 0.5 ? "positive" : "negative",
    features: {
      feature1: Math.random(),
      feature2: Math.random(),
      feature3: Math.random(),
    },
  };
}

/**
 * Simulate batch AI prediction (replace with actual batch processing)
 */
async function simulateBatchAIPrediction(inputs: any[]): Promise<any[]> {
  // Simulate batch processing delay
  await new Promise((resolve) => setTimeout(resolve, inputs.length * 10));

  return inputs.map((input, index) => ({
    index,
    confidence: Math.random() * 0.3 + 0.7,
    prediction: Math.random() > 0.5 ? "positive" : "negative",
    processingTime: Math.random() * 50 + 25,
  }));
}
