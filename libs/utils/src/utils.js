import { z } from "zod";
// Validation utilities
export const validateEmail = (email) => {
    const emailSchema = z.string().email();
    return emailSchema.safeParse(email).success;
};
export const validateUUID = (uuid) => {
    const uuidSchema = z.string().uuid();
    return uuidSchema.safeParse(uuid).success;
};
// Formatting utilities
export const formatCurrency = (amount, currency = "USD") => {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
    }).format(amount);
};
export const formatPercent = (value, decimals = 2) => {
    return `${(value * 100).toFixed(decimals)}%`;
};
// Date utilities
export const isWithinTimeRange = (timestamp, minutes) => {
    const time = new Date(timestamp).getTime();
    const now = Date.now();
    return now - time <= minutes * 60 * 1000;
};
export const addMinutes = (date, minutes) => {
    return new Date(date.getTime() + minutes * 60 * 1000);
};
// String utilities
export const generateId = (prefix = "") => {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 9);
    return prefix ? `${prefix}_${timestamp}_${random}` : `${timestamp}_${random}`;
};
export const sanitizeString = (str) => {
    return str.replace(/[<>'"&]/g, "");
};
// Array utilities
export const chunkArray = (array, size) => {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
};
// Error utilities
export class AppError extends Error {
    statusCode;
    isOperational;
    constructor(message, statusCode = 500, isOperational = true) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        // Only capture stack trace if available (Node.js specific)
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}
export const handleAsyncError = (fn) => {
    return (...args) => {
        return Promise.resolve(fn(...args)).catch((error) => {
            throw new AppError(error.message, error.statusCode || 500);
        });
    };
};
// Retry utility
export const retryWithBackoff = async (fn, maxRetries = 3, baseDelay = 1000) => {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        }
        catch (error) {
            lastError = error;
            if (i === maxRetries - 1)
                break;
            const delay = baseDelay * Math.pow(2, i);
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
    throw lastError;
};
//# sourceMappingURL=utils.js.map