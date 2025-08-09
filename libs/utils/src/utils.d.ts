export declare const validateEmail: (email: string) => boolean;
export declare const validateUUID: (uuid: string) => boolean;
export declare const formatCurrency: (amount: number, currency?: string) => string;
export declare const formatPercent: (value: number, decimals?: number) => string;
export declare const isWithinTimeRange: (timestamp: string, minutes: number) => boolean;
export declare const addMinutes: (date: Date, minutes: number) => Date;
export declare const generateId: (prefix?: string) => string;
export declare const sanitizeString: (str: string) => string;
export declare const chunkArray: <T>(array: T[], size: number) => T[][];
export declare class AppError extends Error {
    statusCode: number;
    isOperational: boolean;
    constructor(message: string, statusCode?: number, isOperational?: boolean);
}
export declare const handleAsyncError: <T extends any[], R>(fn: (...args: T) => Promise<R>) => (...args: T) => Promise<R>;
export declare const retryWithBackoff: <T>(fn: () => Promise<T>, maxRetries?: number, baseDelay?: number) => Promise<T>;
