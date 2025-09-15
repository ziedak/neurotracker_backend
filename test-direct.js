// Test script to check Logger.ts directly
try {
  const { ILogger, createLogger } = require("./libs/utils/src/Logger.ts");
  console.log("ILogger:", ILogger);
  console.log("createLogger:", typeof createLogger);
} catch (error) {
  console.error("Direct import failed:", error.message);
  console.error("Stack:", error.stack);
}
