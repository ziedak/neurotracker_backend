/**
 * Jest Configuration for Integration Tests
 * Tests against real Keycloak and PostgreSQL from Docker Compose
 */

module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests/integration"],
  testMatch: ["**/*.test.ts"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        isolatedModules: true,
        tsconfig: {
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          resolveJsonModule: true,
          strict: false,
          strictNullChecks: false,
          exactOptionalPropertyTypes: false,
        },
      },
    ],
  },
  moduleNameMapper: {
    "^@libs/(.*)$": "<rootDir>/../$1/src",
  },
  setupFilesAfterEnv: ["<rootDir>/tests/integration/jest.setup.ts"],
  testTimeout: 60000, // 60 seconds for integration tests
  maxWorkers: 1, // Run tests sequentially to avoid conflicts
  bail: false, // Continue running tests even if some fail
  verbose: true,
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    "!src/**/*.test.ts",
    "!src/**/__tests__/**",
  ],
  coverageDirectory: "coverage/integration",
  coverageReporters: ["text", "lcov", "html"],
};
