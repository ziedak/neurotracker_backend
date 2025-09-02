/**
 * Utility functions for AuthV2 library
 */

import { createHmac } from "crypto";

/**
 * Generate a secure random string
 */
export function generateSecureToken(length: number = 32): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Hash a password using HMAC-SHA256
 */
export function hashPassword(password: string, salt: string): string {
  const hmac = createHmac("sha256", salt);
  hmac.update(password);
  return hmac.digest("hex");
}

/**
 * Verify a password against its hash
 */
export function verifyPassword(
  password: string,
  hash: string,
  salt: string
): boolean {
  const computedHash = hashPassword(password, salt);
  return computedHash === hash;
}

/**
 * Generate API key
 */
export function generateApiKey(prefix: string = "ak"): string {
  const randomPart = generateSecureToken(32);
  return `${prefix}_${randomPart}`;
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Sanitize user input
 */
export function sanitizeInput(input: string): string {
  return input.trim().replace(/[<>]/g, "");
}

/**
 * Check if token is expired
 */
export function isTokenExpired(expiresAt: Date): boolean {
  return new Date() > expiresAt;
}

/**
 * Calculate token expiration date
 */
export function calculateExpirationDate(seconds: number): Date {
  return new Date(Date.now() + seconds * 1000);
}

/**
 * Parse time string to seconds (e.g., "1h", "30m", "2d")
 */
export function parseTimeToSeconds(time: string): number {
  const match = time.match(/^(\d+)([smhd])$/);
  if (!match) return 3600; // Default 1 hour

  const [, value, unit] = match;
  const numValue = value ? parseInt(value) : 1;

  switch (unit) {
    case "s":
      return numValue;
    case "m":
      return numValue * 60;
    case "h":
      return numValue * 3600;
    case "d":
      return numValue * 86400;
    default:
      return 3600;
  }
}

/**
 * Format duration in human readable format
 */
export function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Generate a unique ID
 */
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * Deep clone an object
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Check if value is empty (null, undefined, empty string, empty array)
 */
export function isEmpty(value: any): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

/**
 * Safe JSON parse with fallback
 */
export function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

/**
 * Extract Bearer token from Authorization header
 */
export function extractBearerToken(authHeader: string): string | null {
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match && match[1] ? match[1] : null;
}

/**
 * Extract Basic Auth credentials from Authorization header
 */
export function extractBasicCredentials(
  authHeader: string
): { username: string; password: string } | null {
  const match = authHeader.match(/^Basic\s+(.+)$/i);
  if (!match || !match[1]) return null;

  try {
    const decoded = Buffer.from(match[1], "base64").toString("utf-8");
    const [username, password] = decoded.split(":");
    return username && password ? { username, password } : null;
  } catch {
    return null;
  }
}
