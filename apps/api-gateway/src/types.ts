import { Context } from "elysia";
import { JWTPayload, AuthContext } from "@libs/auth";

// Utility to convert Elysia context to AuthContext for auth library
export function createAuthContext(context: Context): AuthContext {
  const headers: Record<string, string | undefined> = {};

  // Convert Headers object to plain object
  context.request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return {
    headers,
    set: {
      status: typeof context.set.status === "number" ? context.set.status : 200,
      headers: Object.fromEntries(
        Object.entries(context.set.headers || {}).map(([k, v]) => [
          k,
          String(v),
        ])
      ),
    },
  };
}

// Type-safe error handler
export function handleError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}

// Enhanced JWT payload creation with required fields
export function createJWTPayload(user: {
  id: string;
  email: string;
  storeId: string;
  role: "admin" | "store_owner" | "api_user" | "customer";
  permissions: string[];
}): JWTPayload {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: user.id,
    email: user.email,
    storeId: user.storeId,
    role: user.role,
    permissions: user.permissions,
    iat: now,
    exp: now + 24 * 60 * 60, // 24 hours
  };
}

// Type definitions for better type safety
export interface LoginBody {
  email: string;
  password: string;
  storeId?: string;
}

export interface RegisterBody {
  email: string;
  password: string;
  storeName: string;
  storeUrl: string;
  firstName: string;
  lastName: string;
}

export interface User {
  id: string;
  email: string;
  storeId: string;
  role: "admin" | "store_owner" | "api_user" | "customer";
  permissions: string[];
}

// Demo user database (replace with real database in production)
export const demoUsers: User[] = [
  {
    id: "user_admin_001",
    email: "admin@cartrecovery.com",
    storeId: "admin",
    role: "admin",
    permissions: ["*"],
  },
  {
    id: "user_store_001",
    email: "store@example.com",
    storeId: "store_001",
    role: "store_owner",
    permissions: ["store:read", "store:write", "interventions:*"],
  },
];

// User validation function
export async function validateUser(
  email: string,
  password: string,
  storeId?: string
): Promise<User | null> {
  // In production, validate against your user database with hashed passwords
  const user = demoUsers.find(
    (u) => u.email === email && (!storeId || u.storeId === storeId)
  );

  // For demo purposes, accept any password
  // In production: await PasswordService.verify(password, user.hashedPassword)
  return user || null;
}
