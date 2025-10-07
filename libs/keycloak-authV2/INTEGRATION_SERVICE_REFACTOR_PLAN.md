# KeycloakIntegrationService Refactor Plan

**Project**: Neurotracker Backend  
**Library**: @libs/keycloak-authV2  
**Target**: KeycloakIntegrationService Enhancement  
**Version**: 2.0.0 → 2.1.0  
**Date**: October 7, 2025  
**Status**: 🟡 Planning

---

## 📋 Executive Summary

### Current State

- ✅ Good SOLID architecture with component-based design
- ❌ Missing API Key management (critical functionality)
- ❌ Incomplete session management exposure
- ❌ Limited user management operations
- ⚠️ Cache service disabled (performance impact)
- ⚠️ Complex constructor (testability issues)

### Target State

- ✅ Full API Key management integration
- ✅ Complete session lifecycle operations
- ✅ Comprehensive user management via UserFacade
- ✅ Proper cache integration
- ✅ Builder pattern for flexible construction
- ✅ 100% interface compliance
- ✅ Enhanced testability and maintainability

### Success Metrics

- **API Coverage**: 40% → 95%
- **Test Coverage**: Current → >85%
- **Cache Hit Rate**: 0% → >70%
- **Build Time**: No regression
- **Breaking Changes**: Zero (backward compatible)

---

## 🎯 Objectives & Goals

### Primary Objectives

1. **API Completeness**: Expose all promised functionality (auth, session, API key, user management)
2. **Performance**: Enable caching across all operations
3. **Maintainability**: Simplify construction and dependency management
4. **Testability**: Make service fully mockable and testable
5. **Backward Compatibility**: Ensure zero breaking changes for existing consumers

### Non-Goals

- Changing existing component implementations
- Modifying core KeycloakClient behavior
- Refactoring session/user/apikey internal logic
- Breaking API changes

---

## 📊 Architecture Overview

### Current Architecture

```
KeycloakIntegrationService
├── ✅ AuthenticationManager (exposed)
├── ✅ SessionValidator (exposed - partial)
├── ✅ UserManager (exposed - limited)
├── ❌ APIKeyManager (missing!)
├── ✅ ResourceManager (exposed)
├── ✅ ConfigurationManager (internal)
├── ✅ StatisticsCollector (exposed)
├── ✅ InputValidator (internal)
└── ⚠️ SessionManager (internal - should expose more)
```

### Target Architecture

```
KeycloakIntegrationService (Orchestrator)
├── ✅ AuthenticationManager → Auth flows
├── ✅ SessionManager → Full session lifecycle
├── ✅ UserFacade → Complete user operations
├── ✅ APIKeyManager → API key CRUD + validation
├── ✅ ResourceManager → Health + lifecycle
├── ✅ ConfigurationManager → Config management
├── ✅ StatisticsCollector → Metrics + stats
└── ✅ InputValidator → Validation + sanitization

Dependencies (Injected):
├── KeycloakClient
├── PostgreSQLClient
├── CacheService (optional)
├── IMetricsCollector (optional)
└── UserSyncService (optional)
```

---

## 🔄 Implementation Phases

### Phase 1: Foundation & Preparation (2-3 hours)

**Goal**: Prepare infrastructure and fix critical issues

#### Task 1.1: Fix Cache Service Integration

- **File**: `KeycloakIntegrationService.ts`
- **Changes**: Accept CacheService as constructor parameter
- **Impact**: Low risk, high value
- **Dependencies**: None

```typescript
// Before
constructor(
  private readonly keycloakOptions: KeycloakConnectionOptions,
  private readonly dbClient: PostgreSQLClient,
  private readonly metrics?: IMetricsCollector
)

// After
constructor(
  private readonly keycloakOptions: KeycloakConnectionOptions,
  private readonly dbClient: PostgreSQLClient,
  private readonly cacheService?: CacheService,
  private readonly metrics?: IMetricsCollector,
  private readonly syncService?: UserSyncService
)
```

**Validation**:

- [ ] Constructor accepts CacheService
- [ ] CacheService passed to SessionManager
- [ ] CacheService passed to APIKeyManager
- [ ] Backward compatible (optional parameter)

---

#### Task 1.2: Update Interface Definitions

- **File**: `interfaces.ts`
- **Changes**: Add missing interfaces
- **Impact**: No runtime impact
- **Dependencies**: None

**Add**:

```typescript
export interface IAPIKeyManager {
  createAPIKey(options: APIKeyGenerationOptions): Promise<ApiKey>;
  validateAPIKey(apiKey: string): Promise<APIKeyValidationResult>;
  revokeAPIKey(
    keyId: string,
    reason: string,
    revokedBy?: string
  ): Promise<void>;
  getAPIKey(keyId: string): Promise<ApiKey | null>;
  listAPIKeys(userId: string): Promise<ApiKey[]>;
  updateAPIKey(keyId: string, updates: Partial<ApiKey>): Promise<ApiKey>;
  getUsageStats(keyId: string): Promise<any>;
}

export interface ISessionManager extends ISessionValidator {
  createSession(userId: string, tokens: any, context: any): Promise<AuthResult>;
  refreshSessionTokens(sessionData: UserSession): Promise<any>;
  destroySession(sessionId: string, reason?: string): Promise<any>;
  getSessionStats(): Promise<SessionStats>;
}

export interface IIntegrationService
  extends IAuthenticationManager,
    ISessionManager, // Extended from ISessionValidator
    IUserManager,
    IAPIKeyManager, // NEW
    IResourceManager {
  getStats(): Promise<IntegrationStats>;
  clearCaches(): void;
  checkHealth(): Promise<any>;
  getSystemInfo(): any;
}
```

**Validation**:

- [ ] Interfaces compile without errors
- [ ] No breaking changes to existing interfaces
- [ ] All methods properly typed

---

### Phase 2: API Key Integration (3-4 hours)

**Goal**: Integrate APIKeyManager into KeycloakIntegrationService

#### Task 2.1: Add APIKeyManager Instance

- **File**: `KeycloakIntegrationService.ts`
- **Changes**: Initialize APIKeyManager in constructor
- **Impact**: Medium
- **Dependencies**: Task 1.1 (cache service)

```typescript
export class KeycloakIntegrationService implements IIntegrationService {
  // Add private field
  private readonly apiKeyManager: APIKeyManager;

  constructor(...) {
    // ... existing initialization ...

    // Initialize API Key Manager (after dbClient and cacheService are available)
    this.apiKeyManager = new APIKeyManager(
      this.logger.child({ component: "APIKeyManager" }),
      this.metrics || createNullMetrics(),
      this.dbClient,
      this.cacheService,
      {
        features: {
          enableCaching: !!this.cacheService,
          enableUsageTracking: !!this.metrics,
          enableSecurityMonitoring: true,
          enableHealthMonitoring: true,
        },
      }
    );

    this.logger.info("API Key Manager initialized", {
      cachingEnabled: !!this.cacheService,
      metricsEnabled: !!this.metrics,
    });
  }
}
```

**Validation**:

- [ ] APIKeyManager initializes without errors
- [ ] Logger shows initialization message
- [ ] Metrics collector is passed correctly
- [ ] Cache service is used when available

---

#### Task 2.2: Implement IAPIKeyManager Methods

- **File**: `KeycloakIntegrationService.ts`
- **Changes**: Delegate to APIKeyManager
- **Impact**: Low (simple delegation)
- **Dependencies**: Task 2.1

```typescript
// IAPIKeyManager implementation
async createAPIKey(options: APIKeyGenerationOptions): Promise<ApiKey> {
  return this.apiKeyManager.createAPIKey(options);
}

async validateAPIKey(apiKey: string): Promise<APIKeyValidationResult> {
  return this.apiKeyManager.validateAPIKey(apiKey);
}

async revokeAPIKey(
  keyId: string,
  reason: string,
  revokedBy?: string
): Promise<void> {
  return this.apiKeyManager.revokeAPIKey(keyId, reason, revokedBy);
}

async getAPIKey(keyId: string): Promise<ApiKey | null> {
  return this.apiKeyManager.getAPIKey(keyId);
}

async listAPIKeys(userId: string): Promise<ApiKey[]> {
  return this.apiKeyManager.listAPIKeys(userId);
}

async updateAPIKey(keyId: string, updates: Partial<ApiKey>): Promise<ApiKey> {
  return this.apiKeyManager.updateAPIKey(keyId, updates);
}

async getAPIKeyUsageStats(keyId: string): Promise<any> {
  return this.apiKeyManager.getUsageStats(keyId);
}

async getAPIKeyHealthStatus(): Promise<SystemHealth | null> {
  return this.apiKeyManager.getHealthStatus();
}
```

**Validation**:

- [ ] All IAPIKeyManager methods implemented
- [ ] Methods properly delegate to apiKeyManager
- [ ] Error handling preserved
- [ ] Metrics recorded for each operation

---

#### Task 2.3: Update Cleanup Logic

- **File**: `KeycloakIntegrationService.ts`
- **Changes**: Add APIKeyManager cleanup
- **Impact**: Low
- **Dependencies**: Task 2.1

```typescript
async cleanup(): Promise<void> {
  this.logger.info("Starting KeycloakIntegrationService cleanup");

  try {
    // Cleanup API Key Manager
    if (this.apiKeyManager) {
      await this.apiKeyManager.cleanup();
      this.logger.info("API Key Manager cleaned up");
    }

    // Existing cleanup logic
    return this.resourceManager.cleanup();
  } catch (error) {
    this.logger.error("Cleanup failed", { error });
    throw error;
  }
}
```

**Validation**:

- [ ] APIKeyManager cleanup called
- [ ] No memory leaks
- [ ] Graceful shutdown

---

### Phase 3: Session Management Enhancement (2-3 hours)

**Goal**: Expose complete session lifecycle operations

#### Task 3.1: Expose Session Creation

- **File**: `KeycloakIntegrationService.ts`
- **Changes**: Add public session creation method
- **Impact**: Low (already exists internally)
- **Dependencies**: None

```typescript
/**
 * Create a new session for a user
 * Public API for external session creation
 */
async createUserSession(
  userId: string,
  tokens: {
    accessToken: string;
    refreshToken?: string;
    idToken?: string;
    expiresAt: Date;
    refreshExpiresAt?: Date;
  },
  requestContext: {
    ipAddress: string;
    userAgent: string;
    fingerprint?: Record<string, string>;
  }
): Promise<AuthResult> {
  const startTime = performance.now();

  try {
    const result = await this.sessionManager.createSession(
      userId,
      tokens,
      requestContext
    );

    this.metrics?.recordTimer(
      "integration.create_session_duration",
      performance.now() - startTime
    );
    this.metrics?.recordCounter("integration.create_session_success", 1);

    return result;
  } catch (error) {
    this.metrics?.recordCounter("integration.create_session_error", 1);
    this.logger.error("Session creation failed", { error, userId });
    throw error;
  }
}
```

**Validation**:

- [ ] Session creation exposed publicly
- [ ] Proper metrics recording
- [ ] Error handling consistent
- [ ] Documentation clear

---

#### Task 3.2: Expose Token Refresh

- **File**: `KeycloakIntegrationService.ts`
- **Changes**: Add public token refresh method
- **Impact**: Low
- **Dependencies**: None

```typescript
/**
 * Refresh session tokens
 * Updates session with new access/refresh tokens
 */
async refreshSessionTokens(sessionData: UserSession): Promise<{
  success: boolean;
  sessionData?: UserSession;
  reason?: string;
}> {
  return this.sessionManager.refreshSessionTokens(sessionData);
}

/**
 * Refresh session tokens by session ID
 * Convenience method that fetches session first
 */
async refreshSessionById(sessionId: string): Promise<{
  success: boolean;
  sessionData?: UserSession;
  reason?: string;
}> {
  const validation = await this.sessionManager.validateSession(sessionId);

  if (!validation.isValid || !validation.sessionData) {
    return {
      success: false,
      reason: validation.reason || "Session not found or invalid",
    };
  }

  return this.sessionManager.refreshSessionTokens(validation.sessionData);
}
```

**Validation**:

- [ ] Token refresh exposed
- [ ] Both variants available
- [ ] Proper error handling
- [ ] Session validation integrated

---

#### Task 3.3: Expose Session Destruction

- **File**: `KeycloakIntegrationService.ts`
- **Changes**: Add public session destruction method
- **Impact**: Low
- **Dependencies**: None

```typescript
/**
 * Destroy a session (admin operation)
 * Does not perform Keycloak logout
 */
async destroySession(
  sessionId: string,
  reason: string = "admin_action"
): Promise<{ success: boolean; reason?: string }> {
  const startTime = performance.now();

  try {
    const result = await this.sessionManager.destroySession(sessionId, reason);

    this.metrics?.recordTimer(
      "integration.destroy_session_duration",
      performance.now() - startTime
    );
    this.metrics?.recordCounter("integration.destroy_session_success", 1);

    return result;
  } catch (error) {
    this.metrics?.recordCounter("integration.destroy_session_error", 1);
    this.logger.error("Session destruction failed", { error, sessionId });
    return {
      success: false,
      reason: "Session destruction failed",
    };
  }
}
```

**Validation**:

- [ ] Session destruction exposed
- [ ] Admin-safe operation
- [ ] Metrics recorded
- [ ] Error handling robust

---

#### Task 3.4: Expose Session Statistics

- **File**: `KeycloakIntegrationService.ts`
- **Changes**: Update getStats to include session stats
- **Impact**: Low
- **Dependencies**: None

```typescript
/**
 * Get comprehensive session statistics
 */
async getSessionStatistics(): Promise<SessionStats> {
  return this.sessionManager.getSessionStats();
}

// Update existing getStats method
async getStats(): Promise<IntegrationStats> {
  const stats = await this.statisticsCollector.getStats();

  // Add session statistics
  const sessionStats = await this.getSessionStatistics();

  // Add API key statistics if available
  const apiKeyHealth = await this.apiKeyManager.getHealthStatus();

  return {
    ...stats,
    session: sessionStats,
    apiKey: apiKeyHealth || undefined,
  };
}
```

**Validation**:

- [ ] Session stats exposed
- [ ] Integrated into overall stats
- [ ] API key stats included
- [ ] No performance impact

---

### Phase 4: User Management Enhancement (3-4 hours)

**Goal**: Replace UserManager with UserFacade for complete user operations

#### Task 4.1: Replace UserManager with UserFacade

- **File**: `KeycloakIntegrationService.ts`
- **Changes**: Use UserFacade instead of UserManager component
- **Impact**: Medium (interface change)
- **Dependencies**: Task 1.1 (sync service)

```typescript
export class KeycloakIntegrationService implements IIntegrationService {
  // Remove: private readonly userManager: UserManager;
  // Add: private readonly userFacade: UserFacade;
  private readonly userFacade: UserFacade;

  constructor(...) {
    // ... existing setup ...

    // Create UserFacade instead of UserManager
    this.userFacade = UserFacade.create(
      this.keycloakClient,
      this.userService,
      this.dbClient.prisma,
      this.syncService,  // Use injected sync service
      this.metrics
    );

    // Update AuthenticationManager to use UserFacade as user lookup service
    this.authenticationManager = new AuthenticationManager(
      this.keycloakClient,
      this.sessionManager,
      this.userFacade,  // UserFacade implements IUserLookupService
      this.inputValidator,
      metrics
    );
  }
}
```

**Validation**:

- [ ] UserFacade initialized correctly
- [ ] AuthenticationManager accepts UserFacade
- [ ] Sync service integrated
- [ ] No runtime errors

---

#### Task 4.2: Implement Extended User Operations

- **File**: `KeycloakIntegrationService.ts`
- **Changes**: Add comprehensive user management methods
- **Impact**: Low (delegation)
- **Dependencies**: Task 4.1

```typescript
// IUserManager implementation (enhanced)

// Existing methods (keep backward compatible)
async createUser(userData: {
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  password?: string;
  enabled?: boolean;
  emailVerified?: boolean;
  attributes?: Record<string, string[]>;
}): Promise<{ success: boolean; userId?: string; error?: string }> {
  try {
    // Map to RegisterUserInput
    const registerData: RegisterUserInput = {
      username: userData.username,
      email: userData.email,
      password: userData.password || '',
      firstName: userData.firstName,
      lastName: userData.lastName,
    };

    const user = await this.userFacade.registerUser(registerData);

    return {
      success: true,
      userId: user.id,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'User creation failed',
    };
  }
}

async getUser(userId: string): Promise<{
  success: boolean;
  user?: any;
  error?: string;
}> {
  try {
    const user = await this.userFacade.getUserById(userId);

    if (!user) {
      return { success: false, error: 'User not found' };
    }

    return { success: true, user };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'User retrieval failed',
    };
  }
}

// NEW methods (extended functionality)

/**
 * Register a new user (comprehensive registration)
 */
async registerUser(data: RegisterUserInput): Promise<User> {
  return this.userFacade.registerUser(data);
}

/**
 * Update user information
 */
async updateUser(userId: string, data: UserUpdateInput): Promise<User> {
  return this.userFacade.updateUser(userId, data);
}

/**
 * Delete user (soft delete)
 */
async deleteUser(userId: string, deletedBy: string): Promise<void> {
  return this.userFacade.deleteUser(userId, deletedBy);
}

/**
 * Update user password
 */
async updateUserPassword(userId: string, newPassword: string): Promise<void> {
  return this.userFacade.updatePassword(userId, newPassword);
}

/**
 * Assign realm roles to user
 */
async assignUserRealmRoles(userId: string, roleNames: string[]): Promise<void> {
  return this.userFacade.assignRealmRoles(userId, roleNames);
}

/**
 * Remove realm roles from user
 */
async removeUserRealmRoles(userId: string, roleNames: string[]): Promise<void> {
  return this.userFacade.removeRealmRoles(userId, roleNames);
}

/**
 * Search users with filters
 */
async searchUsers(options: SearchUsersOptions): Promise<User[]> {
  return this.userFacade.searchUsers(options);
}

/**
 * Get user synchronization status
 */
async getUserSyncStatus(userId: string): Promise<SyncStatus> {
  return this.userFacade.getUserSyncStatus(userId);
}

/**
 * Get overall sync health
 */
async getSyncHealthStatus(): Promise<HealthStatus> {
  return this.userFacade.getSyncHealthStatus();
}

/**
 * Retry failed sync operations
 */
async retrySyncOperations(limit: number = 10): Promise<number> {
  return this.userFacade.retrySyncOperations(limit);
}

/**
 * Get user by username
 */
async getUserByUsername(username: string): Promise<User | null> {
  return this.userFacade.getUserByUsername(username);
}

/**
 * Get user by email
 */
async getUserByEmail(email: string): Promise<User | null> {
  return this.userFacade.getUserByEmail(email);
}

/**
 * Get user statistics
 */
async getUserStatistics(): Promise<any> {
  return this.userFacade.getUserStats();
}
```

**Validation**:

- [ ] All UserFacade methods exposed
- [ ] Backward compatibility maintained
- [ ] Error handling consistent
- [ ] Documentation complete

---

### Phase 5: Builder Pattern Implementation (2-3 hours)

**Goal**: Simplify service construction and improve testability

#### Task 5.1: Create Builder Class

- **File**: `KeycloakIntegrationServiceBuilder.ts` (new file)
- **Changes**: Implement builder pattern
- **Impact**: Low (optional, backward compatible)
- **Dependencies**: All previous phases

```typescript
/**
 * Builder for KeycloakIntegrationService
 * Provides fluent API for service construction with validation
 */
export class KeycloakIntegrationServiceBuilder {
  private keycloakOptions?: KeycloakConnectionOptions;
  private dbClient?: PostgreSQLClient;
  private cacheService?: CacheService;
  private metrics?: IMetricsCollector;
  private syncService?: UserSyncService;
  private logger?: ILogger;

  /**
   * Set Keycloak connection options (required)
   */
  withKeycloakOptions(options: KeycloakConnectionOptions): this {
    this.keycloakOptions = options;
    return this;
  }

  /**
   * Set database client (required)
   */
  withDatabase(client: PostgreSQLClient): this {
    this.dbClient = client;
    return this;
  }

  /**
   * Set cache service (optional, recommended for production)
   */
  withCache(cache: CacheService): this {
    this.cacheService = cache;
    return this;
  }

  /**
   * Set metrics collector (optional, recommended for production)
   */
  withMetrics(metrics: IMetricsCollector): this {
    this.metrics = metrics;
    return this;
  }

  /**
   * Set user sync service (optional, required for user sync features)
   */
  withSyncService(sync: UserSyncService): this {
    this.syncService = sync;
    return this;
  }

  /**
   * Set custom logger (optional)
   */
  withLogger(logger: ILogger): this {
    this.logger = logger;
    return this;
  }

  /**
   * Validate configuration before building
   */
  private validate(): void {
    if (!this.keycloakOptions) {
      throw new Error(
        "Keycloak options are required. Call withKeycloakOptions() first."
      );
    }

    if (!this.dbClient) {
      throw new Error(
        "Database client is required. Call withDatabase() first."
      );
    }

    // Validation checks
    if (!this.keycloakOptions.serverUrl) {
      throw new Error("Keycloak serverUrl is required");
    }

    if (!this.keycloakOptions.realm) {
      throw new Error("Keycloak realm is required");
    }

    if (!this.keycloakOptions.clientId) {
      throw new Error("Keycloak clientId is required");
    }
  }

  /**
   * Build the KeycloakIntegrationService instance
   */
  build(): KeycloakIntegrationService {
    this.validate();

    const logger = this.logger || createLogger("KeycloakIntegrationService");

    logger.info("Building KeycloakIntegrationService", {
      hasCache: !!this.cacheService,
      hasMetrics: !!this.metrics,
      hasSyncService: !!this.syncService,
    });

    return new KeycloakIntegrationService(
      this.keycloakOptions!,
      this.dbClient!,
      this.cacheService,
      this.metrics,
      this.syncService
    );
  }

  /**
   * Build with default production configuration
   */
  buildProduction(): KeycloakIntegrationService {
    if (!this.cacheService) {
      throw new Error(
        "Cache service is required for production. Call withCache() first."
      );
    }

    if (!this.metrics) {
      throw new Error(
        "Metrics collector is required for production. Call withMetrics() first."
      );
    }

    return this.build();
  }

  /**
   * Build with minimal configuration (for development/testing)
   */
  buildDevelopment(): KeycloakIntegrationService {
    this.validate();

    const logger = createLogger("KeycloakIntegrationService", {
      level: "debug",
    });

    return new KeycloakIntegrationService(
      this.keycloakOptions!,
      this.dbClient!,
      undefined, // No cache
      undefined, // No metrics
      undefined // No sync service
    );
  }
}

/**
 * Create a new builder instance
 */
export function createIntegrationServiceBuilder(): KeycloakIntegrationServiceBuilder {
  return new KeycloakIntegrationServiceBuilder();
}
```

**Validation**:

- [ ] Builder compiles without errors
- [ ] Fluent API works correctly
- [ ] Validation catches missing required params
- [ ] Production/development modes work

---

#### Task 5.2: Update Service Constructor

- **File**: `KeycloakIntegrationService.ts`
- **Changes**: Accept additional optional parameters
- **Impact**: Low (backward compatible)
- **Dependencies**: Task 5.1

```typescript
constructor(
  private readonly keycloakOptions: KeycloakConnectionOptions,
  private readonly dbClient: PostgreSQLClient,
  private readonly cacheService?: CacheService,
  private readonly metrics?: IMetricsCollector,
  private readonly syncService?: UserSyncService
) {
  // Constructor implementation remains the same
  // Just uses the new optional parameters
}

// Keep static create method for backward compatibility
static create(
  keycloakOptions: KeycloakConnectionOptions,
  dbClient: PostgreSQLClient,
  metrics?: IMetricsCollector
): KeycloakIntegrationService {
  return new KeycloakIntegrationService(
    keycloakOptions,
    dbClient,
    undefined, // No cache (backward compatible)
    metrics
  );
}

// Add new static create method with all options
static createWithOptions(
  keycloakOptions: KeycloakConnectionOptions,
  dbClient: PostgreSQLClient,
  options: {
    cacheService?: CacheService;
    metrics?: IMetricsCollector;
    syncService?: UserSyncService;
  }
): KeycloakIntegrationService {
  return new KeycloakIntegrationService(
    keycloakOptions,
    dbClient,
    options.cacheService,
    options.metrics,
    options.syncService
  );
}
```

**Validation**:

- [ ] Existing create() method still works
- [ ] New createWithOptions() method available
- [ ] Constructor accepts all parameters
- [ ] Backward compatibility maintained

---

#### Task 5.3: Update Documentation

- **File**: `KeycloakIntegrationService.ts` (JSDoc)
- **Changes**: Document builder pattern usage
- **Impact**: None (documentation only)
- **Dependencies**: Task 5.1, 5.2

````typescript
/**
 * Keycloak Integration Service - SOLID Compliant Architecture
 *
 * Main facade orchestrating all integration components:
 * - Authentication (password, OAuth code flows)
 * - Session management (full lifecycle)
 * - User management (comprehensive CRUD)
 * - API Key management (create, validate, revoke)
 * - Resource management (health, cleanup)
 *
 * @example Basic Usage (backward compatible)
 * ```typescript
 * const service = KeycloakIntegrationService.create(
 *   keycloakOptions,
 *   dbClient,
 *   metrics
 * );
 * await service.initialize();
 * ```
 *
 * @example Builder Pattern (recommended)
 * ```typescript
 * const service = createIntegrationServiceBuilder()
 *   .withKeycloakOptions(keycloakOptions)
 *   .withDatabase(dbClient)
 *   .withCache(cacheService)
 *   .withMetrics(metrics)
 *   .withSyncService(syncService)
 *   .build();
 * await service.initialize();
 * ```
 *
 * @example Production Configuration
 * ```typescript
 * const service = createIntegrationServiceBuilder()
 *   .withKeycloakOptions(keycloakOptions)
 *   .withDatabase(dbClient)
 *   .withCache(cacheService)
 *   .withMetrics(metrics)
 *   .withSyncService(syncService)
 *   .buildProduction(); // Validates required production dependencies
 * ```
 *
 * @example Development Configuration
 * ```typescript
 * const service = createIntegrationServiceBuilder()
 *   .withKeycloakOptions(keycloakOptions)
 *   .withDatabase(dbClient)
 *   .buildDevelopment(); // Minimal configuration for testing
 * ```
 */
````

**Validation**:

- [ ] Examples compile and run
- [ ] Documentation clear and comprehensive
- [ ] Migration guide included
- [ ] API reference updated

---

### Phase 6: Testing & Validation (4-6 hours)

**Goal**: Comprehensive test coverage for all new functionality

#### Task 6.1: Unit Tests for API Key Integration

- **File**: `KeycloakIntegrationService.apikey.test.ts` (new file)
- **Changes**: Test all API key operations
- **Impact**: None (tests only)
- **Dependencies**: Phase 2 complete

```typescript
describe("KeycloakIntegrationService - API Key Management", () => {
  let service: KeycloakIntegrationService;
  let mockApiKeyManager: jest.Mocked<APIKeyManager>;

  beforeEach(() => {
    // Setup mocks
    // Initialize service
  });

  describe("createAPIKey", () => {
    it("should create API key successfully", async () => {
      const options: APIKeyGenerationOptions = {
        userId: "user-123",
        name: "Test Key",
        scopes: ["read", "write"],
      };

      const result = await service.createAPIKey(options);

      expect(result).toBeDefined();
      expect(result.userId).toBe("user-123");
      expect(mockApiKeyManager.createAPIKey).toHaveBeenCalledWith(options);
    });

    it("should handle creation errors", async () => {
      mockApiKeyManager.createAPIKey.mockRejectedValue(new Error("DB error"));

      await expect(service.createAPIKey({} as any)).rejects.toThrow();
    });
  });

  describe("validateAPIKey", () => {
    it("should validate API key successfully", async () => {
      const result = await service.validateAPIKey("test-key");

      expect(result.success).toBe(true);
      expect(mockApiKeyManager.validateAPIKey).toHaveBeenCalled();
    });

    it("should handle invalid API keys", async () => {
      mockApiKeyManager.validateAPIKey.mockResolvedValue({
        success: false,
        error: "invalid_key",
      });

      const result = await service.validateAPIKey("invalid-key");

      expect(result.success).toBe(false);
    });
  });

  // ... more tests for revoke, list, update, etc.
});
```

**Validation**:

- [ ] > 85% code coverage for API key methods
- [ ] All error paths tested
- [ ] Edge cases covered
- [ ] Mocks properly configured

---

#### Task 6.2: Unit Tests for Session Enhancement

- **File**: `KeycloakIntegrationService.session.test.ts` (new file)
- **Changes**: Test enhanced session operations
- **Impact**: None (tests only)
- **Dependencies**: Phase 3 complete

```typescript
describe("KeycloakIntegrationService - Session Management", () => {
  let service: KeycloakIntegrationService;
  let mockSessionManager: jest.Mocked<SessionManager>;

  describe("createUserSession", () => {
    it("should create session successfully", async () => {
      const result = await service.createUserSession(
        "user-123",
        { accessToken: "token", expiresAt: new Date() },
        { ipAddress: "127.0.0.1", userAgent: "test" }
      );

      expect(result.success).toBe(true);
      expect(result.sessionId).toBeDefined();
    });
  });

  describe("refreshSessionTokens", () => {
    it("should refresh tokens successfully", async () => {
      const sessionData = { id: "sess-123" } as UserSession;

      const result = await service.refreshSessionTokens(sessionData);

      expect(result.success).toBe(true);
    });
  });

  describe("destroySession", () => {
    it("should destroy session successfully", async () => {
      const result = await service.destroySession("sess-123", "admin");

      expect(result.success).toBe(true);
    });
  });

  describe("getSessionStatistics", () => {
    it("should return session statistics", async () => {
      const stats = await service.getSessionStatistics();

      expect(stats).toBeDefined();
      expect(stats.activeSessions).toBeGreaterThanOrEqual(0);
    });
  });
});
```

**Validation**:

- [ ] All session methods tested
- [ ] Error scenarios covered
- [ ] Metrics recording verified
- [ ] Performance acceptable

---

#### Task 6.3: Integration Tests

- **File**: `KeycloakIntegrationService.integration.test.ts` (new file)
- **Changes**: End-to-end integration tests
- **Impact**: None (tests only)
- **Dependencies**: All phases complete

```typescript
describe("KeycloakIntegrationService - Integration Tests", () => {
  let service: KeycloakIntegrationService;
  let dbClient: PostgreSQLClient;
  let cacheService: CacheService;

  beforeAll(async () => {
    // Setup real database and cache
    dbClient = await setupTestDatabase();
    cacheService = await setupTestCache();

    service = createIntegrationServiceBuilder()
      .withKeycloakOptions(testKeycloakOptions)
      .withDatabase(dbClient)
      .withCache(cacheService)
      .withMetrics(testMetrics)
      .build();

    await service.initialize();
  });

  afterAll(async () => {
    await service.cleanup();
    await teardownTestDatabase();
    await teardownTestCache();
  });

  describe("Complete Auth Flow", () => {
    it("should handle full authentication flow", async () => {
      // 1. Authenticate user
      const authResult = await service.authenticateWithPassword(
        "testuser",
        "password",
        { ipAddress: "127.0.0.1", userAgent: "test" }
      );

      expect(authResult.success).toBe(true);
      expect(authResult.session).toBeDefined();

      // 2. Validate session
      const validation = await service.validateSession(
        authResult.session!.sessionId,
        { ipAddress: "127.0.0.1", userAgent: "test" }
      );

      expect(validation.valid).toBe(true);

      // 3. Create API key for user
      const apiKey = await service.createAPIKey({
        userId: authResult.user!.id,
        name: "Integration Test Key",
        scopes: ["read"],
      });

      expect(apiKey).toBeDefined();

      // 4. Validate API key
      const keyValidation = await service.validateAPIKey(apiKey.keyPreview);
      expect(keyValidation.success).toBe(true);

      // 5. Logout
      const logoutResult = await service.logout(authResult.session!.sessionId, {
        ipAddress: "127.0.0.1",
        userAgent: "test",
      });

      expect(logoutResult.success).toBe(true);
    });
  });

  describe("Performance", () => {
    it("should handle concurrent operations", async () => {
      const operations = Array.from({ length: 50 }, (_, i) =>
        service.validateAPIKey(`test-key-${i}`)
      );

      const results = await Promise.all(operations);

      expect(results).toHaveLength(50);
    });
  });

  describe("Health Check", () => {
    it("should return healthy status", async () => {
      const health = await service.checkHealth();

      expect(health.status).toBe("healthy");
      expect(health.details.components).toBeDefined();
    });
  });
});
```

**Validation**:

- [ ] Full flow tests pass
- [ ] Performance tests within limits
- [ ] Health checks pass
- [ ] No resource leaks

---

#### Task 6.4: Update Existing Tests

- **File**: Multiple test files
- **Changes**: Update mocks and expectations
- **Impact**: Medium
- **Dependencies**: All phases

**Updates Needed**:

1. Add `cacheService` to mock setup
2. Add `syncService` to mock setup
3. Update interface expectations
4. Fix any broken assertions

**Validation**:

- [ ] All existing tests still pass
- [ ] No regression in coverage
- [ ] New mocks properly configured
- [ ] CI/CD pipeline green

---

### Phase 7: Documentation & Migration (2-3 hours)

**Goal**: Complete documentation and migration guides

#### Task 7.1: Update API Documentation

- **File**: `docs/INTEGRATION_SERVICE_API.md` (new file)
- **Changes**: Comprehensive API documentation
- **Impact**: None
- **Dependencies**: All phases

#### Task 7.2: Create Migration Guide

- **File**: `docs/MIGRATION_GUIDE_v2.1.md` (new file)
- **Changes**: Step-by-step migration instructions
- **Impact**: None
- **Dependencies**: All phases

#### Task 7.3: Update README

- **File**: `README.md`
- **Changes**: Add new features and examples
- **Impact**: None
- **Dependencies**: All phases

#### Task 7.4: Update CHANGELOG

- **File**: `CHANGELOG.md`
- **Changes**: Document all changes in v2.1.0
- **Impact**: None
- **Dependencies**: All phases

---

## 🔄 Implementation Flows

### Flow 1: API Key Creation Flow

```
User Request
    ↓
KeycloakIntegrationService.createAPIKey()
    ↓
InputValidator.validateAPIKeyOptions()
    ↓ [valid]
APIKeyManager.createAPIKey()
    ↓
APIKeyOperations.generateSecureKey()
    ↓
APIKeyStorage.createAPIKey()
    ├─→ PostgreSQL (store key)
    └─→ CacheService (cache key)
    ↓
APIKeyMonitoring.trackCreation()
    ↓
MetricsCollector.recordCounter()
    ↓
Return ApiKey
```

### Flow 2: Authentication with Session Creation

```
User Login
    ↓
KeycloakIntegrationService.authenticateWithPassword()
    ↓
AuthenticationManager.authenticateWithPassword()
    ↓
KeycloakClient.authenticateWithPassword()
    ↓ [success]
UserFacade.getUserByUsername()
    ↓
SessionManager.createSession()
    ├─→ SessionSecurity.enforceConcurrentLimits()
    ├─→ SessionValidator.generateFingerprint()
    ├─→ EncryptionManager.encryptTokens()
    ├─→ SessionStore.storeSession()
    │   ├─→ UserSessionRepository.create()
    │   └─→ CacheService.set()
    └─→ SessionMetrics.recordCreation()
    ↓
Return AuthenticationResult
```

### Flow 3: Session Validation with Token Refresh

```
API Request with Session ID
    ↓
KeycloakIntegrationService.validateSession()
    ↓
SessionValidator.validateSession()
    ↓
SessionManager.validateSession()
    ↓
SessionStore.retrieveSession()
    ├─→ CacheService.get() [cache hit]
    └─→ UserSessionRepository.findById() [cache miss]
    ↓
SessionValidator.validateSession()
    ├─→ Check expiration
    ├─→ Check fingerprint
    └─→ Check security rules
    ↓ [needs refresh]
SessionTokenCoordinator.refreshSessionTokens()
    ├─→ KeycloakClient.refreshToken()
    ├─→ EncryptionManager.encryptTokens()
    └─→ SessionStore.updateSessionTokens()
    ↓
Return SessionValidationResult
```

### Flow 4: Complete User Registration Flow

```
Registration Request
    ↓
KeycloakIntegrationService.registerUser()
    ↓
UserFacade.registerUser()
    ↓
validateUserUniqueness()
    ├─→ KeycloakUserService.findByEmail()
    └─→ UserRepository.findByUsername()
    ↓ [unique]
UserRepository.create() [Local DB - Source of Truth]
    ↓
UserSyncService.queueUserCreate() [Async]
    ├─→ Queue for Keycloak creation
    └─→ Background worker processes
        ↓
        KeycloakUserService.createUser()
        ↓ [if fails]
        Retry with exponential backoff
    ↓
Return User
```

### Flow 5: Health Check Flow

```
Health Check Request
    ↓
KeycloakIntegrationService.checkHealth()
    ↓
ResourceManager.checkHealth()
    ├─→ KeycloakClient.checkConnection()
    ├─→ PostgreSQLClient.ping()
    ├─→ CacheService.ping()
    ├─→ SessionManager.healthCheck()
    │   ├─→ SessionStore health
    │   ├─→ SessionValidator health
    │   └─→ SessionMetrics health
    ├─→ APIKeyManager.getHealthStatus()
    │   ├─→ APIKeyOperations health
    │   └─→ APIKeyStorage health
    └─→ UserFacade.getSyncHealthStatus()
        └─→ UserSyncService health
    ↓
Aggregate Results
    ↓
Return HealthCheckResult
```

---

## 📊 Dependency Graph

```
Phase 1: Foundation
    ├─→ Task 1.1: Cache Service ───┐
    └─→ Task 1.2: Interfaces       │
                                    ↓
Phase 2: API Key Integration       │
    ├─→ Task 2.1: Initialize ←─────┘
    ├─→ Task 2.2: Implement (depends on 2.1)
    └─→ Task 2.3: Cleanup (depends on 2.1)

Phase 3: Session Enhancement (parallel with Phase 2)
    ├─→ Task 3.1: Create Session
    ├─→ Task 3.2: Token Refresh
    ├─→ Task 3.3: Destroy Session
    └─→ Task 3.4: Statistics

Phase 4: User Management
    ├─→ Task 4.1: UserFacade (depends on 1.1)
    └─→ Task 4.2: Implement (depends on 4.1)

Phase 5: Builder Pattern (depends on 1-4)
    ├─→ Task 5.1: Create Builder
    ├─→ Task 5.2: Update Constructor (depends on 5.1)
    └─→ Task 5.3: Documentation (depends on 5.2)

Phase 6: Testing (depends on 1-5)
    ├─→ Task 6.1: API Key Tests (depends on Phase 2)
    ├─→ Task 6.2: Session Tests (depends on Phase 3)
    ├─→ Task 6.3: Integration Tests (depends on all)
    └─→ Task 6.4: Update Tests (depends on all)

Phase 7: Documentation (depends on 1-6)
    ├─→ Task 7.1: API Docs
    ├─→ Task 7.2: Migration Guide
    ├─→ Task 7.3: README
    └─→ Task 7.4: CHANGELOG
```

---

## ⚠️ Risk Assessment

### High Risk Items

| Risk                                   | Impact | Probability | Mitigation                                         |
| -------------------------------------- | ------ | ----------- | -------------------------------------------------- |
| Breaking changes to existing consumers | HIGH   | LOW         | Maintain backward compatibility, extensive testing |
| Cache integration issues               | MEDIUM | MEDIUM      | Graceful degradation, cache optional               |
| UserFacade/UserManager mismatch        | MEDIUM | LOW         | Interface compatibility layer                      |
| Test coverage gaps                     | MEDIUM | MEDIUM      | Comprehensive test plan, code review               |

### Medium Risk Items

| Risk                     | Impact | Probability | Mitigation                      |
| ------------------------ | ------ | ----------- | ------------------------------- |
| Performance regression   | MEDIUM | LOW         | Benchmarks, load testing        |
| Documentation incomplete | LOW    | MEDIUM      | Documentation checklist         |
| Migration complexity     | MEDIUM | LOW         | Clear migration guide, examples |

### Rollback Strategy

1. **Phase-based rollback**: Each phase can be rolled back independently
2. **Feature flags**: Use environment variables to enable/disable new features
3. **Version pinning**: Allow consumers to pin to v2.0.0 if needed
4. **Database migrations**: All DB changes must be reversible

---

## ✅ Success Criteria

### Functional Requirements

- [ ] All API Key operations working (create, validate, revoke, list)
- [ ] Full session lifecycle exposed (create, validate, refresh, destroy)
- [ ] Complete user management (CRUD, roles, sync)
- [ ] Cache integration working when available
- [ ] Builder pattern available for flexible construction
- [ ] All interfaces implemented correctly

### Non-Functional Requirements

- [ ] Test coverage >85%
- [ ] No performance regression (<5% latency increase)
- [ ] Zero breaking changes
- [ ] Documentation complete
- [ ] Migration guide available
- [ ] CI/CD pipeline passes

### Quality Gates

- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] Code review approved
- [ ] Documentation reviewed
- [ ] Performance benchmarks pass
- [ ] Security audit passed

---

## 📅 Timeline & Estimates

### Optimistic (Single Developer, No Blockers)

- Phase 1: 2 hours
- Phase 2: 3 hours
- Phase 3: 2 hours
- Phase 4: 3 hours
- Phase 5: 2 hours
- Phase 6: 4 hours
- Phase 7: 2 hours
  **Total: 18 hours (2.25 days)**

### Realistic (Including Review & Iterations)

- Phase 1: 3 hours
- Phase 2: 4 hours
- Phase 3: 3 hours
- Phase 4: 4 hours
- Phase 5: 3 hours
- Phase 6: 6 hours
- Phase 7: 3 hours
- Testing & Fixes: 4 hours
  **Total: 30 hours (4 days)**

### Pessimistic (With Blockers & Rework)

- Phase 1-7: 40 hours
- Testing & Fixes: 8 hours
- Documentation rework: 4 hours
  **Total: 52 hours (6.5 days)**

### Recommended Timeline

**Sprint 1 (Week 1)**:

- Days 1-2: Phases 1-2 (Foundation + API Keys)
- Days 3-4: Phases 3-4 (Sessions + Users)
- Day 5: Review & adjustments

**Sprint 2 (Week 2)**:

- Days 1-2: Phase 5 (Builder) + Phase 6 (Testing)
- Days 3-4: Phase 7 (Documentation) + Final testing
- Day 5: Code review, deployment prep

---

## 🚀 Getting Started

### Prerequisites

```bash
# Ensure you have latest dependencies
pnpm install

# Run existing tests to establish baseline
pnpm test libs/keycloak-authV2

# Check for any existing issues
pnpm lint libs/keycloak-authV2
```

### Create Feature Branch

```bash
git checkout -b feature/integration-service-enhancement
```

### Implementation Order

1. Start with Phase 1 (Foundation)
2. Implement Phase 2 (API Keys) - highest priority
3. Parallel: Phase 3 (Sessions) + Phase 4 (Users)
4. Phase 5 (Builder) - optional but recommended
5. Phase 6 (Testing) - critical
6. Phase 7 (Documentation) - final

### Validation Checklist

After each phase:

- [ ] Code compiles without errors
- [ ] New tests pass
- [ ] Existing tests still pass
- [ ] No lint errors
- [ ] Documentation updated
- [ ] Changes committed with clear message

---

## 📚 Resources & References

### Internal Documentation

- [Copilot Instructions](/.github/copilot-instructions.md)
- [SOLID Principles Guide](/.github/instructions/master.instructions.md)
- [Testing Standards](/docs/testing-standards.md)

### External References

- [SOLID Principles](https://en.wikipedia.org/wiki/SOLID)
- [Builder Pattern](https://refactoring.guru/design-patterns/builder)
- [Facade Pattern](https://refactoring.guru/design-patterns/facade)

### Code Examples

- See existing tests for patterns: `tests/services/`
- Reference implementations: `services/apikey/`, `services/session/`

---

## 🤝 Review & Approval Process

### Code Review Checklist

- [ ] SOLID principles followed
- [ ] No code duplication
- [ ] Clear, self-documenting code
- [ ] Comprehensive error handling
- [ ] Proper logging and metrics
- [ ] TypeScript strict mode compliant
- [ ] No security vulnerabilities
- [ ] Performance acceptable

### Approval Requirements

1. **Self-review**: Complete all validation checkpoints
2. **Peer review**: At least one senior developer approval
3. **Testing**: All automated tests passing
4. **Documentation**: Complete and accurate
5. **Security**: No critical vulnerabilities
6. **Performance**: No regressions

---

## 📝 Notes & Considerations

### Breaking Change Prevention

- All new functionality is additive
- Existing methods maintain same signatures
- Optional parameters for new features
- Backward compatibility guaranteed

### Future Enhancements (Out of Scope)

- Circuit breaker pattern
- Request batching
- Distributed tracing
- Advanced caching strategies
- Multi-tenant support

### Technical Debt Paydown

- ✅ Remove cache service workaround
- ✅ Simplify constructor complexity
- ✅ Complete interface implementations
- ✅ Improve test coverage

---

**Plan Status**: ✅ Ready for Implementation  
**Last Updated**: October 7, 2025  
**Next Review**: After Phase 2 completion
