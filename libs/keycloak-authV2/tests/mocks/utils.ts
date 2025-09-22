/**
 * Mock implementation of @libs/utils for testing
 */

export const mockLogger = {
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

export const createLogger = jest.fn((name: string) => ({
  ...mockLogger,
  name,
}));
