/**
 * @fileoverview Logger Stub - Supporting Step 4.1
 * Mock logger implementation for development
 *
 * @version 2.3.0
 * @author Enterprise Auth Foundation
 */

/**
 * Log Level Enumeration
 */
export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

/**
 * Log Entry Interface
 */
export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

/**
 * Logger Interface
 */
export interface ILogger {
  error(message: string, metadata?: Record<string, any>): void;
  warn(message: string, metadata?: Record<string, any>): void;
  info(message: string, metadata?: Record<string, any>): void;
  debug(message: string, metadata?: Record<string, any>): void;
}

/**
 * Logger Mock Implementation
 */
export class Logger implements ILogger {
  private readonly logLevel: LogLevel;

  constructor(logLevel: LogLevel = LogLevel.INFO) {
    this.logLevel = logLevel;
  }

  /**
   * Log error message
   */
  error(message: string, metadata?: Record<string, any>): void {
    if (this.logLevel >= LogLevel.ERROR) {
      this.log(LogLevel.ERROR, message, metadata);
    }
  }

  /**
   * Log warning message
   */
  warn(message: string, metadata?: Record<string, any>): void {
    if (this.logLevel >= LogLevel.WARN) {
      this.log(LogLevel.WARN, message, metadata);
    }
  }

  /**
   * Log info message
   */
  info(message: string, metadata?: Record<string, any>): void {
    if (this.logLevel >= LogLevel.INFO) {
      this.log(LogLevel.INFO, message, metadata);
    }
  }

  /**
   * Log debug message
   */
  debug(message: string, metadata?: Record<string, any>): void {
    if (this.logLevel >= LogLevel.DEBUG) {
      this.log(LogLevel.DEBUG, message, metadata);
    }
  }

  private log(
    level: LogLevel,
    message: string,
    metadata?: Record<string, any>
  ): void {
    const levelName = LogLevel[level];
    const timestamp = new Date().toISOString();

    let logMessage = `[${timestamp}] [${levelName}] ${message}`;

    if (metadata && Object.keys(metadata).length > 0) {
      logMessage += ` ${JSON.stringify(metadata)}`;
    }

    console.log(logMessage);
  }
}

// Export for dependency injection
export const createLogger = (logLevel: LogLevel = LogLevel.INFO): Logger => {
  return new Logger(logLevel);
};
