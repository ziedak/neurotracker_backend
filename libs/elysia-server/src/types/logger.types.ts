/**
 * Logger interface for consistent logging across the application
 */
import { LoggerArgs } from "./validation.types";

export interface Logger {
  info(message: string, ...args: LoggerArgs): void;
  warn(message: string, ...args: LoggerArgs): void;
  error(message: string, ...args: LoggerArgs): void;
  debug(message: string, ...args: LoggerArgs): void;
}

/**
 * Simple console logger implementation
 */
export class ConsoleLogger implements Logger {
  info(message: string, ...args: LoggerArgs): void {
    console.info(`[INFO] ${message}`, ...args);
  }

  warn(message: string, ...args: LoggerArgs): void {
    console.warn(`[WARN] ${message}`, ...args);
  }

  error(message: string, ...args: LoggerArgs): void {
    console.error(`[ERROR] ${message}`, ...args);
  }

  debug(message: string, ...args: LoggerArgs): void {
    console.debug(`[DEBUG] ${message}`, ...args);
  }
}

/**
 * No-op logger for testing or when logging is disabled
 */
export class NoOpLogger implements Logger {
  info(): void {}
  warn(): void {}
  error(): void {}
  debug(): void {}
}
