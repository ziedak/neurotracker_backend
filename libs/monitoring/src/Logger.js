var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var Logger_1;
import { injectable } from "@libs/utils";
import { getEnv } from "@libs/config";
import { setImmediate } from "timers";
let Logger = Logger_1 = class Logger {
    service;
    level;
    transports;
    formatter;
    customTransport;
    // DI manages logger lifecycle; no static singleton needed
    logQueue = [];
    isProcessing = false;
    constructor(options) {
        this.service = options.service;
        this.level = options.level || "info";
        this.transports = options.transports || ["console", "redis"];
        this.formatter = options.formatter || ((entry) => JSON.stringify(entry));
        this.customTransport = options.customTransport || (async () => { });
    }
    shouldLog(level) {
        const levels = ["debug", "info", "warn", "error"];
        return levels.indexOf(level) >= levels.indexOf(this.level);
    }
    enqueueLog(entry) {
        this.logQueue.push(entry);
        if (!this.isProcessing) {
            this.processQueue();
        }
    }
    async processQueue() {
        this.isProcessing = true;
        while (this.logQueue.length > 0) {
            const entry = this.logQueue.shift();
            await this.writeLog(entry);
        }
        this.isProcessing = false;
    }
    async writeLog(entry) {
        for (const transport of this.transports) {
            switch (transport) {
                case "console":
                    setImmediate(() => {
                        console.log(this.formatter(entry));
                    });
                    break;
                case "redis":
                    // try {
                    //   const redis = RedisClient.getInstance();
                    //   await redis.lpush(`logs:${this.service}`, this.formatter(entry));
                    //   await redis.ltrim(`logs:${this.service}`, 0, 999);
                    // } catch (error) {
                    //   setImmediate(() => {
                    //     console.error("Failed to send log to Redis:", error);
                    //   });
                    // }
                    break;
                case "custom":
                    if (this.customTransport) {
                        try {
                            await this.customTransport(entry);
                        }
                        catch (error) {
                            setImmediate(() => {
                                console.error("Custom transport error:", error);
                            });
                        }
                    }
                    break;
            }
        }
    }
    log(level, message, meta) {
        if (!this.shouldLog(level))
            return;
        const logEntry = {
            timestamp: new Date().toISOString(),
            level,
            service: this.service,
            message,
            ...(meta && { meta }),
        };
        this.enqueueLog(logEntry);
    }
    info(message, meta) {
        this.log("info", message, meta);
    }
    warn(message, meta) {
        this.log("warn", message, meta);
    }
    error(message, error, meta) {
        if (error instanceof Error) {
            this.log("error", error.message || message, {
                stack: error.stack,
                ...meta,
            });
        }
        else {
            this.log("error", String(error), meta);
        }
    }
    debug(message, meta) {
        if (getEnv("NODE_ENV") === "development") {
            this.log("debug", message, meta);
        }
    }
    /**
     * Create a child logger with additional context (e.g., component, requestId)
     */
    child(context) {
        const parentFormatter = this.formatter;
        const mergedFormatter = (entry) => {
            return parentFormatter({ ...entry, ...context });
        };
        return new Logger_1({
            service: this.service,
            level: this.level,
            transports: this.transports,
            formatter: mergedFormatter,
            customTransport: this.customTransport,
        });
    }
    setLevel(level) {
        this.level = level;
    }
    setTransports(transports) {
        this.transports = transports;
    }
    setFormatter(formatter) {
        this.formatter = formatter;
    }
    setCustomTransport(transport) {
        this.customTransport = transport;
    }
};
Logger = Logger_1 = __decorate([
    injectable(),
    __metadata("design:paramtypes", [Object])
], Logger);
export { Logger };
//# sourceMappingURL=Logger.js.map