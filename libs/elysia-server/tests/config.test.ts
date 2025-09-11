/**
 * @file config.test.ts
 * @description Unit tests for server configuration
 */

import { ServerConfig, DEFAULT_SERVER_CONFIG } from "../src/config";

describe("ServerConfig", () => {
  it("should have DEFAULT_SERVER_CONFIG", () => {
    expect(DEFAULT_SERVER_CONFIG).toBeDefined();
    expect(DEFAULT_SERVER_CONFIG.port).toBe(3000);
  });

  it("should accept ServerConfig interface", () => {
    const config: ServerConfig = {
      port: 8080,
      name: "TestServer",
      version: "1.0.0",
    };

    expect(config.port).toBe(8080);
    expect(config.name).toBe("TestServer");
  });
});
