/**
 * @file server.test.ts
 * @description Comprehensive unit tests for ElysiaServerBuilder and related server functionality
 */

import {
  AdvancedElysiaServerBuilder,
  createAdvancedElysiaServer,
  createProductionServer,
  createDevelopmentServer,
} from "../src/server";
import { IMetricsCollector } from "@libs/monitoring/src/MetricsCollector";
import { ServerConfig } from "../src/config";

// Global cleanup for all tests
afterAll(async () => {
  // Clear all timers
  jest.clearAllTimers();

  // Force garbage collection if available (in Node.js with --expose-gc)
  if (global.gc) {
    global.gc();
  }

  // Wait a bit for any pending async operations
  await new Promise((resolve) => setTimeout(resolve, 100));
});

describe("createAdvancedElysiaServer", () => {
  let mockMetricsCollector: jest.Mocked<IMetricsCollector>;
  let server: AdvancedElysiaServerBuilder;

  beforeEach(() => {
    mockMetricsCollector = {
      recordCounter: jest.fn(),
      recordTimer: jest.fn(),
      recordGauge: jest.fn(),
      recordHistogram: jest.fn(),
      recordSummary: jest.fn(),
      getMetrics: jest.fn(),
      recordApiRequest: jest.fn(),
      recordDatabaseOperation: jest.fn(),
      recordAuthOperation: jest.fn(),
      recordWebSocketActivity: jest.fn(),
      recordNodeMetrics: jest.fn(),
      measureEventLoopLag: jest.fn(),
    } as jest.Mocked<IMetricsCollector>;
  });

  afterEach(async () => {
    if (server) {
      await server.cleanup();
    }
  });

  it("should create server builder with config", () => {
    const config = { port: 8080 };
    server = createAdvancedElysiaServer(config, mockMetricsCollector);

    expect(server).toBeInstanceOf(AdvancedElysiaServerBuilder);
  });

  it("should create server builder with middleware config", () => {
    const config = { port: 8080 };
    const middlewareConfig = { http: { enabled: true } };

    server = createAdvancedElysiaServer(
      config,
      mockMetricsCollector,
      middlewareConfig
    );

    expect(server).toBeInstanceOf(AdvancedElysiaServerBuilder);
  });

  it("should handle undefined middleware config", () => {
    const config = { port: 8080 };
    server = createAdvancedElysiaServer(
      config,
      mockMetricsCollector,
      undefined
    );

    expect(server).toBeInstanceOf(AdvancedElysiaServerBuilder);
  });

  it("should create server with default config when none provided", () => {
    server = createAdvancedElysiaServer({}, mockMetricsCollector);

    expect(server).toBeInstanceOf(AdvancedElysiaServerBuilder);
  });
});

describe("createProductionServer", () => {
  let mockMetricsCollector: jest.Mocked<IMetricsCollector>;
  let server: AdvancedElysiaServerBuilder;

  beforeEach(() => {
    mockMetricsCollector = {
      recordCounter: jest.fn(),
      recordTimer: jest.fn(),
      recordGauge: jest.fn(),
      recordHistogram: jest.fn(),
      recordSummary: jest.fn(),
      getMetrics: jest.fn(),
      recordApiRequest: jest.fn(),
      recordDatabaseOperation: jest.fn(),
      recordAuthOperation: jest.fn(),
      recordWebSocketActivity: jest.fn(),
      recordNodeMetrics: jest.fn(),
      measureEventLoopLag: jest.fn(),
    } as jest.Mocked<IMetricsCollector>;
  });

  afterEach(async () => {
    if (server) {
      await server.cleanup();
    }
  });

  it("should create production server with config", () => {
    const config = { port: 8080, name: "ProductionServer" };
    server = createProductionServer(config, mockMetricsCollector);

    expect(server).toBeInstanceOf(AdvancedElysiaServerBuilder);
  });

  it("should create production server with default config", () => {
    server = createProductionServer({}, mockMetricsCollector);

    expect(server).toBeInstanceOf(AdvancedElysiaServerBuilder);
  });
});

describe("createDevelopmentServer", () => {
  let mockMetricsCollector: jest.Mocked<IMetricsCollector>;
  let server: AdvancedElysiaServerBuilder;

  beforeEach(() => {
    mockMetricsCollector = {
      recordCounter: jest.fn(),
      recordTimer: jest.fn(),
      recordGauge: jest.fn(),
      recordHistogram: jest.fn(),
      recordSummary: jest.fn(),
      getMetrics: jest.fn(),
      recordApiRequest: jest.fn(),
      recordDatabaseOperation: jest.fn(),
      recordAuthOperation: jest.fn(),
      recordWebSocketActivity: jest.fn(),
      recordNodeMetrics: jest.fn(),
      measureEventLoopLag: jest.fn(),
    } as jest.Mocked<IMetricsCollector>;
  });

  afterEach(async () => {
    if (server) {
      await server.cleanup();
    }
  });

  it("should create development server with config", () => {
    const config = { port: 3000, name: "DevServer" };
    server = createDevelopmentServer(config, mockMetricsCollector);

    expect(server).toBeInstanceOf(AdvancedElysiaServerBuilder);
  });

  it("should create development server with default config", () => {
    server = createDevelopmentServer({}, mockMetricsCollector);

    expect(server).toBeInstanceOf(AdvancedElysiaServerBuilder);
  });
});

describe("AdvancedElysiaServerBuilder", () => {
  let mockMetricsCollector: jest.Mocked<IMetricsCollector>;
  let config: ServerConfig;
  let builder: AdvancedElysiaServerBuilder;

  beforeEach(() => {
    mockMetricsCollector = {
      recordCounter: jest.fn(),
      recordTimer: jest.fn(),
      recordGauge: jest.fn(),
      recordHistogram: jest.fn(),
      recordSummary: jest.fn(),
      getMetrics: jest.fn(),
      recordApiRequest: jest.fn(),
      recordDatabaseOperation: jest.fn(),
      recordAuthOperation: jest.fn(),
      recordWebSocketActivity: jest.fn(),
      recordNodeMetrics: jest.fn(),
      measureEventLoopLag: jest.fn(),
    } as jest.Mocked<IMetricsCollector>;

    config = {
      port: 8080,
      name: "TestServer",
      version: "1.0.0",
    } as ServerConfig;
  });

  afterEach(async () => {
    if (builder) {
      await builder.cleanup();
    }
  });

  it("should create builder instance", () => {
    builder = new AdvancedElysiaServerBuilder(config, mockMetricsCollector);

    expect(builder).toBeInstanceOf(AdvancedElysiaServerBuilder);
  });

  it("should handle undefined config", () => {
    builder = new AdvancedElysiaServerBuilder(
      {} as Partial<ServerConfig>,
      mockMetricsCollector
    );

    expect(builder).toBeInstanceOf(AdvancedElysiaServerBuilder);
  });

  it("should handle empty config", () => {
    builder = new AdvancedElysiaServerBuilder({}, mockMetricsCollector);

    expect(builder).toBeInstanceOf(AdvancedElysiaServerBuilder);
  });
});
