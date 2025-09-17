import { getEnv } from "@libs/config";
import pino from "pino";

/*
--Same interface, better performance
import { createLogger } from "@libs/monitoring";

const logger = createLogger("my-service");
logger.info("Service started");
logger.error("Error occurred", new Error("Something failed"));

Child loggers work exactly the same
const childLogger = logger.child({ requestId: "req-123" });
childLogger.debug("Processing request");

-- Advanced Pino features available
import { pino } from "@libs/monitoring";
const advancedLogger = pino({  custom config  });
*/

// Logger interfaces and types
export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal" | "trace";

export interface ILogger {
  info(message: string, meta?: any): void;
  warn(message: string, meta?: any): void;
  error(message: string, error?: any, meta?: any): void;
  debug(message: string, meta?: any): void;
  child(context: Record<string, any>): ILogger;
  setLevel(level: LogLevel): void;
}

// Create Pino logger instance
const createPinoLogger = (service: string, level: LogLevel = "info") => {
  const isDevelopment = getEnv("NODE_ENV") === "development";

  return pino({
    name: service,
    level,
    formatters: {
      level: (label: string) => ({ level: label }),
    },
    serializers: {
      error: pino.stdSerializers.err,
      req: pino.stdSerializers.req,
      res: pino.stdSerializers.res,
    },
    ...(isDevelopment && {
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      },
    }),
  });
};

// Pino-based logger implementation
export class PinoLogger implements ILogger {
  private logger: pino.Logger;

  constructor(service: string, level: LogLevel = "info") {
    this.logger = createPinoLogger(service, level);
  }

  info(message: string, meta?: any): void {
    this.logger.info(meta || {}, message);
  }

  warn(message: string, meta?: any): void {
    this.logger.warn(meta || {}, message);
  }

  error(message: string, error?: any, meta?: any): void {
    if (error instanceof Error) {
      this.logger.error({ ...meta, err: error }, message);
    } else {
      this.logger.error(meta || {}, message);
    }
  }

  debug(message: string, meta?: any): void {
    this.logger.debug(meta || {}, message);
  }

  child(context: Record<string, any>): ILogger {
    const childLogger = this.logger.child(context);
    const pinoChild = Object.create(PinoLogger.prototype);
    pinoChild.logger = childLogger;
    return pinoChild;
  }

  setLevel(level: LogLevel): void {
    this.logger.level = level;
  }
}

// Factory function for easy instantiation
export const createLogger = (service: string, level?: LogLevel): ILogger => {
  return new PinoLogger(service, level);
};

// Export Pino directly for advanced usage
export { pino };
export default pino;

/**
 * Usage Examples:
 *
 * // Basic usage
 * const logger = createLogger("my-service");
 * logger.info("Service started");
 * logger.error("Something went wrong", new Error("Database connection failed"));
 *
 * // With metadata
 * logger.info("User logged in", { userId: 123, ip: "192.168.1.1" });
 *
 * // Child logger
 * const childLogger = logger.child({ requestId: "req-123" });
 * childLogger.debug("Processing request");
 *
 * // Direct Pino usage for advanced features
 * import pino from "pino";
 * const advancedLogger = pino({
 *   name: "advanced-service",
 *   level: "debug",
 *   // Add custom serializers, transports, etc.
 * });
 */
