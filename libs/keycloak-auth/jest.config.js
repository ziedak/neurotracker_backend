/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  setupFilesAfterEnv: ["<rootDir>/tests/setup.ts"],
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.d.ts",
    "!src/**/*.test.{ts,tsx}",
    "!src/**/*.spec.{ts,tsx}",
  ],
  testMatch: [
    "<rootDir>/tests/**/*.test.{ts,tsx}",
    "<rootDir>/tests/**/*.spec.{ts,tsx}",
  ],
  moduleNameMapper: {
    "^@libs/(.*)$": "<rootDir>/../$1/src/index.ts",
    "^(\\.\\.?\\/.+)\\.js$": "$1", // Handle .js imports in TypeScript files
  },
  transform: {
    "^.+\\.(ts|tsx)$": [
      "ts-jest",
      {
        tsconfig: "tsconfig.test.json",
        useESM: true,
      },
    ],
  },
  extensionsToTreatAsEsm: [".ts"],
  testTimeout: 30000,
};
