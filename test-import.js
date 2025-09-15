// Test script to check ILogger import
try {
  const { ILogger, createLogger } = require("./libs/utils/src/index.ts");
  console.log("ILogger:", typeof ILogger);
  console.log("createLogger:", typeof createLogger);

  const logger = createLogger("test");
  console.log("Logger created successfully:", typeof logger);
} catch (error) {
  console.error("Import failed:", error.message);
}
