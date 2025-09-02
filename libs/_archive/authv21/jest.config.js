{
  "preset": "ts-jest",
  "testEnvironment": "node",
  "roots": ["<rootDir>/src", "<rootDir>/tests"],
  "testMatch": ["**/__tests__/**/*.ts", "**/?(*.)+(spec|test).ts"],
  "transform": {
    "^.+\\.ts$": "ts-jest"
  },
  "collectCoverageFrom": [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    "!src/**/index.ts"
  ],
  "coverageDirectory": "coverage",
  "coverageReporters": ["text", "lcov", "html"],
  "moduleFileExtensions": ["ts", "js", "json"],
  "moduleNameMapping": {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^@libs/(.*)$": "<rootDir>/../../libs/$1"
  },
  "setupFilesAfterEnv": ["<rootDir>/tests/setup.ts"],
  "testTimeout": 10000,
  "verbose": true,
  "forceExit": true,
  "detectOpenHandles": true
}
