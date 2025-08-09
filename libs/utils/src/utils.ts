import { z } from "zod";

// Validation utilities
export const validateEmail = (email: string): boolean => {
  const emailSchema = z.string().email();
  return emailSchema.safeParse(email).success;
};

export const validateUUID = (uuid: string): boolean => {
  const uuidSchema = z.string().uuid();
  return uuidSchema.safeParse(uuid).success;
};

// Formatting utilities
export const formatCurrency = (amount: number, currency = "USD"): string => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(amount);
};

export const formatPercent = (value: number, decimals = 2): string => {
  return `${(value * 100).toFixed(decimals)}%`;
};

// Date utilities
export const isWithinTimeRange = (
  timestamp: string,
  minutes: number
): boolean => {
  const time = new Date(timestamp).getTime();
  const now = Date.now();
  return now - time <= minutes * 60 * 1000;
};

export const addMinutes = (date: Date, minutes: number): Date => {
  return new Date(date.getTime() + minutes * 60 * 1000);
};

// String utilities
export const generateId = (prefix = ""): string => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 9);
  return prefix ? `${prefix}_${timestamp}_${random}` : `${timestamp}_${random}`;
};

export const sanitizeString = (str: string): string => {
  return str.replace(/[<>'"&]/g, "");
};

// Array utilities
export const chunkArray = <T>(array: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
};

// Error utilities
export class AppError extends Error {
  public statusCode: number;
  public isOperational: boolean;

  constructor(message: string, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;

    // Only capture stack trace if available (Node.js specific)
    if ((Error as any).captureStackTrace) {
      (Error as any).captureStackTrace(this, this.constructor);
    }
  }
}

export const handleAsyncError = <T extends any[], R>(
  fn: (...args: T) => Promise<R>
) => {
  return (...args: T): Promise<R> => {
    return Promise.resolve(fn(...args)).catch((error) => {
      throw new AppError(error.message, error.statusCode || 500);
    });
  };
};

// Retry utility
export const retryWithBackoff = async <T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T> => {
  let lastError: Error;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (i === maxRetries - 1) break;

      const delay = baseDelay * Math.pow(2, i);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
};
