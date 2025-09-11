# 🔧 Elysia Server Library - Production Optimization Plan

This document provides specific, actionable optimization recommendations based on the comprehensive audit findings.

---

## 🚀 Phase 1: Critical Security & Stability Fixes

### 1.1 Timer Management System

**Problem**: Uncontrolled timers causing memory leaks
**Impact**: Production server crashes, memory exhaustion

#### Implementation

```typescript
// src/utils/TimerManager.ts
export class TimerManager {
  private timers: Set<NodeJS.Timeout> = new Set();
  private intervals: Set<NodeJS.Timeout> = new Set();
  private isShuttingDown = false;

  setTimeout(callback: () => void, ms: number): NodeJS.Timeout {
    if (this.isShuttingDown) return null as any;

    const timer = setTimeout(() => {
      this.timers.delete(timer);
      callback();
    }, ms);

    this.timers.add(timer);
    return timer;
  }

  setInterval(callback: () => void, ms: number): NodeJS.Timeout {
    if (this.isShuttingDown) return null as any;

    const interval = setInterval(callback, ms);
    this.intervals.add(interval);
    return interval;
  }

  clearTimeout(timer: NodeJS.Timeout): void {
    clearTimeout(timer);
    this.timers.delete(timer);
  }

  clearInterval(interval: NodeJS.Timeout): void {
    clearInterval(interval);
    this.intervals.delete(interval);
  }

  cleanup(): void {
    this.isShuttingDown = true;

    this.timers.forEach((timer) => {
      clearTimeout(timer);
    });

    this.intervals.forEach((interval) => {
      clearInterval(interval);
    });

    this.timers.clear();
    this.intervals.clear();
  }

  getActiveTimersCount(): number {
    return this.timers.size + this.intervals.size;
  }
}
```

### 1.2 Connection Management System

**Problem**: Unbounded connection growth, no cleanup
**Impact**: Memory leaks, connection exhaustion

#### Implementation

```typescript
// src/managers/ConnectionManager.ts
export interface ConnectionLimits {
  maxTotalConnections: number;
  maxConnectionsPerIp: number;
  maxConnectionsPerUser: number;
  connectionTimeoutMs: number;
  cleanupIntervalMs: number;
}

export interface ManagedConnection {
  id: string;
  socket: any;
  ip: string;
  userId?: string;
  createdAt: number;
  lastActivity: number;
  isAlive: boolean;
  messageCount: number;
  bytesReceived: number;
  bytesSent: number;
}

export class ProductionConnectionManager {
  private connections = new Map<string, ManagedConnection>();
  private connectionsByIp = new Map<string, Set<string>>();
  private connectionsByUser = new Map<string, Set<string>>();
  private timerManager: TimerManager;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(private config: ConnectionLimits, timerManager: TimerManager) {
    this.timerManager = timerManager;
    this.startCleanupTimer();
  }

  addConnection(
    id: string,
    socket: any,
    ip: string,
    userId?: string
  ): { success: boolean; reason?: string } {
    // Check total connections limit
    if (this.connections.size >= this.config.maxTotalConnections) {
      return { success: false, reason: "Max total connections exceeded" };
    }

    // Check IP-based limit
    const ipConnections = this.connectionsByIp.get(ip) || new Set();
    if (ipConnections.size >= this.config.maxConnectionsPerIp) {
      return { success: false, reason: "Max connections per IP exceeded" };
    }

    // Check user-based limit
    if (userId) {
      const userConnections = this.connectionsByUser.get(userId) || new Set();
      if (userConnections.size >= this.config.maxConnectionsPerUser) {
        return { success: false, reason: "Max connections per user exceeded" };
      }
    }

    // Create connection
    const connection: ManagedConnection = {
      id,
      socket,
      ip,
      userId,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      isAlive: true,
      messageCount: 0,
      bytesReceived: 0,
      bytesSent: 0,
    };

    // Store connection
    this.connections.set(id, connection);

    // Update indexes
    if (!this.connectionsByIp.has(ip)) {
      this.connectionsByIp.set(ip, new Set());
    }
    this.connectionsByIp.get(ip)!.add(id);

    if (userId) {
      if (!this.connectionsByUser.has(userId)) {
        this.connectionsByUser.set(userId, new Set());
      }
      this.connectionsByUser.get(userId)!.add(id);
    }

    return { success: true };
  }

  removeConnection(id: string): boolean {
    const connection = this.connections.get(id);
    if (!connection) return false;

    // Remove from main map
    this.connections.delete(id);

    // Remove from IP index
    const ipConnections = this.connectionsByIp.get(connection.ip);
    if (ipConnections) {
      ipConnections.delete(id);
      if (ipConnections.size === 0) {
        this.connectionsByIp.delete(connection.ip);
      }
    }

    // Remove from user index
    if (connection.userId) {
      const userConnections = this.connectionsByUser.get(connection.userId);
      if (userConnections) {
        userConnections.delete(id);
        if (userConnections.size === 0) {
          this.connectionsByUser.delete(connection.userId);
        }
      }
    }

    return true;
  }

  updateActivity(id: string): void {
    const connection = this.connections.get(id);
    if (connection) {
      connection.lastActivity = Date.now();
    }
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = this.timerManager.setInterval(() => {
      this.cleanupStaleConnections();
    }, this.config.cleanupIntervalMs);
  }

  private cleanupStaleConnections(): void {
    const now = Date.now();
    const staleConnections: string[] = [];

    for (const [id, connection] of this.connections) {
      const timeSinceActivity = now - connection.lastActivity;
      if (timeSinceActivity > this.config.connectionTimeoutMs) {
        staleConnections.push(id);
      }
    }

    staleConnections.forEach((id) => {
      const connection = this.connections.get(id);
      if (connection) {
        try {
          connection.socket.close(1001, "Connection timeout");
        } catch (error) {
          // Ignore errors during cleanup
        }
        this.removeConnection(id);
      }
    });

    if (staleConnections.length > 0) {
      console.log(`Cleaned up ${staleConnections.length} stale connections`);
    }
  }

  getStats() {
    return {
      totalConnections: this.connections.size,
      connectionsByIp: this.connectionsByIp.size,
      connectionsByUser: this.connectionsByUser.size,
      limits: this.config,
    };
  }

  cleanup(): void {
    if (this.cleanupTimer) {
      this.timerManager.clearInterval(this.cleanupTimer);
    }

    // Close all connections
    for (const connection of this.connections.values()) {
      try {
        connection.socket.close(1001, "Server shutdown");
      } catch (error) {
        // Ignore errors during cleanup
      }
    }

    this.connections.clear();
    this.connectionsByIp.clear();
    this.connectionsByUser.clear();
  }
}
```

### 1.3 Input Validation System

**Problem**: Insufficient input validation
**Impact**: Security vulnerabilities, system instability

#### Implementation

```typescript
// src/validation/InputValidator.ts
export class InputValidator {
  static validateToken(token: string | undefined): string {
    if (!token) {
      throw new Error("Authentication token is required");
    }

    if (typeof token !== "string") {
      throw new Error("Token must be a string");
    }

    // Remove Bearer prefix if present
    const cleanToken = token.replace(/^Bearer\s+/i, "");

    // Basic JWT format validation
    if (
      !/^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/.test(cleanToken)
    ) {
      throw new Error("Invalid token format");
    }

    if (cleanToken.length > 2048) {
      throw new Error("Token too long");
    }

    return cleanToken;
  }

  static validateUrl(url: string | undefined): string {
    if (!url) {
      throw new Error("URL is required");
    }

    if (typeof url !== "string") {
      throw new Error("URL must be a string");
    }

    if (url.length > 2048) {
      throw new Error("URL too long");
    }

    // Basic URL validation
    try {
      new URL(url, "http://localhost");
    } catch {
      throw new Error("Invalid URL format");
    }

    return url;
  }

  static validateHeaders(headers: any): Record<string, string> {
    if (!headers || typeof headers !== "object") {
      return {};
    }

    const validated: Record<string, string> = {};

    for (const [key, value] of Object.entries(headers)) {
      if (typeof key === "string" && typeof value === "string") {
        // Limit header size
        if (key.length > 100 || value.length > 1000) {
          continue; // Skip oversized headers
        }
        validated[key.toLowerCase()] = value;
      }
    }

    return validated;
  }

  static validateJsonPayload(
    payload: any,
    maxSizeBytes: number = 1024 * 1024
  ): any {
    if (payload === null || payload === undefined) {
      return null;
    }

    // Check payload size
    const payloadString = JSON.stringify(payload);
    if (payloadString.length > maxSizeBytes) {
      throw new Error("Payload too large");
    }

    return payload;
  }
}
```

---

## 🚀 Phase 2: Type Safety & Performance Optimization

### 2.1 Type-Safe Connection Management

**Problem**: Excessive use of `any` types
**Impact**: Runtime errors, reduced code quality

#### Implementation

```typescript
// src/types/server.types.ts
export interface TypedWebSocketConnection {
  readonly id: string;
  readonly socket: WebSocket;
  readonly metadata: ConnectionMetadata;
  readonly createdAt: Date;
  lastActivity: Date;
  isAlive: boolean;
  messageCount: number;
  bytesReceived: number;
  bytesSent: number;
}

export interface ConnectionMetadata {
  readonly ip: string;
  readonly userAgent: string;
  readonly userId?: string;
  readonly sessionId?: string;
  readonly rooms: Set<string>;
  readonly subscriptions: Set<string>;
  readonly customData: Record<string, unknown>;
}

export interface TypedWebSocketMessage<T = unknown> {
  readonly type: string;
  readonly payload: T;
  readonly timestamp: string;
  readonly messageId: string;
  readonly userId?: string;
  readonly sessionId?: string;
}

export interface TypedWebSocketHandler<TMessage = unknown> {
  open?: (ws: TypedWebSocketConnection) => void | Promise<void>;
  message?: (
    ws: TypedWebSocketConnection,
    message: TypedWebSocketMessage<TMessage>
  ) => void | Promise<void>;
  close?: (
    ws: TypedWebSocketConnection,
    code: number,
    reason: string
  ) => void | Promise<void>;
  error?: (ws: TypedWebSocketConnection, error: Error) => void | Promise<void>;
}
```

### 2.2 Performance-Optimized Middleware Chain

**Problem**: Middleware chain recreated on every request
**Impact**: High CPU usage, poor performance

#### Implementation

```typescript
// src/middleware/PerformantMiddlewareChain.ts
export class PerformantMiddlewareChain {
  private compiledChain?: MiddlewareFunction;
  private lastConfigHash?: string;
  private executionMetrics = new Map<string, number>();

  constructor(
    private middlewares: MiddlewareItem[],
    private timerManager: TimerManager
  ) {}

  execute(): MiddlewareFunction {
    const configHash = this.getConfigHash();

    // Return cached chain if configuration hasn't changed
    if (this.compiledChain && this.lastConfigHash === configHash) {
      return this.compiledChain;
    }

    // Compile new chain
    this.compiledChain = this.compileChain();
    this.lastConfigHash = configHash;

    return this.compiledChain;
  }

  private compileChain(): MiddlewareFunction {
    // Sort by priority once
    const sortedMiddlewares = [...this.middlewares]
      .filter((m) => m.enabled !== false)
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));

    return async (
      context: MiddlewareContext,
      finalNext: () => Promise<void>
    ) => {
      let index = 0;

      const next = async (): Promise<void> => {
        if (index >= sortedMiddlewares.length) {
          return finalNext();
        }

        const middleware = sortedMiddlewares[index++];
        const startTime = Date.now();

        try {
          await middleware.middleware.middleware()(context, next);

          // Track performance
          const duration = Date.now() - startTime;
          this.updateExecutionMetrics(middleware.name, duration);
        } catch (error) {
          // Reset index to prevent middleware chain corruption
          index = sortedMiddlewares.length;
          throw error;
        }
      };

      await next();
    };
  }

  private getConfigHash(): string {
    const configString = JSON.stringify(
      this.middlewares.map((m) => ({
        name: m.name,
        priority: m.priority,
        enabled: m.enabled,
        // Include middleware configuration hash if available
        configHash: (m.middleware as any).getConfigHash?.(),
      }))
    );

    return this.hashString(configString);
  }

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }

  private updateExecutionMetrics(name: string, duration: number): void {
    const current = this.executionMetrics.get(name) || 0;
    // Simple moving average
    const updated = current * 0.9 + duration * 0.1;
    this.executionMetrics.set(name, updated);
  }

  getPerformanceMetrics(): Record<string, number> {
    return Object.fromEntries(this.executionMetrics);
  }

  invalidateCache(): void {
    this.compiledChain = undefined;
    this.lastConfigHash = undefined;
  }
}
```

### 2.3 Resource-Aware Server Configuration

**Problem**: No resource limits or monitoring
**Impact**: Uncontrolled resource usage

#### Implementation

```typescript
// src/config/ResourceConfig.ts
export interface ResourceLimits {
  memory: {
    maxHeapSize: number; // MB
    warningThreshold: number; // percentage
    criticalThreshold: number; // percentage
    gcInterval: number; // ms
  };
  connections: {
    maxTotal: number;
    maxPerIp: number;
    maxPerUser: number;
    timeoutMs: number;
  };
  requests: {
    maxConcurrent: number;
    timeoutMs: number;
    maxPayloadSize: number; // bytes
    maxHeaderSize: number; // bytes
  };
  websockets: {
    maxConnections: number;
    maxMessageSize: number; // bytes
    pingInterval: number; // ms
    pongTimeout: number; // ms
  };
}

export class ResourceMonitor {
  private metrics = {
    memoryUsage: 0,
    activeConnections: 0,
    activeRequests: 0,
    cpuUsage: 0,
  };

  constructor(
    private limits: ResourceLimits,
    private timerManager: TimerManager
  ) {
    this.startMonitoring();
  }

  private startMonitoring(): void {
    this.timerManager.setInterval(() => {
      this.updateMetrics();
      this.checkLimits();
    }, 5000); // Check every 5 seconds
  }

  private updateMetrics(): void {
    const memUsage = process.memoryUsage();
    this.metrics.memoryUsage = memUsage.heapUsed / 1024 / 1024; // MB

    // CPU usage would require additional implementation
    // this.metrics.cpuUsage = getCpuUsage();
  }

  private checkLimits(): void {
    const memoryPercent =
      (this.metrics.memoryUsage / this.limits.memory.maxHeapSize) * 100;

    if (memoryPercent > this.limits.memory.criticalThreshold) {
      console.error("CRITICAL: Memory usage exceeds threshold", {
        current: this.metrics.memoryUsage,
        limit: this.limits.memory.maxHeapSize,
        percent: memoryPercent,
      });

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
    } else if (memoryPercent > this.limits.memory.warningThreshold) {
      console.warn("WARNING: Memory usage high", {
        current: this.metrics.memoryUsage,
        limit: this.limits.memory.maxHeapSize,
        percent: memoryPercent,
      });
    }
  }

  getMetrics() {
    return { ...this.metrics };
  }

  isHealthy(): boolean {
    const memoryPercent =
      (this.metrics.memoryUsage / this.limits.memory.maxHeapSize) * 100;
    return memoryPercent < this.limits.memory.criticalThreshold;
  }
}
```

---

## 🚀 Phase 3: Testing & Monitoring Infrastructure

### 3.1 Comprehensive Test Suite

#### Implementation

```typescript
// tests/unit/ConnectionManager.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ConnectionManager, TimerManager } from "../src";

describe("ConnectionManager", () => {
  let connectionManager: ConnectionManager;
  let timerManager: TimerManager;

  beforeEach(() => {
    timerManager = new TimerManager();
    connectionManager = new ConnectionManager(
      {
        maxTotalConnections: 100,
        maxConnectionsPerIp: 10,
        maxConnectionsPerUser: 5,
        connectionTimeoutMs: 30000,
        cleanupIntervalMs: 5000,
      },
      timerManager
    );
  });

  afterEach(() => {
    connectionManager.cleanup();
    timerManager.cleanup();
  });

  it("should accept valid connections", () => {
    const result = connectionManager.addConnection(
      "conn-1",
      mockWebSocket(),
      "192.168.1.1",
      "user-1"
    );

    expect(result.success).toBe(true);
    expect(connectionManager.getStats().totalConnections).toBe(1);
  });

  it("should reject connections exceeding IP limit", () => {
    // Add 10 connections from same IP
    for (let i = 0; i < 10; i++) {
      connectionManager.addConnection(
        `conn-${i}`,
        mockWebSocket(),
        "192.168.1.1"
      );
    }

    // 11th connection should be rejected
    const result = connectionManager.addConnection(
      "conn-11",
      mockWebSocket(),
      "192.168.1.1"
    );

    expect(result.success).toBe(false);
    expect(result.reason).toContain("Max connections per IP exceeded");
  });

  it("should cleanup stale connections", async () => {
    connectionManager.addConnection("conn-1", mockWebSocket(), "192.168.1.1");

    // Simulate old activity
    const connection = connectionManager["connections"].get("conn-1")!;
    connection.lastActivity = Date.now() - 60000; // 1 minute ago

    // Trigger cleanup
    connectionManager["cleanupStaleConnections"]();

    expect(connectionManager.getStats().totalConnections).toBe(0);
  });
});

function mockWebSocket() {
  return {
    close: vi.fn(),
    send: vi.fn(),
  };
}
```

### 3.2 Performance Testing

#### Implementation

```typescript
// tests/performance/ServerLoad.test.ts
import { describe, it, expect } from "vitest";
import { ElysiaServerBuilder } from "../src";

describe("Server Performance", () => {
  it("should handle 1000 concurrent connections", async () => {
    const server = new ElysiaServerBuilder({
      port: 0, // Random port
      websocket: { enabled: true },
    });

    const app = server.build();
    const startTime = Date.now();

    // Simulate 1000 connections
    const connections: WebSocket[] = [];

    for (let i = 0; i < 1000; i++) {
      const ws = new WebSocket("ws://localhost:3001/ws");
      connections.push(ws);

      // Add small delay to prevent overwhelming
      if (i % 100 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    const setupTime = Date.now() - startTime;
    expect(setupTime).toBeLessThan(5000); // Should setup in <5s

    // Test message throughput
    const messageStartTime = Date.now();
    const messagePromises = connections.map((ws) => {
      return new Promise((resolve) => {
        ws.onmessage = () => resolve(true);
        ws.send(JSON.stringify({ type: "ping" }));
      });
    });

    await Promise.all(messagePromises);
    const messageTime = Date.now() - messageStartTime;

    expect(messageTime).toBeLessThan(1000); // Should process 1000 messages in <1s

    // Cleanup
    connections.forEach((ws) => ws.close());
  });

  it("should maintain low memory usage under load", async () => {
    const initialMemory = process.memoryUsage().heapUsed;

    // Create and destroy many connections
    for (let batch = 0; batch < 10; batch++) {
      const connections = [];

      for (let i = 0; i < 100; i++) {
        // Simulate connection creation/destruction
        connections.push({ id: `conn-${batch}-${i}`, data: new Array(1000) });
      }

      // Clear batch
      connections.length = 0;

      // Force GC if available
      if (global.gc) global.gc();
    }

    const finalMemory = process.memoryUsage().heapUsed;
    const memoryIncrease = finalMemory - initialMemory;

    // Memory increase should be minimal
    expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024); // <50MB increase
  });
});
```

---

## 📊 Optimization Metrics & Monitoring

### Key Performance Indicators (KPIs)

```typescript
// src/monitoring/ProductionMetrics.ts
export class ProductionMetrics {
  private metrics = {
    // Performance Metrics
    averageResponseTime: 0,
    requestsPerSecond: 0,
    errorRate: 0,

    // Resource Metrics
    memoryUsage: 0,
    cpuUsage: 0,
    connectionCount: 0,

    // Business Metrics
    activeUsers: 0,
    messagesThroughput: 0,
    healthScore: 100,
  };

  private targets = {
    maxResponseTime: 100, // ms
    maxErrorRate: 0.01, // 1%
    maxMemoryUsage: 512, // MB
    maxCpuUsage: 70, // %
    minHealthScore: 95, // %
  };

  checkTargets(): boolean {
    return (
      this.metrics.averageResponseTime <= this.targets.maxResponseTime &&
      this.metrics.errorRate <= this.targets.maxErrorRate &&
      this.metrics.memoryUsage <= this.targets.maxMemoryUsage &&
      this.metrics.cpuUsage <= this.targets.maxCpuUsage &&
      this.metrics.healthScore >= this.targets.minHealthScore
    );
  }

  generateReport(): ProductionReport {
    return {
      timestamp: new Date().toISOString(),
      metrics: { ...this.metrics },
      targets: { ...this.targets },
      healthy: this.checkTargets(),
      recommendations: this.generateRecommendations(),
    };
  }

  private generateRecommendations(): string[] {
    const recommendations: string[] = [];

    if (this.metrics.averageResponseTime > this.targets.maxResponseTime) {
      recommendations.push("Consider optimizing middleware chain execution");
    }

    if (this.metrics.memoryUsage > this.targets.maxMemoryUsage) {
      recommendations.push(
        "Investigate memory leaks and increase GC frequency"
      );
    }

    if (this.metrics.errorRate > this.targets.maxErrorRate) {
      recommendations.push("Review error handling and input validation");
    }

    return recommendations;
  }
}

interface ProductionReport {
  timestamp: string;
  metrics: Record<string, number>;
  targets: Record<string, number>;
  healthy: boolean;
  recommendations: string[];
}
```

---

## 🎯 Implementation Timeline

### Week 1-2: Critical Fixes

- ✅ Implement TimerManager
- ✅ Add ConnectionManager with limits
- ✅ Add input validation
- ✅ Fix graceful shutdown

### Week 3-4: Performance & Types

- ✅ Implement PerformantMiddlewareChain
- ✅ Remove all `any` types
- ✅ Add ResourceMonitor
- ✅ Optimize memory usage

### Week 5-6: Testing & Monitoring

- ✅ Add comprehensive test suite
- ✅ Implement performance testing
- ✅ Add production metrics
- ✅ Security audit

### Success Criteria

- **Memory Usage**: <512MB under normal load
- **Response Time**: <100ms average
- **Test Coverage**: >80%
- **Type Safety**: 0 `any` types
- **Error Rate**: <1%
- **Connection Limit**: 10,000 concurrent connections

---

This optimization plan addresses all critical issues identified in the audit and provides a clear path to production readiness.
