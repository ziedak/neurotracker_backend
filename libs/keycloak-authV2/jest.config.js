module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src", "<rootDir>/tests"],
  testMatch: ["**/__tests__/**/*.ts", "**/?(*.)+(spec|test).ts"],
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
  collectCoverageFrom: ["src/**/*.{ts,tsx}", "!src/**/*.d.ts"],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
  moduleNameMapper: {
    "^@libs/database/src/(.*)$": "<rootDir>/../database/src/$1",
    "^@libs/database$": "<rootDir>/../database/src/index.ts",
    "^@libs/monitoring$": "<rootDir>/../monitoring/src/index.ts",
    "^@libs/utils$": "<rootDir>/../utils/src/index.ts",
    "^@libs/config$": "<rootDir>/../config/src/index.ts",
    "^@libs/(.*)$": "<rootDir>/../$1/src/index.ts",
  },
  globals: {
    "ts-jest": {
      isolatedModules: true,
    },
  },
};
