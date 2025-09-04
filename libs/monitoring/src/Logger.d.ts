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
export interface ILogger {
    info(message: string, meta?: any): void;
    warn(message: string, meta?: any): void;
    error(message: string, error?: any, meta?: any): void;
    debug(message: string, meta?: any): void;
    child(context: Record<string, any>): ILogger;
    setLevel(level: LogLevel): void;
    setTransports(transports: LogTransport[]): void;
    setFormatter(formatter: (entry: LogEntry) => string): void;
    setCustomTransport(transport: (entry: LogEntry) => Promise<void>): void;
}
export declare class Logger implements ILogger {
    private service;
    private level;
    private transports;
    private formatter;
    private customTransport;
    private logQueue;
    private isProcessing;
    constructor(options: LoggerOptions);
    private shouldLog;
    private enqueueLog;
    private processQueue;
    private writeLog;
    private log;
    info(message: string, meta?: any): void;
    warn(message: string, meta?: any): void;
    error(message: string, error: any, meta?: any): void;
    debug(message: string, meta?: any): void;
    /**
     * Create a child logger with additional context (e.g., component, requestId)
     */
    child(context: Record<string, any>): ILogger;
    setLevel(level: LogLevel): void;
    setTransports(transports: LogTransport[]): void;
    setFormatter(formatter: (entry: LogEntry) => string): void;
    setCustomTransport(transport: (entry: LogEntry) => Promise<void>): void;
}
//# sourceMappingURL=Logger.d.ts.map