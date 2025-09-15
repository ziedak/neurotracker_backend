/**
 * @fileoverview Comprehensive unit tests for base middleware classes
 * @description Tests BaseHttpMiddleware, BaseWebSocketMiddleware, and middleware utilities
 */

import {
  jest,
  describe,
  beforeEach,
  afterEach,
  it,
  expect,
} from "@jest/globals";
import { BaseHttpMiddleware } from "../../src/middleware/base/BaseMiddleware";
import { BaseWebSocketMiddleware } from "../../src/middleware/base/BaseWebSocketMiddleware";
import {
  MiddlewareContext,
  WebSocketContext,
} from "../../src/middleware/types";
import { IMetricsCollector } from "@libs/monitoring";

const mockMetricsCollector = {
  recordCounter: jest.fn(),
  recordTimer: jest.fn(),
  recordGauge: jest.fn(),
} as jest.Mocked<IMetricsCollector>;

describe("Base Middleware Classes", () => {
  describe("BaseHttpMiddleware", () => {
    let baseMiddleware: BaseHttpMiddleware;
    let mockContext: MiddlewareContext;
    let nextFunction: jest.MockedFunction<() => Promise<void>>;

    beforeEach(() => {
      jest.clearAllMocks();

      // Create a concrete implementation for testing
      class TestHttpMiddleware extends BaseHttpMiddleware {
        async execute(
          context: MiddlewareContext,
          next: () => Promise<void>
        ): Promise<void> {
          this.beforeProcess(context);
          await next();
          this.afterProcess(context);
        }

        protected async handleRequest(
          context: MiddlewareContext
        ): Promise<void> {
          // Test implementation
        }
      }

      baseMiddleware = new TestHttpMiddleware(mockMetricsCollector, {
        name: "test-base-http",
        enabled: true,
        priority: 50,
      });

      mockContext = {
        requestId: "test-request-123",
        request: {
          method: "GET",
          url: "/api/test",
          headers: { "user-agent": "test-agent" },
          body: { test: "data" },
          query: {},
          params: {},
          ip: "192.168.1.1",
        },
        response: {
          status: 200,
          headers: { "content-type": "application/json" },
          body: { success: true },
        },
        set: {
          status: 200,
          headers: { "content-type": "application/json" },
          body: { success: true },
        },
        user: undefined,
        session: undefined,
        validated: {},
        path: "/api/test",
      };

      nextFunction = jest.fn().mockResolvedValue(undefined);
    });

    afterEach(() => {
      jest.clearAllTimers();
    });

    describe("Initialization", () => {
      it("should initialize with default configuration", () => {
        const defaultMiddleware = new (class extends BaseHttpMiddleware {
          protected async handleRequest(): Promise<void> {}
        })(mockMetricsCollector, {});

        expect(defaultMiddleware).toBeDefined();
        expect(defaultMiddleware["config"].name).toBe("base-http");
        expect(defaultMiddleware["config"].enabled).toBe(true);
        expect(defaultMiddleware["config"].priority).toBe(0);
      });

      it("should initialize with custom configuration", () => {
        expect(baseMiddleware["config"].name).toBe("test-base-http");
        expect(baseMiddleware["config"].enabled).toBe(true);
        expect(baseMiddleware["config"].priority).toBe(50);
      });

      it("should validate configuration on initialization", () => {
        expect(() => {
          new (class extends BaseHttpMiddleware {
            protected async handleRequest(): Promise<void> {}
          })(mockMetricsCollector, {
            priority: -1,
          });
        }).toThrow("Base HTTP priority must be a non-negative integer");
      });
    });

    describe("Execution Flow", () => {
      it("should execute middleware when enabled", async () => {
        const beforeProcessSpy = jest.spyOn(
          baseMiddleware as any,
          "beforeProcess"
        );
        const afterProcessSpy = jest.spyOn(
          baseMiddleware as any,
          "afterProcess"
        );

        await baseMiddleware["execute"](mockContext, nextFunction);

        expect(beforeProcessSpy).toHaveBeenCalledWith(mockContext);
        expect(nextFunction).toHaveBeenCalled();
        expect(afterProcessSpy).toHaveBeenCalledWith(mockContext);
      });

      it("should skip execution when disabled", async () => {
        const disabledMiddleware = new (class extends BaseHttpMiddleware {
          async execute(
            context: MiddlewareContext,
            next: () => Promise<void>
          ): Promise<void> {
            this.beforeProcess(context);
            await next();
            this.afterProcess(context);
          }
          protected async handleRequest(): Promise<void> {}
        })(mockMetricsCollector, { enabled: false });

        const beforeProcessSpy = jest.spyOn(
          disabledMiddleware as any,
          "beforeProcess"
        );
        const afterProcessSpy = jest.spyOn(
          disabledMiddleware as any,
          "afterProcess"
        );

        await disabledMiddleware["execute"](mockContext, nextFunction);

        expect(beforeProcessSpy).not.toHaveBeenCalled();
        expect(nextFunction).toHaveBeenCalled();
        expect(afterProcessSpy).not.toHaveBeenCalled();
      });

      it("should handle execution errors", async () => {
        const errorMiddleware = new (class extends BaseHttpMiddleware {
          async execute(
            context: MiddlewareContext,
            next: () => Promise<void>
          ): Promise<void> {
            this.beforeProcess(context);
            throw new Error("Test error");
          }
          protected async handleRequest(): Promise<void> {}
        })(mockMetricsCollector, {});

        await expect(
          errorMiddleware["execute"](mockContext, nextFunction)
        ).rejects.toThrow("Test error");
      });
    });

    describe("Lifecycle Methods", () => {
      it("should call beforeProcess hook", async () => {
        const beforeProcessSpy = jest.spyOn(
          baseMiddleware as any,
          "beforeProcess"
        );

        await baseMiddleware["execute"](mockContext, nextFunction);

        expect(beforeProcessSpy).toHaveBeenCalledWith(mockContext);
      });

      it("should call afterProcess hook", async () => {
        const afterProcessSpy = jest.spyOn(
          baseMiddleware as any,
          "afterProcess"
        );

        await baseMiddleware["execute"](mockContext, nextFunction);

        expect(afterProcessSpy).toHaveBeenCalledWith(mockContext);
      });

      it("should handle beforeProcess errors", async () => {
        const errorMiddleware = new (class extends BaseHttpMiddleware {
          async execute(
            context: MiddlewareContext,
            next: () => Promise<void>
          ): Promise<void> {
            this.beforeProcess(context);
            await next();
            this.afterProcess(context);
          }
          protected beforeProcess(_context: MiddlewareContext): void {
            throw new Error("Before process error");
          }
          protected async handleRequest(): Promise<void> {}
        })(mockMetricsCollector, {});

        await expect(
          errorMiddleware["execute"](mockContext, nextFunction)
        ).rejects.toThrow("Before process error");
      });

      it("should handle afterProcess errors", async () => {
        const errorMiddleware = new (class extends BaseHttpMiddleware {
          async execute(
            context: MiddlewareContext,
            next: () => Promise<void>
          ): Promise<void> {
            this.beforeProcess(context);
            await next();
            this.afterProcess(context);
          }
          protected afterProcess(_context: MiddlewareContext): void {
            throw new Error("After process error");
          }
          protected async handleRequest(): Promise<void> {}
        })(mockMetricsCollector, {});

        await expect(
          errorMiddleware["execute"](mockContext, nextFunction)
        ).rejects.toThrow("After process error");
      });
    });

    describe("Configuration Management", () => {
      it("should get configuration", () => {
        const config = baseMiddleware.getConfig();

        expect(config.name).toBe("test-base-http");
        expect(config.enabled).toBe(true);
        expect(config.priority).toBe(50);
      });

      it("should update configuration", () => {
        baseMiddleware.updateConfig({ enabled: false, priority: 75 });

        expect(baseMiddleware["config"].enabled).toBe(false);
        expect(baseMiddleware["config"].priority).toBe(75);
      });

      it("should validate configuration updates", () => {
        expect(() => {
          baseMiddleware.updateConfig({ priority: -1 });
        }).toThrow("Base HTTP priority must be a non-negative integer");
      });
    });

    describe("Performance Monitoring", () => {
      it("should record execution metrics", async () => {
        await baseMiddleware["execute"](mockContext, nextFunction);

        expect(mockMetricsCollector.recordTimer).toHaveBeenCalledWith(
          "base_http_execution_time",
          expect.any(Number),
          expect.any(Object)
        );
      });

      it("should record error metrics", async () => {
        const errorMiddleware = new (class extends BaseHttpMiddleware {
          async execute(
            context: MiddlewareContext,
            next: () => Promise<void>
          ): Promise<void> {
            await this.beforeExecute(context);
            throw new Error("Test error");
          }
          protected async handleRequest(): Promise<void> {}
        })(mockMetricsCollector, {});

        await expect(
          errorMiddleware["execute"](mockContext, nextFunction)
        ).rejects.toThrow();

        expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
          "base_http_error",
          1,
          expect.any(Object)
        );
      });
    });
  });

  describe("BaseWebSocketMiddleware", () => {
    let baseWSMiddleware: BaseWebSocketMiddleware;
    let mockWSContext: WebSocketContext;
    let nextFunction: jest.MockedFunction<() => Promise<void>>;

    beforeEach(() => {
      jest.clearAllMocks();

      // Create a concrete implementation for testing
      class TestWebSocketMiddleware extends BaseWebSocketMiddleware {
        async execute(
          context: WebSocketContext,
          next: () => Promise<void>
        ): Promise<void> {
          await this.beforeProcessing(context);
          await next();
          await this.afterProcessing(context);
        }

        // Add lifecycle methods for this test class
        protected async beforeProcessing(
          context: WebSocketContext
        ): Promise<void> {
          // Simulate before processing logic
        }

        protected async afterProcessing(
          context: WebSocketContext
        ): Promise<void> {
          // Simulate after processing logic
        }

        protected async handleWebSocketMessage(
          context: WebSocketContext
        ): Promise<void> {
          // Test implementation
        }
      }

      baseWSMiddleware = new TestWebSocketMiddleware(mockMetricsCollector, {
        name: "test-base-ws",
        enabled: true,
        priority: 30,
      });

      mockWSContext = {
        requestId: "ws-test-request-123",
        connectionId: "ws-conn-456",
        request: {
          method: "GET",
          url: "/ws/test",
          headers: {
            upgrade: "websocket",
            connection: "upgrade",
            "sec-websocket-key": "test-key",
          },
          query: {},
          params: {},
          ip: "192.168.1.1",
        },
        response: {
          status: 101,
          headers: { upgrade: "websocket" },
        },
        set: {
          status: 101,
          headers: {
            upgrade: "websocket",
            connection: "upgrade",
          },
        },
        user: undefined,
        session: undefined,
        validated: {},
        path: "/ws/test",
        websocket: {
          send: jest.fn(),
          close: jest.fn(),
          ping: jest.fn(),
          pong: jest.fn(),
          data: {},
          isAlive: true,
          readyState: 1,
        },
        message: undefined,
        isBinary: false,
      };

      nextFunction = jest.fn().mockResolvedValue(undefined);
    });

    afterEach(() => {
      jest.clearAllTimers();
    });

    describe("Initialization", () => {
      it("should initialize with default configuration", () => {
        const defaultMiddleware = new (class extends BaseWebSocketMiddleware {
          protected async handleWebSocketMessage(): Promise<void> {}
        })(mockMetricsCollector, {});

        expect(defaultMiddleware).toBeDefined();
        expect(defaultMiddleware["config"].name).toBe("base-websocket");
        expect(defaultMiddleware["config"].enabled).toBe(true);
        expect(defaultMiddleware["config"].priority).toBe(0);
      });

      it("should initialize with custom configuration", () => {
        expect(baseWSMiddleware["config"].name).toBe("test-base-ws");
        expect(baseWSMiddleware["config"].enabled).toBe(true);
        expect(baseWSMiddleware["config"].priority).toBe(30);
      });

      it("should validate configuration on initialization", () => {
        expect(() => {
          new (class extends BaseWebSocketMiddleware {
            protected async handleWebSocketMessage(): Promise<void> {}
          })(mockMetricsCollector, {
            priority: -1,
          });
        }).toThrow("Base WebSocket priority must be a non-negative integer");
      });
    });

    describe("Execution Flow", () => {
      it("should execute middleware when enabled", async () => {
        const beforeProcessingSpy = jest.spyOn(
          baseWSMiddleware as any,
          "beforeProcessing"
        );
        const afterProcessingSpy = jest.spyOn(
          baseWSMiddleware as any,
          "afterProcessing"
        );

        await baseWSMiddleware["execute"](mockWSContext, nextFunction);

        expect(beforeProcessingSpy).toHaveBeenCalledWith(mockWSContext);
        expect(nextFunction).toHaveBeenCalled();
        expect(afterProcessingSpy).toHaveBeenCalledWith(mockWSContext);
      });

      it("should skip execution when disabled", async () => {
        const disabledMiddleware = new (class extends BaseWebSocketMiddleware {
          async execute(
            context: WebSocketContext,
            next: () => Promise<void>
          ): Promise<void> {
            await this.beforeExecute(context);
            await next();
            await this.afterExecute(context);
          }
          protected async handleWebSocketMessage(): Promise<void> {}
        })(mockMetricsCollector, { enabled: false });

        const beforeProcessingSpy = jest.spyOn(
          disabledMiddleware as any,
          "beforeProcessing"
        );
        const afterProcessingSpy = jest.spyOn(
          disabledMiddleware as any,
          "afterProcessing"
        );

        await disabledMiddleware["execute"](mockWSContext, nextFunction);

        expect(beforeProcessingSpy).not.toHaveBeenCalled();
        expect(nextFunction).toHaveBeenCalled();
        expect(afterProcessingSpy).not.toHaveBeenCalled();
      });

      it("should handle execution errors", async () => {
        const errorMiddleware = new (class extends BaseWebSocketMiddleware {
          async execute(
            context: WebSocketContext,
            next: () => Promise<void>
          ): Promise<void> {
            await this.beforeProcessing(context);
            throw new Error("WebSocket test error");
          }
          protected async beforeProcessing(
            _context: WebSocketContext
          ): Promise<void> {
            // Test implementation
          }
          protected async handleWebSocketMessage(): Promise<void> {}
        })(mockMetricsCollector, {});

        await expect(
          errorMiddleware["execute"](mockWSContext, nextFunction)
        ).rejects.toThrow("WebSocket test error");
      });
    });

    describe("Lifecycle Methods", () => {
      it("should call beforeProcessing hook", async () => {
        const beforeProcessingSpy = jest.spyOn(
          baseWSMiddleware as any,
          "beforeProcessing"
        );

        await baseWSMiddleware["execute"](mockWSContext, nextFunction);

        expect(beforeProcessingSpy).toHaveBeenCalledWith(mockWSContext);
      });

      it("should call afterProcessing hook", async () => {
        const afterProcessingSpy = jest.spyOn(
          baseWSMiddleware as any,
          "afterProcessing"
        );

        await baseWSMiddleware["execute"](mockWSContext, nextFunction);

        expect(afterProcessingSpy).toHaveBeenCalledWith(mockWSContext);
      });

      it("should handle beforeProcessing errors", async () => {
        const errorMiddleware = new (class extends BaseWebSocketMiddleware {
          async execute(
            context: WebSocketContext,
            next: () => Promise<void>
          ): Promise<void> {
            await this.beforeProcessing(context);
            await next();
            await this.afterProcessing(context);
          }
          protected async beforeProcessing(
            _context: WebSocketContext
          ): Promise<void> {
            throw new Error("WebSocket before processing error");
          }
          protected async afterProcessing(
            _context: WebSocketContext
          ): Promise<void> {
            // Test implementation
          }
          protected async handleWebSocketMessage(): Promise<void> {}
        })(mockMetricsCollector, {
          name: "test-ws-error",
          enabled: true,
          priority: 0,
        });

        await expect(
          errorMiddleware["execute"](mockWSContext, nextFunction)
        ).rejects.toThrow("WebSocket before processing error");
      });

      it("should handle afterProcessing errors", async () => {
        const errorMiddleware = new (class extends BaseWebSocketMiddleware {
          async execute(
            context: WebSocketContext,
            next: () => Promise<void>
          ): Promise<void> {
            await this.beforeProcessing(context);
            await next();
            await this.afterProcessing(context);
          }
          protected async beforeProcessing(
            _context: WebSocketContext
          ): Promise<void> {
            // Test implementation
          }
          protected async afterProcessing(
            _context: WebSocketContext
          ): Promise<void> {
            throw new Error("WebSocket after processing error");
          }
          protected async handleWebSocketMessage(): Promise<void> {}
        })(mockMetricsCollector, {
          name: "test-ws-after-error",
          enabled: true,
          priority: 0,
        });

        await expect(
          errorMiddleware["execute"](mockWSContext, nextFunction)
        ).rejects.toThrow("WebSocket after processing error");
      });
    });

    describe("Configuration Management", () => {
      it("should get configuration", () => {
        const config = baseWSMiddleware.getConfig();

        expect(config.name).toBe("test-base-ws");
        expect(config.enabled).toBe(true);
        expect(config.priority).toBe(30);
      });

      it("should update configuration", () => {
        // Configuration is immutable - use withConfig for new instances
        const updatedMiddleware = baseWSMiddleware.withConfig({
          enabled: false,
          priority: 45,
        });

        expect(updatedMiddleware.getConfig().enabled).toBe(false);
        expect(updatedMiddleware.getConfig().priority).toBe(45);
      });

      it("should validate configuration updates", () => {
        // BaseWebSocketMiddleware validates config in constructor, not in updateConfig
        expect(() => {
          new (class extends BaseWebSocketMiddleware {
            async execute(
              context: WebSocketContext,
              next: () => Promise<void>
            ): Promise<void> {
              await this.beforeProcessing(context);
              await next();
              await this.afterProcessing(context);
            }
            protected async beforeProcessing(
              _context: WebSocketContext
            ): Promise<void> {}
            protected async afterProcessing(
              _context: WebSocketContext
            ): Promise<void> {}
            protected async handleWebSocketMessage(): Promise<void> {}
          })(mockMetricsCollector, {
            name: "test-ws",
            enabled: true,
            priority: -1,
          });
        }).toThrow("Priority must be non-negative");
      });
    });

    describe("Performance Monitoring", () => {
      it("should record execution metrics", async () => {
        await baseWSMiddleware["execute"](mockWSContext, nextFunction);

        expect(mockMetricsCollector.recordTimer).toHaveBeenCalledWith(
          "base_websocket_execution_time",
          expect.any(Number),
          expect.any(Object)
        );
      });

      it("should record error metrics", async () => {
        const errorMiddleware = new (class extends BaseWebSocketMiddleware {
          async execute(
            context: WebSocketContext,
            next: () => Promise<void>
          ): Promise<void> {
            await this.beforeExecute(context);
            throw new Error("WebSocket test error");
          }
          protected async handleWebSocketMessage(): Promise<void> {}
        })(mockMetricsCollector, {});

        await expect(
          errorMiddleware["execute"](mockWSContext, nextFunction)
        ).rejects.toThrow();

        expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
          "base_websocket_error",
          1,
          expect.any(Object)
        );
      });
    });

    describe("WebSocket-Specific Features", () => {
      it("should handle WebSocket connection lifecycle", async () => {
        await baseWSMiddleware["execute"](mockWSContext, nextFunction);

        expect(mockWSContext.websocket).toBeDefined();
        expect(mockWSContext.connectionId).toBe("ws-conn-456");
      });

      it("should handle message processing", async () => {
        mockWSContext.message = "test message";

        await baseWSMiddleware["execute"](mockWSContext, nextFunction);

        expect(mockWSContext.message).toBe("test message");
        expect(mockWSContext.isBinary).toBe(false);
      });

      it("should handle binary messages", async () => {
        mockWSContext.message = Buffer.from("binary data");
        mockWSContext.isBinary = true;

        await baseWSMiddleware["execute"](mockWSContext, nextFunction);

        expect(mockWSContext.isBinary).toBe(true);
      });
    });
  });

  describe("Middleware Utilities", () => {
    describe("Configuration Validation", () => {
      it("should validate HTTP middleware configuration", () => {
        const validConfig = {
          name: "test",
          enabled: true,
          priority: 50,
        };

        expect(() => {
          BaseHttpMiddleware.validateConfig(validConfig);
        }).not.toThrow();
      });

      it("should reject invalid HTTP middleware configuration", () => {
        const invalidConfig = {
          name: "",
          enabled: true,
          priority: -1,
        };

        expect(() => {
          BaseHttpMiddleware.validateConfig(invalidConfig);
        }).toThrow();
      });

      it("should validate WebSocket middleware configuration", () => {
        const validConfig = {
          name: "test-ws",
          enabled: true,
          priority: 30,
        };

        expect(() => {
          BaseWebSocketMiddleware.validateConfig(validConfig);
        }).not.toThrow();
      });

      it("should reject invalid WebSocket middleware configuration", () => {
        const invalidConfig = {
          name: "",
          enabled: true,
          priority: -1,
        };

        expect(() => {
          BaseWebSocketMiddleware.validateConfig(invalidConfig);
        }).toThrow();
      });
    });

    describe("Priority Management", () => {
      it("should sort middleware by priority", () => {
        const middlewares = [
          new (class extends BaseHttpMiddleware {
            protected async handleRequest(): Promise<void> {}
          })(mockMetricsCollector, { name: "low", priority: 100 }),
          new (class extends BaseHttpMiddleware {
            protected async handleRequest(): Promise<void> {}
          })(mockMetricsCollector, { name: "high", priority: 10 }),
          new (class extends BaseHttpMiddleware {
            protected async handleRequest(): Promise<void> {}
          })(mockMetricsCollector, { name: "medium", priority: 50 }),
        ];

        const sorted = BaseHttpMiddleware.sortByPriority(middlewares);

        expect(sorted[0]["config"].name).toBe("high");
        expect(sorted[1]["config"].name).toBe("medium");
        expect(sorted[2]["config"].name).toBe("low");
      });

      it("should handle middleware with same priority", () => {
        const middlewares = [
          new (class extends BaseHttpMiddleware {
            protected async handleRequest(): Promise<void> {}
          })(mockMetricsCollector, { name: "first", priority: 50 }),
          new (class extends BaseHttpMiddleware {
            protected async handleRequest(): Promise<void> {}
          })(mockMetricsCollector, { name: "second", priority: 50 }),
        ];

        const sorted = BaseHttpMiddleware.sortByPriority(middlewares);

        expect(sorted.length).toBe(2);
        expect(sorted[0]["config"].priority).toBe(50);
        expect(sorted[1]["config"].priority).toBe(50);
      });
    });

    describe("Middleware Factory", () => {
      it("should create HTTP middleware instances", () => {
        const config = {
          name: "factory-test",
          enabled: true,
          priority: 25,
        };

        const middleware = BaseHttpMiddleware.create(
          mockMetricsCollector,
          config,
          class extends BaseHttpMiddleware {
            protected async handleRequest(): Promise<void> {}
          }
        );

        expect(middleware).toBeDefined();
        expect(middleware["config"].name).toBe("factory-test");
        expect(middleware["config"].priority).toBe(25);
      });

      it("should create WebSocket middleware instances", () => {
        const config = {
          name: "factory-ws-test",
          enabled: true,
          priority: 35,
        };

        const middleware = BaseWebSocketMiddleware.create(
          mockMetricsCollector,
          config,
          class extends BaseWebSocketMiddleware {
            protected async handleWebSocketMessage(): Promise<void> {}
          }
        );

        expect(middleware).toBeDefined();
        expect(middleware["config"].name).toBe("factory-ws-test");
        expect(middleware["config"].priority).toBe(35);
      });
    });

    describe("Error Handling", () => {
      it("should handle middleware execution errors gracefully", async () => {
        const errorMiddleware = new (class extends BaseHttpMiddleware {
          async execute(
            context: MiddlewareContext,
            next: () => Promise<void>
          ): Promise<void> {
            try {
              await this.beforeExecute(context);
              await next();
              await this.afterExecute(context);
            } catch (error) {
              await this.handleError(error, context);
            }
          }
          protected async handleRequest(): Promise<void> {}
          protected async handleError(
            error: Error,
            context: MiddlewareContext
          ): Promise<void> {
            context.set.status = 500;
            context.set.body = { error: "Internal server error" };
          }
        })(mockMetricsCollector, {});

        nextFunction.mockRejectedValue(new Error("Test error"));

        await errorMiddleware["execute"](mockContext, nextFunction);

        expect(mockContext.set.status).toBe(500);
        expect(mockContext.set.body).toEqual({
          error: "Internal server error",
        });
      });

      it("should handle WebSocket middleware execution errors gracefully", async () => {
        const errorMiddleware = new (class extends BaseWebSocketMiddleware {
          async execute(
            context: WebSocketContext,
            next: () => Promise<void>
          ): Promise<void> {
            try {
              await this.beforeExecute(context);
              await next();
              await this.afterExecute(context);
            } catch (error) {
              await this.handleError(error, context);
            }
          }
          protected async handleWebSocketMessage(): Promise<void> {}
          protected async handleError(
            error: Error,
            context: WebSocketContext
          ): Promise<void> {
            context.websocket.close(4000, "Internal error");
          }
        })(mockMetricsCollector, {});

        nextFunction.mockRejectedValue(new Error("WebSocket test error"));

        await errorMiddleware["execute"](mockWSContext, nextFunction);

        expect(mockWSContext.websocket.close).toHaveBeenCalledWith(
          4000,
          "Internal error"
        );
      });
    });
  });
});
