/**
 * Modern Authentication Examples using Oslo Packages
 *
 * This file demonstrates how to use the modern authentication middleware
 * with Elysia applications using Oslo cryptographic primitives.
 */

import { Elysia } from "@libs/elysia-server";
import {
  createAuthPlugin,
  authGuards,
  AuthService,
  UserAuthService,
  PasswordUtils,
  type AuthContext,
  type LoginCredentials,
  type AuthMiddlewareConfig,
} from "./index";
import type { User } from "@libs/database";

/**
 * Example 1: Basic Authentication Setup
 */
export function basicAuthExample() {
  const app = new Elysia()
    // Add authentication middleware
    .use(
      createAuthPlugin({
        sessionExpiresInHours: 24,
        skipPaths: ["/health", "/public"],
        requireAuth: false,
      })
    )

    // Public routes
    .get("/health", () => ({ status: "ok" }))
    .get("/public", () => ({ message: "Public content" }))

    // Protected routes (auth required)
    .use(authGuards.required)
    .get("/profile", ({ auth }: { auth: AuthContext }) => ({
      user: auth.user,
      message: `Hello ${auth.user?.firstName || auth.user?.username}`,
    }))

    // Admin-only routes
    .use(authGuards.role("ADMIN"))
    .get("/admin", ({ auth }: { auth: AuthContext }) => ({
      message: "Admin area",
      user: auth.user,
    }));

  return app;
}

/**
 * Example 2: Authentication Routes
 */
export function authenticationRoutesExample() {
  const authService = new AuthService();
  const userAuthService = new UserAuthService(authService);

  const app = new Elysia()
    .use(createAuthPlugin({ requireAuth: false }))

    // Login endpoint
    .post("/auth/login", async ({ body, request }) => {
      const credentials = body as LoginCredentials;
      const clientIP = request.headers.get("x-forwarded-for") || "unknown";
      const userAgent = request.headers.get("user-agent") || "unknown";

      try {
        const user = await userAuthService.authenticate(credentials);
        if (user) {
          const sessionResult = await authService.createSession({
            userId: user.id,
            ipAddress: clientIP,
            userAgent: userAgent,
            expiresInHours: 168, // 7 days
          });

          return {
            success: true,
            user: { id: user.id, email: user.email, username: user.username },
            sessionToken: sessionResult.sessionToken,
            jwtToken: sessionResult.jwtToken,
          };
        }
        return { success: false, error: "Invalid credentials" };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    })

    // Logout endpoint
    .post(
      "/auth/logout",
      async ({
        auth,
        authService,
      }: {
        auth: AuthContext;
        authService: AuthService;
      }) => {
        if (auth.session) {
          await authService.invalidateSession(auth.session.id);
        }

        return { success: true };
      }
    )

    // Register endpoint
    .post("/auth/register", async ({ body }) => {
      const userData = body as {
        email: string;
        password: string;
        username: string;
        firstName?: string;
        lastName?: string;
      };

      try {
        const user = await userAuthService.register(userData);
        if (user) {
          return {
            success: true,
            user: { id: user.id, email: user.email, username: user.username },
          };
        }
        return { success: false, error: "Registration failed" };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    })

    // Protected: Change password endpoint
    .use(authGuards.required)
    .put(
      "/auth/change-password",
      async ({ auth, body }: { auth: AuthContext; body: any }) => {
        const { currentPassword, newPassword } = body as {
          currentPassword: string;
          newPassword: string;
        };

        if (!auth.user) {
          return { success: false, error: "Not authenticated" };
        }

        try {
          const success = await userAuthService.changePassword(
            auth.user.id,
            currentPassword,
            newPassword
          );

          return { success };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
          };
        }
      }
    );

  return app;
}

/**
 * Example 3: Role-Based Access Control
 */
export function rbacExample() {
  const app = new Elysia()
    .use(createAuthPlugin())

    // Public dashboard (anyone can access)
    .get("/dashboard", ({ auth }: { auth: AuthContext }) => ({
      message: `Welcome to dashboard, ${auth.user?.username || "Guest"}`,
      role: auth.user?.role?.name || "none",
    }))

    // Admin panel (admin only)
    .use(authGuards.role("ADMIN"))
    .get("/admin/users", () => ({
      message: "User management",
      users: [],
    }))

    // Analytics (admin or analyst)
    .use(authGuards.anyRole(["ADMIN", "ANALYST"]))
    .get("/analytics", () => ({
      message: "Analytics dashboard",
      data: [],
    }))

    // Mixed authentication (optional auth)
    .use(authGuards.optional)
    .get("/content", ({ auth }: { auth: AuthContext }) => {
      return {
        content: "Some content",
        authenticated: auth.isAuthenticated,
        user: auth.user?.username || "guest",
      };
    });

  return app;
}

/**
 * Example 4: Password Utilities
 */
export function passwordUtilsExample() {
  console.log("=== Password Utilities Examples ===");

  // Generate a secure password
  const securePassword = PasswordUtils.generateSecurePassword(16);
  console.log("Generated password:", securePassword);

  // Validate password strength
  const testPassword = "MySecurePassword123!";
  const validation = PasswordUtils.validatePassword(testPassword, {
    minLength: 12,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSpecialChars: true,
  });

  console.log("Password validation:", validation);

  // Calculate password strength
  const strength = PasswordUtils.calculatePasswordStrength("password123");
  console.log("Password strength (weak):", strength);

  const strongStrength = PasswordUtils.calculatePasswordStrength(
    "MyVerySecureP@ssw0rd!2024"
  );
  console.log("Password strength (strong):", strongStrength);

  // Password breach check (placeholder implementation)
  PasswordUtils.checkPasswordBreach("password").then((result) => {
    console.log("Breach check result:", result);
  });
}

/**
 * Example 5: Full Application Setup
 */
export function fullApplicationExample() {
  const authConfig: Partial<AuthMiddlewareConfig> = {
    sessionExpiresInHours: 168, // 7 days
    cleanupIntervalMinutes: 60,
    maxSessionsPerUser: 5,
    strictIpCheck: false,
    skipPaths: ["/health", "/metrics", "/public"],
    requireAuth: true,
    cookieOptions: {
      name: "session",
      httpOnly: true,
      secure: process.env["NODE_ENV"] === "production",
      sameSite: "lax",
      maxAge: 168 * 60 * 60 * 1000, // 7 days in ms
      path: "/",
      ...(process.env["COOKIE_DOMAIN"] && {
        domain: process.env["COOKIE_DOMAIN"],
      }),
    },
    rateLimiting: {
      maxAttempts: 5,
      windowMinutes: 15,
      blockDurationMinutes: 30,
    },
  };

  const app = new Elysia()
    .use(createAuthPlugin(authConfig))

    // Health check (public)
    .get("/health", () => ({ status: "healthy", timestamp: new Date() }))

    // Protected routes
    .get("/me", ({ auth }: { auth: AuthContext }) => ({
      user: auth.user,
      session: {
        id: auth.session?.id,
        createdAt: auth.session?.createdAt,
        expiresAt: auth.session?.expiresAt,
        ipAddress: auth.session?.ipAddress,
        userAgent: auth.session?.userAgent,
      },
    }));

  return app;
}

/**
 * Example 6: Session Management
 */
export function sessionManagementExample(): any {
  const app = new Elysia()
    .use(createAuthPlugin())

    // Current session info
    .get("/sessions/current", ({ auth }: { auth: AuthContext }) => ({
      session: auth.session,
    }))

    // Invalidate current session
    .delete(
      "/sessions/current",
      async ({
        auth,
        authService,
      }: {
        auth: AuthContext;
        authService: AuthService;
      }) => {
        if (auth.session) {
          await authService.invalidateSession(auth.session.id);
          return { success: true };
        }
        return { success: false, error: "No active session" };
      }
    )

    // Invalidate all user sessions
    .delete(
      "/sessions/all",
      async ({
        auth,
        authService,
      }: {
        auth: AuthContext;
        authService: AuthService;
      }) => {
        if (auth.user) {
          await authService.invalidateAllUserSessions(auth.user.id);
          return { success: true };
        }
        return { success: false, error: "Not authenticated" };
      }
    );

  return app;
}

/**
 * Example 7: Custom User Service
 */
export class CustomUserService extends UserAuthService {
  public override async authenticate(
    credentials: LoginCredentials
  ): Promise<User | null> {
    // Add custom pre-authentication logic
    console.log(`Authentication attempt for: ${credentials.email}`);

    // Call parent authenticate method
    const result = await super.authenticate(credentials);

    if (result) {
      // Add custom post-authentication logic
      await this.updateUserLastSeen(result.id);
      console.log(`User ${result.username} authenticated successfully`);
    }

    return result;
  }

  private async updateUserLastSeen(userId: string) {
    // Update user's last seen timestamp
    console.log(`Updated last seen for user: ${userId}`);
  }
}

/**
 * Run examples
 */
export function runAllExamples() {
  console.log("=== Modern Authentication Examples ===\n");

  // Password utilities example
  passwordUtilsExample();

  console.log("\n=== Elysia App Examples ===");
  console.log("1. Basic Auth App:", !!basicAuthExample());
  console.log("2. Auth Routes App:", !!authenticationRoutesExample());
  console.log("3. RBAC App:", !!rbacExample());
  console.log("4. Full App:", !!fullApplicationExample());
  console.log("5. Session Management App:", !!sessionManagementExample());
  console.log(
    "6. Custom User Service:",
    !!new CustomUserService(new AuthService())
  );

  console.log("\n✅ All examples created successfully!");
}

// Export individual example creators
export {
  basicAuthExample as createBasicAuthApp,
  authenticationRoutesExample as createAuthRoutesApp,
  rbacExample as createRBACApp,
  fullApplicationExample as createFullApp,
  sessionManagementExample as createSessionManagementApp,
};
