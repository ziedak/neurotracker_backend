// Test setup file for rate limiting library

// Global test setup
beforeAll(() => {
  // Set test environment
  process.env["NODE_ENV"] = "test";
});

afterAll(() => {
  // Clean up
  jest.clearAllMocks();
});

// Mock console methods to reduce noise during tests
global.console = {
  ...console,
  // Keep error and warn for important messages
  // Mute info and debug during tests
  info: jest.fn(),
  debug: jest.fn(),
};
