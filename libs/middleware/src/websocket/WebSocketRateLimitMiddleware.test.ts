/**
 * Integration test for WebSocket Rate Limit Middleware
 * Demonstrates the updated middleware with dependency injection
 */

import { WebSocketRateLimitMiddleware } from "./WebSocketRateLimitMiddleware";
import { WebSocketRateLimitTestUtils } from "./examples";
import type { WebSocketContext } from "../types";

describe("WebSocketRateLimitMiddleware Integration", () => {
  let rateLimiter: WebSocketRateLimitMiddleware;
  let mocks: any;

  beforeEach(() => {
    const testSetup = WebSocketRateLimitTestUtils.createTestRateLimiter();
    rateLimiter = testSetup.rateLimiter;
    mocks = testSetup.mocks;
  });

  describe("Dependency Injection Pattern", () => {
    it("should initialize with injected dependencies", () => {
      expect(rateLimiter).toBeInstanceOf(WebSocketRateLimitMiddleware);
      expect(mocks.redisClient.getRedis).toHaveBeenCalled();
    });

    it("should use injected logger for debug messages", async () => {
      const context = WebSocketRateLimitTestUtils.createMockContext();

      await rateLimiter.execute(context, async () => {
        // Mock next function
      });

      expect(mocks.logger.debug).toHaveBeenCalled();
    });

    it("should use injected metrics collector", async () => {
      const context = WebSocketRateLimitTestUtils.createMockContext();

      await rateLimiter.execute(context, async () => {
        // Mock next function
      });

      expect(mocks.metrics.recordTimer).toHaveBeenCalled();
    });
  });

  describe("Factory Methods", () => {
    it("should create chat rate limiter with correct config", () => {
      const chatLimiter = WebSocketRateLimitMiddleware.createTyped(
        "chat",
        mocks.logger,
        mocks.metrics,
        mocks.redisClient
      );

      expect(chatLimiter).toBeInstanceOf(WebSocketRateLimitMiddleware);
    });

    it("should create game rate limiter with high frequency limits", () => {
      const gameLimiter = WebSocketRateLimitMiddleware.createTyped(
        "game",
        mocks.logger,
        mocks.metrics,
        mocks.redisClient,
        { maxMessagesPerMinute: 300 }
      );

      expect(gameLimiter).toBeInstanceOf(WebSocketRateLimitMiddleware);
    });
  });

  describe("Rate Limiting Logic", () => {
    it("should allow messages under rate limit", async () => {
      const context = WebSocketRateLimitTestUtils.createMockContext();
      let nextCalled = false;

      // Mock Redis to return low count
      mocks.redisClient
        .getRedis()
        .pipeline()
        .exec.mockResolvedValue([
          [null, "1"], // current window count
          [null, "0"], // previous window count
        ]);

      await rateLimiter.execute(context, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
    });

    it("should block messages over rate limit", async () => {
      const context = WebSocketRateLimitTestUtils.createMockContext();
      let nextCalled = false;

      // Mock Redis to return high count (over limit)
      mocks.redisClient
        .getRedis()
        .pipeline()
        .exec.mockResolvedValue([
          [null, "70"], // current window count (over 60 limit)
          [null, "0"], // previous window count
        ]);

      await rateLimiter.execute(context, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(false);
      expect(context.ws.send).toHaveBeenCalledWith(
        expect.stringContaining("rate_limit_error")
      );
    });
  });

  describe("Connection Management", () => {
    it("should cleanup connection tracking", async () => {
      const connectionId = "test-connection-123";
      const userId = "user-456";

      await rateLimiter.cleanupConnection(connectionId, userId, "127.0.0.1");

      expect(mocks.logger.debug).toHaveBeenCalledWith(
        "Connection cleanup completed",
        expect.objectContaining({ connectionId, userId })
      );
    });
  });

  describe("Error Handling", () => {
    it("should handle Redis errors gracefully", async () => {
      const context = WebSocketRateLimitTestUtils.createMockContext();

      // Mock Redis to throw error
      mocks.redisClient
        .getRedis()
        .pipeline()
        .exec.mockRejectedValue(new Error("Redis connection failed"));

      let nextCalled = false;
      await rateLimiter.execute(context, async () => {
        nextCalled = true;
      });

      // Should fail open (allow request on error)
      expect(nextCalled).toBe(true);
      expect(mocks.logger.error).toHaveBeenCalled();
    });
  });

  describe("Custom Key Generation", () => {
    it("should use custom key generator when provided", async () => {
      const customRateLimiter = new WebSocketRateLimitMiddleware(
        mocks.logger,
        mocks.metrics,
        mocks.redisClient,
        {
          name: "custom-test",
          enabled: true,
          priority: 100,
          maxMessagesPerMinute: 60,
          keyGenerator: (context: WebSocketContext) =>
            `custom:${context.connectionId}`,
        }
      );

      const context = WebSocketRateLimitTestUtils.createMockContext({
        connectionId: "test-123",
      });

      mocks.redisClient
        .getRedis()
        .pipeline()
        .exec.mockResolvedValue([
          [null, "1"],
          [null, "0"],
        ]);

      await customRateLimiter.execute(context, async () => {});

      // Verify the custom key was used (check Redis calls)
      const pipeline = mocks.redisClient.getRedis().pipeline();
      expect(pipeline.get).toHaveBeenCalledWith(
        expect.stringContaining("custom:test-123")
      );
    });
  });

  describe("Message Type Filtering", () => {
    it("should skip rate limiting for configured message types", async () => {
      const context = WebSocketRateLimitTestUtils.createMockContext({
        message: { type: "heartbeat", payload: {} },
      });

      // Since heartbeat is in skipMessageTypes by default, next should be called directly
      let nextCalled = false;
      await rateLimiter.execute(context, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
      // Redis shouldn't be called for skipped message types
      expect(mocks.redisClient.getRedis().pipeline).not.toHaveBeenCalled();
    });
  });

  describe("Performance", () => {
    it("should record timing metrics", async () => {
      const context = WebSocketRateLimitTestUtils.createMockContext();

      mocks.redisClient
        .getRedis()
        .pipeline()
        .exec.mockResolvedValue([
          [null, "1"],
          [null, "0"],
        ]);

      await rateLimiter.execute(context, async () => {});

      expect(mocks.metrics.recordTimer).toHaveBeenCalledWith(
        "ws_rate_limit_duration",
        expect.any(Number),
        expect.any(Object)
      );
    });

    it("should record rate limit metrics", async () => {
      const context = WebSocketRateLimitTestUtils.createMockContext();

      mocks.redisClient
        .getRedis()
        .pipeline()
        .exec.mockResolvedValue([
          [null, "1"],
          [null, "0"],
        ]);

      await rateLimiter.execute(context, async () => {});

      expect(mocks.metrics.recordCounter).toHaveBeenCalledWith(
        "ws_rate_limit_allowed",
        1,
        expect.any(Object)
      );
    });
  });
});

describe("WebSocketRateLimitMiddleware Factory Integration", () => {
  let mocks: any;

  beforeEach(() => {
    const testSetup = WebSocketRateLimitTestUtils.createTestRateLimiter();
    mocks = testSetup.mocks;
  });

  it("should create different rate limiters for different application types", () => {
    const appTypes = [
      "general",
      "strict",
      "game",
      "chat",
      "api",
      "data-stream",
    ] as const;

    appTypes.forEach((type) => {
      const rateLimiter = WebSocketRateLimitMiddleware.createTyped(
        type,
        mocks.logger,
        mocks.metrics,
        mocks.redisClient
      );

      expect(rateLimiter).toBeInstanceOf(WebSocketRateLimitMiddleware);
    });
  });

  it("should merge custom config with predefined configs", () => {
    const customConfig = { maxMessagesPerMinute: 999 };

    const rateLimiter = WebSocketRateLimitMiddleware.createTyped(
      "chat",
      mocks.logger,
      mocks.metrics,
      mocks.redisClient,
      customConfig
    );

    expect(rateLimiter).toBeInstanceOf(WebSocketRateLimitMiddleware);
  });
});

describe("Backward Compatibility", () => {
  let mocks: any;

  beforeEach(() => {
    const testSetup = WebSocketRateLimitTestUtils.createTestRateLimiter();
    mocks = testSetup.mocks;
  });

  it("should maintain the same middleware interface", async () => {
    const rateLimiter = WebSocketRateLimitMiddleware.createTyped(
      "general",
      mocks.logger,
      mocks.metrics,
      mocks.redisClient
    );

    const middlewareFunction = rateLimiter.middleware();
    const context = WebSocketRateLimitTestUtils.createMockContext();

    mocks.redisClient
      .getRedis()
      .pipeline()
      .exec.mockResolvedValue([
        [null, "1"],
        [null, "0"],
      ]);

    let nextCalled = false;
    await middlewareFunction(context, async () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
  });

  it("should work with the static create method", () => {
    const config = {
      name: "test-rate-limiter",
      enabled: true,
      priority: 100,
      maxMessagesPerMinute: 60,
    };

    const middlewareFunction = WebSocketRateLimitMiddleware.create(
      config,
      mocks.logger,
      mocks.metrics,
      mocks.redisClient
    );

    expect(typeof middlewareFunction).toBe("function");
  });
});
