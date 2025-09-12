module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/?(*.)+(spec|test).[jt]s?(x)"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.d.ts",
    "!src/**/index.ts",
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
  setupFilesAfterEnv: ["<rootDir>/tests/setup.ts"],
  testTimeout: 10000,
  // Transform TypeScript files
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: "tsconfig.test.json",
        useESM: true,
      },
    ],
  },
  // Module resolution - handle workspace dependencies and local src
  moduleNameMapper: {
    "^@libs/(.*)$": "<rootDir>/../../libs/$1/src/index.ts",
    "^(\\.{1,2}/.*)\\.js$": "$1", // Handle .js extensions in imports
  },
  // Include src directory for module resolution
  moduleDirectories: ["node_modules", "src", "<rootDir>"],
  // Handle ES modules
  extensionsToTreatAsEsm: [".ts"],
};
