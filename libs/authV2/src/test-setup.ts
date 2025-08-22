/**
 * @fileoverview Jest test setup for AuthV2 library
 * @author Enterprise Security Team
 * @since 1.0.0 - Phase 1 Security Remediation
 */

// Extend Jest matchers
expect.extend({
  // Add custom matchers if needed
});

// Global test timeout
jest.setTimeout(30000);

// Mock console.error to reduce noise during tests
const originalError = console.error;
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    if (
      typeof args[0] === "string" &&
      args[0].includes("Warning") &&
      !process.env["SHOW_WARNINGS"]
    ) {
      return;
    }
    originalError.call(console, ...args);
  };
});

afterAll(() => {
  console.error = originalError;
});
