import { getEnv } from "@libs/config";
import { RedisClient } from "@libs/database";
import { setImmediate } from "timers";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogTransport = "console" | "redis" | "custom";

export interface LoggerOptions {
  service: string;
  level?: LogLevel;
  transports?: LogTransport[];
  formatter?: (entry: LogEntry) => string;
  customTransport?: (entry: LogEntry) => Promise<void>;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  meta?: any;
}

export class Logger {
  private service: string;
  private level: LogLevel;
  private transports: LogTransport[];
  private formatter: (entry: LogEntry) => string;
  private customTransport: (entry: LogEntry) => Promise<void>;
  private static instances: Map<string, Logger> = new Map();
  private logQueue: LogEntry[] = [];
  private isProcessing: boolean = false;

  constructor(options: LoggerOptions) {
    this.service = options.service;
    this.level = options.level || "info";
    this.transports = options.transports || ["console", "redis"];
    this.formatter = options.formatter || ((entry) => JSON.stringify(entry));
    this.customTransport = options.customTransport || (async () => {});
  }

  static getInstance(
    service: string,
    options?: Partial<LoggerOptions>
  ): Logger {
    if (!Logger.instances.has(service)) {
      Logger.instances.set(service, new Logger({ service, ...options }));
    }
    return Logger.instances.get(service)!;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ["debug", "info", "warn", "error"];
    return levels.indexOf(level) >= levels.indexOf(this.level);
  }

  private enqueueLog(entry: LogEntry) {
    this.logQueue.push(entry);
    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  private async processQueue() {
    this.isProcessing = true;
    while (this.logQueue.length > 0) {
      const entry = this.logQueue.shift()!;
      await this.writeLog(entry);
    }
    this.isProcessing = false;
  }

  private async writeLog(entry: LogEntry) {
    for (const transport of this.transports) {
      switch (transport) {
        case "console":
          setImmediate(() => {
            console.log(this.formatter(entry));
          });
          break;
        case "redis":
          try {
            const redis = RedisClient.getInstance();
            await redis.lpush(`logs:${this.service}`, this.formatter(entry));
            await redis.ltrim(`logs:${this.service}`, 0, 999);
          } catch (error) {
            setImmediate(() => {
              console.error("Failed to send log to Redis:", error);
            });
          }
          break;
        case "custom":
          if (this.customTransport) {
            try {
              await this.customTransport(entry);
            } catch (error) {
              setImmediate(() => {
                console.error("Custom transport error:", error);
              });
            }
          }
          break;
      }
    }
  }

  private log(level: LogLevel, message: string, meta?: any) {
    if (!this.shouldLog(level)) return;
    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      message,
      ...(meta && { meta }),
    };
    this.enqueueLog(logEntry);
  }

  info(message: string, meta?: any) {
    this.log("info", message, meta);
  }

  warn(message: string, meta?: any) {
    this.log("warn", message, meta);
  }

  error(message: string, error?: Error, meta?: any) {
    this.log("error", error?.message || message, {
      stack: error?.stack,
      ...meta,
    });
  }
  /**
   * Create a child logger with additional context (e.g., component, requestId)
   */
  child(context: Record<string, any>): Logger {
    const parentFormatter = this.formatter;
    const mergedFormatter = (entry: LogEntry) => {
      return parentFormatter({ ...entry, ...context });
    };
    return new Logger({
      service: this.service,
      level: this.level,
      transports: this.transports,
      formatter: mergedFormatter,
      customTransport: this.customTransport,
    });
  }
  debug(message: string, meta?: any) {
    if (getEnv("NODE_ENV") === "development") {
      this.log("debug", message, meta);
    }
  }

  setLevel(level: LogLevel) {
    this.level = level;
  }

  setTransports(transports: LogTransport[]) {
    this.transports = transports;
  }

  setFormatter(formatter: (entry: LogEntry) => string) {
    this.formatter = formatter;
  }

  setCustomTransport(transport: (entry: LogEntry) => Promise<void>) {
    this.customTransport = transport;
  }
}
