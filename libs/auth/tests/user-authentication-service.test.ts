/**
 * Unit Tests for UserAuthenticationService
 * Tests authentication flows: login, register, logout
 */

// Mock all services before any imports to avoid ES module issues
jest.mock("../src/services/keycloak-service", () => ({
  KeycloakService: jest.fn().mockImplementation(() => ({
    authenticateUserEnhanced: jest.fn(),
    registerUser: jest.fn(),
  })),
}));

jest.mock("../src/services/jwt-service", () => ({
  JWTService: jest.fn().mockImplementation(() => ({
    generateTokens: jest.fn(),
    revokeToken: jest.fn(),
    revokeAllUserTokens: jest.fn(),
  })),
}));

jest.mock("../src/services/session-service", () => ({
  SessionService: jest.fn().mockImplementation(() => ({
    createSession: jest.fn(),
    deleteUserSessions: jest.fn(),
  })),
}));

jest.mock("../src/services/password-policy-service", () => ({
  PasswordPolicyService: jest.fn().mockImplementation(() => ({
    validatePassword: jest.fn(),
  })),
}));

import { UserAuthenticationService } from "../src/services/user-authentication-service";
import { KeycloakService } from "../src/services/keycloak-service";
import { JWTService } from "../src/services/jwt-service";
import { SessionService } from "../src/services/session-service";
import { PasswordPolicyService } from "../src/services/password-policy-service";
import { AuthConfig, ServiceDependencies, User } from "../src/types";

describe("UserAuthenticationService", () => {
  let userAuthService: UserAuthenticationService;
  let mockKeycloakService: jest.Mocked<KeycloakService>;
  let mockJwtService: jest.Mocked<JWTService>;
  let mockSessionService: jest.Mocked<SessionService>;
  let mockPasswordPolicyService: jest.Mocked<PasswordPolicyService>;
  let mockDeps: ServiceDependencies;
  let mockConfig: AuthConfig;

  const mockUser: User = {
    id: "test-user-id",
    email: "test@example.com",
    name: "Test User",
    roles: ["user"],
    permissions: ["read:own-data"],
    metadata: {},
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockAuthResult = {
    success: true,
    user: mockUser,
    tokens: {
      accessToken: "mock-access-token",
      refreshToken: "mock-refresh-token",
      expiresIn: 3600,
      tokenType: "Bearer" as const,
    },
  };

  beforeEach(() => {
    // Create mock dependencies
    mockDeps = (global as any).testUtils.createMockDeps();
    mockConfig = (global as any).testUtils.createMockAuthConfig();

    // Create mock service instances
    mockKeycloakService = new KeycloakService(
      mockConfig,
      mockDeps
    ) as jest.Mocked<KeycloakService>;
    mockJwtService = new JWTService(
      mockConfig,
      mockDeps
    ) as jest.Mocked<JWTService>;
    mockSessionService = new SessionService(
      mockConfig,
      mockDeps
    ) as jest.Mocked<SessionService>;
    mockPasswordPolicyService = new PasswordPolicyService(
      mockConfig,
      mockDeps
    ) as jest.Mocked<PasswordPolicyService>;

    // Setup service mocks
    mockKeycloakService.authenticateUserEnhanced.mockResolvedValue(
      mockAuthResult
    );
    mockKeycloakService.registerUser.mockResolvedValue(mockAuthResult);
    mockJwtService.generateTokens.mockResolvedValue(mockAuthResult.tokens!);
    mockJwtService.revokeToken.mockResolvedValue(undefined);
    mockJwtService.revokeAllUserTokens.mockResolvedValue(undefined);
    mockSessionService.createSession.mockResolvedValue({
      id: "session-id",
      userId: mockUser.id,
      deviceInfo: { name: "test-device" },
      isActive: true,
      createdAt: new Date(),
      lastActivity: new Date(),
      expiresAt: new Date(Date.now() + 3600000),
    });
    mockSessionService.deleteUserSessions.mockResolvedValue(true);
    mockPasswordPolicyService.validatePassword.mockResolvedValue({
      isValid: true,
      strength: "strong",
      score: 85,
      errors: [],
      suggestions: [],
    });

    // Create service instance
    userAuthService = new UserAuthenticationService(mockDeps, {
      keycloakService: mockKeycloakService,
      jwtService: mockJwtService,
      sessionService: mockSessionService,
      passwordPolicyService: mockPasswordPolicyService,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("login", () => {
    const validCredentials = {
      email: "test@example.com",
      password: "ValidPassword123!",
      deviceInfo: {
        name: "test-device",
        type: "desktop" as const,
        os: "macOS",
        browser: "Chrome",
      },
    };

    it("should successfully login with valid credentials", async () => {
      const result = await userAuthService.login(validCredentials);

      expect(result.success).toBe(true);
      expect(result.user).toEqual(mockUser);
      expect(result.tokens).toEqual(mockAuthResult.tokens);
      expect(mockKeycloakService.authenticateUserEnhanced).toHaveBeenCalledWith(
        validCredentials.email,
        validCredentials.password
      );
      expect(mockJwtService.generateTokens).toHaveBeenCalledWith(mockUser);
    });

    it("should handle login failure from Keycloak", async () => {
      const failureResult = {
        success: false,
        error: "Invalid credentials",
        code: "INVALID_CREDENTIALS",
      };
      mockKeycloakService.authenticateUserEnhanced.mockResolvedValue(
        failureResult
      );

      const result = await userAuthService.login(validCredentials);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Authentication failed");
      expect(result.code).toBe("AUTHENTICATION_FAILED");
      expect(mockJwtService.generateTokens).not.toHaveBeenCalled();
    });

    it("should handle login without device info", async () => {
      const credentialsWithoutDevice = {
        email: "test@example.com",
        password: "ValidPassword123!",
      };

      const result = await userAuthService.login(credentialsWithoutDevice);

      expect(result.success).toBe(true);
      expect(mockKeycloakService.authenticateUserEnhanced).toHaveBeenCalledWith(
        credentialsWithoutDevice.email,
        credentialsWithoutDevice.password
      );
    });

    it("should handle service errors gracefully", async () => {
      mockKeycloakService.authenticateUserEnhanced.mockRejectedValue(
        new Error("Service unavailable")
      );

      const result = await userAuthService.login(validCredentials);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Service unavailable");
      expect(result.code).toBe("AUTHENTICATION_ERROR");
    });
  });

  describe("register", () => {
    const validRegistrationData = {
      email: "newuser@example.com",
      password: "ValidPassword123!",
      name: "New User",
      roles: ["user"],
      metadata: {
        department: "engineering",
      },
    };

    it("should successfully register new user", async () => {
      const result = await userAuthService.register(validRegistrationData);

      expect(result.success).toBe(true);
      expect(result.user).toEqual(mockUser);
      expect(result.tokens).toEqual(mockAuthResult.tokens);
      expect(mockKeycloakService.registerUser).toHaveBeenCalledWith(
        validRegistrationData
      );
      expect(mockJwtService.generateTokens).toHaveBeenCalledWith(mockUser);
    });

    it("should handle registration failure from Keycloak", async () => {
      const failureResult = {
        success: false,
        error: "User already exists",
        code: "USER_EXISTS",
      };
      mockKeycloakService.registerUser.mockResolvedValue(failureResult);

      const result = await userAuthService.register(validRegistrationData);

      expect(result.success).toBe(false);
      expect(result.error).toBe("User registration failed");
      expect(result.code).toBe("REGISTRATION_FAILED");
      expect(mockJwtService.generateTokens).not.toHaveBeenCalled();
    });

    it("should handle registration without optional fields", async () => {
      const minimalRegistrationData = {
        email: "newuser@example.com",
        password: "ValidPassword123!",
        name: "New User",
      };

      const result = await userAuthService.register(minimalRegistrationData);

      expect(result.success).toBe(true);
      expect(mockKeycloakService.registerUser).toHaveBeenCalledWith({
        email: "newuser@example.com",
        password: "ValidPassword123!",
        name: "New User",
        roles: ["user"],
      });
    });

    it("should handle service errors gracefully", async () => {
      mockKeycloakService.registerUser.mockRejectedValue(
        new Error("Registration service error")
      );

      const result = await userAuthService.register(validRegistrationData);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Registration service error");
      expect(result.code).toBe("REGISTRATION_ERROR");
    });
  });

  describe("logout", () => {
    it("should successfully logout with token", async () => {
      mockJwtService.revokeToken.mockResolvedValue(undefined);

      const result = await userAuthService.logout("user-id", "token");

      expect(result).toBe(true);
      expect(mockJwtService.revokeToken).toHaveBeenCalledWith("token");
    });

    it("should successfully logout without token", async () => {
      mockJwtService.revokeAllUserTokens.mockResolvedValue(undefined);

      const result = await userAuthService.logout("user-id");

      expect(result).toBe(true);
      expect(mockSessionService.deleteUserSessions).toHaveBeenCalledWith(
        "user-id"
      );
    });

    it("should handle logout failure gracefully", async () => {
      mockJwtService.revokeToken.mockRejectedValue(new Error("Revoke failed"));

      const result = await userAuthService.logout("user-id", "token");

      expect(result).toBe(false);
      expect(mockDeps.monitoring.logger.error).toHaveBeenCalled();
    });
  });

  describe("password policy integration", () => {
    it("should validate password when policy service is available", async () => {
      const credentials = {
        email: "test@example.com",
        password: "ValidPassword123!",
      };

      mockPasswordPolicyService.validatePassword.mockResolvedValue({
        isValid: true,
        strength: "strong",
        score: 85,
        errors: [],
        suggestions: [],
      });

      await userAuthService.login(credentials);

      expect(mockPasswordPolicyService.validatePassword).toHaveBeenCalledWith(
        credentials.password,
        { email: credentials.email }
      );
    });

    it("should skip password validation when policy service is not available", async () => {
      // Create service without password policy
      const userAuthServiceNoPolicy = new UserAuthenticationService(mockDeps, {
        keycloakService: mockKeycloakService,
        jwtService: mockJwtService,
        sessionService: mockSessionService,
        // No passwordPolicyService
      });

      const credentials = {
        email: "test@example.com",
        password: "ValidPassword123!",
      };

      await userAuthServiceNoPolicy.login(credentials);

      // Password policy should not be called
      expect(mockPasswordPolicyService.validatePassword).not.toHaveBeenCalled();
    });
  });

  describe("session management integration", () => {
    it("should create session on successful login", async () => {
      const credentials = {
        email: "test@example.com",
        password: "ValidPassword123!",
        deviceInfo: {
          name: "test-device",
          type: "desktop" as const,
        },
      };

      await userAuthService.login(credentials);

      expect(mockSessionService.createSession).toHaveBeenCalledWith(
        mockUser.id,
        credentials.deviceInfo
      );
    });
  });

  describe("error handling", () => {
    it("should handle network errors", async () => {
      mockKeycloakService.authenticateUserEnhanced.mockRejectedValue(
        new Error("Network timeout")
      );

      const result = await userAuthService.login({
        email: "test@example.com",
        password: "password",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Network timeout");
      expect(result.code).toBe("AUTHENTICATION_ERROR");
    });

    it("should handle malformed responses", async () => {
      mockKeycloakService.authenticateUserEnhanced.mockResolvedValue({
        success: false,
        error: "Invalid response format",
        code: "MALFORMED_RESPONSE",
      });

      const result = await userAuthService.login({
        email: "test@example.com",
        password: "password",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Authentication failed");
      expect(result.code).toBe("AUTHENTICATION_FAILED");
    });
  });
});
