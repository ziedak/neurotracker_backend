// Test script to check createLogger only
try {
  const { createLogger } = require("./libs/utils/src/Logger.ts");
  console.log("createLogger:", typeof createLogger);

  const logger = createLogger("test");
  console.log("Logger instance:", typeof logger);
  console.log(
    "Logger methods:",
    Object.getOwnPropertyNames(Object.getPrototypeOf(logger))
  );
} catch (error) {
  console.error("Direct import failed:", error);
}
