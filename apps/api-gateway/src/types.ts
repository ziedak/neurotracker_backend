// Type-safe error handler
export function handleError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
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
  _password: string,
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
