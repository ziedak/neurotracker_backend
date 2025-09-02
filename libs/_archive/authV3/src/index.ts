/**
 * AuthV3 - Next-Generation Enterprise Authentication Library
 *
 * A security-first, enterprise-grade authentication library with comprehensive
 * features including JWT tokens, MFA, risk assessment, audit logging, and more.
 *
 * Key Features:
 * - Security-first design with battle-tested cryptographic libraries
 * - Comprehensive error handling and audit logging
 * - Enterprise features: MFA, API keys, risk assessment
 * - Distributed caching and session management
 * - Clean architecture with SOLID principles
 * - Full TypeScript support with strict typing
 *
 * @version 1.0.0
 * @author Enterprise Development Team
 */

// ==============================================================================
// TYPES AND INTERFACES
// ==============================================================================

export type {
  // Core Types
  User,
  UserId,
  Session,
  SessionId,
  TokenInfo,
  TokenId,
  APIKey,
  APIKeyId,
  DeviceId,
  TenantId,
  SecurityContext,
  GeoLocation,
  LoginRequest,
  LoginResponse,
  DeviceInfo,
  RiskAssessment,
  AuditEvent,
  RateLimit,

  // Configuration Types
  AuthConfig,
  JWTConfig,
  SessionConfig,
  PasswordConfig,
  MFAConfig,
  RateLimitConfig,
  SecurityConfig,
} from "./types/auth.types.js";

export {
  // Enums
  AuthStatus,
  TokenType,
  RiskLevel,
  AnomalyFlag,
  AuthEvent,

  // Schemas
  CredentialsSchema,
  PasswordStrengthSchema,
  MFATokenSchema,
  MFASetupSchema,
  TypeValidators,

  // Branded Type Creators
  createUserId,
  createSessionId,
  createTokenId,
  createAPIKeyId,
  createDeviceId,
  createTenantId,
} from "./types/auth.types.js";

// ==============================================================================
// SERVICE CONTRACTS
// ==============================================================================

export type {
  // Core Service Interfaces
  IAuthenticationService,
  ICredentialService,
  ISessionService,
  ITokenService,
  IMFAService,
  IAPIKeyService,
  IRiskAssessmentService,
  IRateLimitService,
  IAuditService,
  IAuthCacheService,
  IHealthService,

  // Repository Interfaces
  IUserRepository,
  ISessionRepository,
  IAPIKeyRepository,
} from "./contracts/auth.contracts.js";

// ==============================================================================
// ERROR CLASSES
// ==============================================================================

export {
  // Base Error Classes
  AuthError,
  SecurityError,

  // Authentication Errors
  InvalidCredentialsError,
  AccountLockedError,
  AccountDisabledError,
  MFARequiredError,
  InvalidMFATokenError,

  // Token Errors
  InvalidTokenError,
  ExpiredTokenError,
  TokenBlacklistedError,

  // Rate Limiting
  RateLimitExceededError,

  // Permissions
  InsufficientPermissionsError,

  // Session Errors
  SessionNotFoundError,
  SessionExpiredError,
  ConcurrentSessionLimitError,

  // Validation Errors
  ValidationError,
  WeakPasswordError,

  // System Errors
  ServiceUnavailableError,
  ConfigurationError,
  DatabaseError,
  CacheError,

  // Crypto Errors
  CryptoError,
  JWTSigningError,
  JWTVerificationError,

  // Utilities
  ErrorUtils,
} from "./errors/auth.errors.js";

export type { ErrorResponse, ErrorContext } from "./errors/auth.errors.js";

// ==============================================================================
// SERVICE IMPLEMENTATIONS (will be added as we implement them)
// ==============================================================================

// Core Services
export { AuthenticationService } from "./services/authentication.service.js";
export { CredentialService } from "./services/credential.service.js";
export { SessionService } from "./services/session.service.js";
export { TokenService } from "./services/token.service.js";

// Security Services
export { MFAService } from "./services/mfa.service.js";
export { APIKeyService } from "./services/apikey.service.js";
export { RiskAssessmentService } from "./services/risk-assessment.service.js";
export { RateLimitService } from "./services/rate-limit.service.js";

// Audit and Monitoring
export { AuditService } from "./services/audit.service.js";
export { HealthService } from "./services/health.service.js";

// Infrastructure Services
export { AuthCacheService } from "./services/cache.service.js";

// Repositories
export { UserRepository } from "./repositories/user.repository.js";
export { SessionRepository } from "./repositories/session.repository.js";
export { APIKeyRepository } from "./repositories/apikey.repository.js";

// Middleware
export { authMiddleware } from "./middleware/auth.middleware.js";
export { createAuthMiddleware } from "./middleware/middleware.factory.js";

// Utilities
export { AuthUtils } from "./utils/auth.utils.js";
export { CryptoUtils } from "./utils/crypto.utils.js";
export { ValidationUtils } from "./utils/validation.utils.js";

// ==============================================================================
// SERVICE REGISTRY INTEGRATION
// ==============================================================================

/**
 * Service registry keys for AuthV3 services
 */
export const AUTH_SERVICE_KEYS = {
  // Core Services
  AUTHENTICATION_SERVICE: "AuthV3.AuthenticationService",
  CREDENTIAL_SERVICE: "AuthV3.CredentialService",
  SESSION_SERVICE: "AuthV3.SessionService",
  TOKEN_SERVICE: "AuthV3.TokenService",

  // Security Services
  MFA_SERVICE: "AuthV3.MFAService",
  API_KEY_SERVICE: "AuthV3.APIKeyService",
  RISK_ASSESSMENT_SERVICE: "AuthV3.RiskAssessmentService",
  RATE_LIMIT_SERVICE: "AuthV3.RateLimitService",

  // Audit and Monitoring
  AUDIT_SERVICE: "AuthV3.AuditService",
  HEALTH_SERVICE: "AuthV3.HealthService",

  // Infrastructure
  CACHE_SERVICE: "AuthV3.CacheService",

  // Repositories
  USER_REPOSITORY: "AuthV3.UserRepository",
  SESSION_REPOSITORY: "AuthV3.SessionRepository",
  API_KEY_REPOSITORY: "AuthV3.APIKeyRepository",

  // Configuration
  AUTH_CONFIG: "AuthV3.Config",
} as const;

/**
 * Register all AuthV3 services with the service registry
 *
 * @param serviceRegistry - The service registry instance
 * @param config - Authentication configuration
 */
export function registerAuthServices(
  serviceRegistry: any, // Using any to avoid circular dependencies
  config: AuthConfig
): void {
  // Register configuration first
  serviceRegistry.registerInstance(AUTH_SERVICE_KEYS.AUTH_CONFIG, config);

  // Register repositories (they have no dependencies on other auth services)
  serviceRegistry.registerSingleton(AUTH_SERVICE_KEYS.USER_REPOSITORY, () => {
    return new UserRepository();
  });

  serviceRegistry.registerSingleton(
    AUTH_SERVICE_KEYS.SESSION_REPOSITORY,
    () => {
      return new SessionRepository();
    }
  );

  serviceRegistry.registerSingleton(
    AUTH_SERVICE_KEYS.API_KEY_REPOSITORY,
    () => {
      return new APIKeyRepository();
    }
  );

  // Register infrastructure services
  serviceRegistry.registerSingleton(AUTH_SERVICE_KEYS.CACHE_SERVICE, () => {
    return new AuthCacheService(config);
  });

  // Register core services
  serviceRegistry.registerSingleton(
    AUTH_SERVICE_KEYS.CREDENTIAL_SERVICE,
    () => {
      const userRepo = serviceRegistry.resolve(
        AUTH_SERVICE_KEYS.USER_REPOSITORY
      );
      return new CredentialService(userRepo, config.password);
    }
  );

  serviceRegistry.registerSingleton(AUTH_SERVICE_KEYS.TOKEN_SERVICE, () => {
    const cacheService = serviceRegistry.resolve(
      AUTH_SERVICE_KEYS.CACHE_SERVICE
    );
    return new TokenService(cacheService, config.jwt);
  });

  serviceRegistry.registerSingleton(AUTH_SERVICE_KEYS.SESSION_SERVICE, () => {
    const sessionRepo = serviceRegistry.resolve(
      AUTH_SERVICE_KEYS.SESSION_REPOSITORY
    );
    const cacheService = serviceRegistry.resolve(
      AUTH_SERVICE_KEYS.CACHE_SERVICE
    );
    return new SessionService(sessionRepo, cacheService, config.session);
  });

  // Register security services
  serviceRegistry.registerSingleton(
    AUTH_SERVICE_KEYS.RATE_LIMIT_SERVICE,
    () => {
      const cacheService = serviceRegistry.resolve(
        AUTH_SERVICE_KEYS.CACHE_SERVICE
      );
      return new RateLimitService(cacheService, config.rateLimit);
    }
  );

  serviceRegistry.registerSingleton(AUTH_SERVICE_KEYS.AUDIT_SERVICE, () => {
    return new AuditService();
  });

  serviceRegistry.registerSingleton(AUTH_SERVICE_KEYS.MFA_SERVICE, () => {
    const userRepo = serviceRegistry.resolve(AUTH_SERVICE_KEYS.USER_REPOSITORY);
    return new MFAService(userRepo, config.mfa);
  });

  serviceRegistry.registerSingleton(
    AUTH_SERVICE_KEYS.RISK_ASSESSMENT_SERVICE,
    () => {
      const cacheService = serviceRegistry.resolve(
        AUTH_SERVICE_KEYS.CACHE_SERVICE
      );
      const auditService = serviceRegistry.resolve(
        AUTH_SERVICE_KEYS.AUDIT_SERVICE
      );
      return new RiskAssessmentService(cacheService, auditService);
    }
  );

  serviceRegistry.registerSingleton(AUTH_SERVICE_KEYS.API_KEY_SERVICE, () => {
    const apiKeyRepo = serviceRegistry.resolve(
      AUTH_SERVICE_KEYS.API_KEY_REPOSITORY
    );
    const rateLimitService = serviceRegistry.resolve(
      AUTH_SERVICE_KEYS.RATE_LIMIT_SERVICE
    );
    return new APIKeyService(apiKeyRepo, rateLimitService);
  });

  // Register main authentication service (orchestrates all others)
  serviceRegistry.registerSingleton(
    AUTH_SERVICE_KEYS.AUTHENTICATION_SERVICE,
    () => {
      const credentialService = serviceRegistry.resolve(
        AUTH_SERVICE_KEYS.CREDENTIAL_SERVICE
      );
      const sessionService = serviceRegistry.resolve(
        AUTH_SERVICE_KEYS.SESSION_SERVICE
      );
      const tokenService = serviceRegistry.resolve(
        AUTH_SERVICE_KEYS.TOKEN_SERVICE
      );
      const mfaService = serviceRegistry.resolve(AUTH_SERVICE_KEYS.MFA_SERVICE);
      const riskAssessmentService = serviceRegistry.resolve(
        AUTH_SERVICE_KEYS.RISK_ASSESSMENT_SERVICE
      );
      const rateLimitService = serviceRegistry.resolve(
        AUTH_SERVICE_KEYS.RATE_LIMIT_SERVICE
      );
      const auditService = serviceRegistry.resolve(
        AUTH_SERVICE_KEYS.AUDIT_SERVICE
      );

      return new AuthenticationService(
        credentialService,
        sessionService,
        tokenService,
        mfaService,
        riskAssessmentService,
        rateLimitService,
        auditService,
        config
      );
    }
  );

  // Register health service (monitors all other services)
  serviceRegistry.registerSingleton(AUTH_SERVICE_KEYS.HEALTH_SERVICE, () => {
    return new HealthService(serviceRegistry);
  });
}

/**
 * Create a pre-configured authentication service instance
 *
 * @param config - Authentication configuration
 * @returns Configured authentication service
 */
export function createAuthenticationService(
  config: AuthConfig
): IAuthenticationService {
  // For standalone usage without service registry
  const userRepo = new UserRepository();
  const sessionRepo = new SessionRepository();
  const apiKeyRepo = new APIKeyRepository();
  const cacheService = new AuthCacheService(config);
  const auditService = new AuditService();

  const credentialService = new CredentialService(userRepo, config.password);
  const tokenService = new TokenService(cacheService, config.jwt);
  const sessionService = new SessionService(
    sessionRepo,
    cacheService,
    config.session
  );
  const rateLimitService = new RateLimitService(cacheService, config.rateLimit);
  const mfaService = new MFAService(userRepo, config.mfa);
  const riskAssessmentService = new RiskAssessmentService(
    cacheService,
    auditService
  );

  return new AuthenticationService(
    credentialService,
    sessionService,
    tokenService,
    mfaService,
    riskAssessmentService,
    rateLimitService,
    auditService,
    config
  );
}

// ==============================================================================
// VERSION AND METADATA
// ==============================================================================

export const VERSION = "1.0.0";
export const LIBRARY_NAME = "AuthV3";

/**
 * Library metadata
 */
export const METADATA = {
  name: LIBRARY_NAME,
  version: VERSION,
  description: "Next-generation enterprise authentication library",
  features: [
    "JWT token management with secure signing",
    "Multi-factor authentication (TOTP, SMS)",
    "API key management with rotation",
    "Risk assessment and anomaly detection",
    "Rate limiting and brute force protection",
    "Comprehensive audit logging",
    "Session management with Redis support",
    "Enterprise-grade security features",
    "Clean architecture with SOLID principles",
    "Full TypeScript support",
  ],
  security: {
    passwordHashing: "Argon2",
    jwtSigning: "JOSE library",
    randomGeneration: "Node.js crypto module",
    sessionStorage: "Redis with encryption",
  },
} as const;
