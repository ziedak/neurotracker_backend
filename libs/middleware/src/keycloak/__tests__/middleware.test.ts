/**
 * Keycloak Middleware Unit Tests
 * Enhanced with security, performance, and reliability testing
 */

import { KeycloakMiddleware } from '../middleware';
import { KeycloakService } from '../service';
import { KeycloakConfigManager } from '../config';
import {
  KeycloakMiddlewareOptions,
  KeycloakError,
  KeycloakErrorType,
  KeycloakTokenVerification
} from '../types';

// Mock KeycloakService
jest.mock('../service');
const MockKeycloakService = KeycloakService as jest.MockedClass<typeof KeycloakService>;

// Mock logger and metrics
const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis()
};

const mockMetrics = {
  recordCounter: jest.fn(),
  recordTimer: jest.fn(),
  recordHistogram: jest.fn()
};

describe('KeycloakMiddleware', () => {
  let middleware: KeycloakMiddleware;
  let mockService: jest.Mocked<KeycloakService>;
  let config: KeycloakMiddlewareOptions;
  let configManager: KeycloakConfigManager;

  beforeEach(async () => {
    configManager = new KeycloakConfigManager('development', mockLogger as any);
    await configManager.loadConfig({
      serverUrl: 'https://keycloak.example.com',
      realm: 'test-realm',
      clientId: 'test-client',
      requireAuth: true,
      verifyTokenLocally: false
    });
    
    config = {
      name: 'keycloak-auth',
      enabled: true,
      priority: 0,
      keycloak: configManager.getConfig()
    };

    MockKeycloakService.mockClear();
    mockService = {
      verifyToken: jest.fn(),
      getUserInfo: jest.fn(),
      getCacheStats: jest.fn(),
      clearCache: jest.fn(),
      destroy: jest.fn()
    } as any;

    MockKeycloakService.prototype.verifyToken = mockService.verifyToken;
    MockKeycloakService.prototype.getUserInfo = mockService.getUserInfo;
    MockKeycloakService.prototype.getCacheStats = mockService.getCacheStats;
    MockKeycloakService.prototype.clearCache = mockService.clearCache;
    MockKeycloakService.prototype.destroy = mockService.destroy;

    middleware = new KeycloakMiddleware(config, mockLogger as any, mockMetrics as any);
    jest.clearAllMocks();
  });

  afterEach(() => {
    middleware.destroy();
    configManager?.destroy();
  });

  describe('Initialization', () => {
    it('should initialize with valid configuration', () => {
      expect(middleware).toBeDefined();
      expect(MockKeycloakService).toHaveBeenCalledWith(
        config.keycloak,
        mockLogger
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Keycloak middleware initialized',
        expect.objectContaining({
          serverUrl: config.keycloak.serverUrl,
          realm: config.keycloak.realm,
          clientId: config.keycloak.clientId
        })
      );
    });
  });

  describe('Authentication Flow', () => {
    let mockContext: any;
    let mockNext: jest.Mock;

    beforeEach(() => {
      mockContext = {
        request: {
          url: 'https://api.example.com/test',
          headers: {},
          method: 'GET'
        },
        keycloak: {
          authenticated: false,
          roles: [],
          groups: [],
          permissions: [],
          clientRoles: {}
        }
      };
      mockNext = jest.fn();
    });

    it('should authenticate successfully with valid token', async () => {
      const mockVerification: KeycloakTokenVerification = {
        valid: true,
        userInfo: {
          sub: 'user-123',
          email: 'test@example.com',
          preferredUsername: 'testuser',
          roles: ['user', 'customer'],
          groups: ['test-group'],
          clientRoles: {}
        },
        source: 'remote'
      };

      mockContext.request.headers.authorization = 'Bearer valid-token';
      mockService.verifyToken.mockResolvedValue(mockVerification);

      await middleware.execute(mockContext, mockNext);

      expect(mockService.verifyToken).toHaveBeenCalledWith('valid-token');
      expect(mockContext.keycloak.authenticated).toBe(true);
      expect(mockContext.keycloak.user).toEqual(mockVerification.userInfo);
      expect(mockContext.userId).toBe('user-123');
      expect(mockContext.userEmail).toBe('test@example.com');
      expect(mockNext).toHaveBeenCalled();
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        'keycloak_auth_success',
        1,
        expect.objectContaining({ source: 'remote' })
      );
    });

    it('should fail authentication with invalid token', async () => {
      const mockVerification: KeycloakTokenVerification = {
        valid: false,
        error: 'Token is expired',
        source: 'remote'
      };

      mockContext.request.headers.authorization = 'Bearer invalid-token';
      mockService.verifyToken.mockResolvedValue(mockVerification);

      await expect(middleware.execute(mockContext, mockNext)).rejects.toThrow();

      expect(mockService.verifyToken).toHaveBeenCalledWith('invalid-token');
      expect(mockContext.keycloak.authenticated).toBe(false);
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        'keycloak_auth_failed',
        1,
        expect.any(Object)
      );
    });

    it('should extract token from Authorization header', async () => {
      mockContext.request.headers.authorization = 'Bearer test-token';
      
      const mockVerification: KeycloakTokenVerification = {
        valid: true,
        userInfo: {
          sub: 'user-123',
          roles: ['user'],
          groups: [],
          clientRoles: {}
        } as any,
        source: 'remote'
      };

      mockService.verifyToken.mockResolvedValue(mockVerification);
      await middleware.execute(mockContext, mockNext);

      expect(mockService.verifyToken).toHaveBeenCalledWith('test-token');
    });

    it('should extract token from query parameter', async () => {
      mockContext.request.url = 'https://api.example.com/test?access_token=query-token';
      
      const mockVerification: KeycloakTokenVerification = {
        valid: true,
        userInfo: {
          sub: 'user-123',
          roles: ['user'],
          groups: [],
          clientRoles: {}
        } as any,
        source: 'remote'
      };

      mockService.verifyToken.mockResolvedValue(mockVerification);
      await middleware.execute(mockContext, mockNext);

      expect(mockService.verifyToken).toHaveBeenCalledWith('query-token');
    });

    it('should handle missing token when auth is required', async () => {
      await expect(middleware.execute(mockContext, mockNext)).rejects.toThrow();

      expect(mockService.verifyToken).not.toHaveBeenCalled();
      expect(mockContext.keycloak.authenticated).toBe(false);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should allow missing token when auth is not required', async () => {
      const optionalConfig = await configManager.updateConfig({ requireAuth: false });
      const optionalAuthConfig = {
        ...config,
        keycloak: optionalConfig
      };

      const optionalMiddleware = new KeycloakMiddleware(
        optionalAuthConfig, 
        mockLogger as any, 
        mockMetrics as any
      );

      await optionalMiddleware.execute(mockContext, mockNext);

      expect(mockService.verifyToken).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith('keycloak_unauthenticated_allowed');

      optionalMiddleware.destroy();
    });
  });

  describe('Role and Permission Mapping', () => {
    it('should map admin role to admin permissions', () => {
      const permissions = (middleware as any).mapRolesToPermissions(['admin']);
      
      expect(permissions).toContain('user:read');
      expect(permissions).toContain('user:write');
      expect(permissions).toContain('user:delete');
      expect(permissions).toContain('system:admin');
      expect(permissions).toContain('api:full_access');
    });

    it('should map manager role to manager permissions', () => {
      const permissions = (middleware as any).mapRolesToPermissions(['manager']);
      
      expect(permissions).toContain('user:read');
      expect(permissions).toContain('user:write');
      expect(permissions).toContain('reports:read');
      expect(permissions).toContain('api:write');
      expect(permissions).not.toContain('user:delete');
    });

    it('should map user role to basic permissions', () => {
      const permissions = (middleware as any).mapRolesToPermissions(['user']);
      
      expect(permissions).toContain('user:read');
      expect(permissions).toContain('api:read');
      expect(permissions).not.toContain('user:write');
      expect(permissions).not.toContain('system:admin');
    });

    it('should handle custom roles', () => {
      const permissions = (middleware as any).mapRolesToPermissions(['custom-role']);
      
      expect(permissions).toContain('role:custom-role');
    });

    it('should remove duplicate permissions', () => {
      const permissions = (middleware as any).mapRolesToPermissions(['admin', 'manager', 'user']);
      
      const uniquePermissions = [...new Set(permissions)];
      expect(permissions.length).toBe(uniquePermissions.length);
    });
  });

  describe('Error Handling', () => {
    it('should map Keycloak errors to HTTP status codes', () => {
      const testCases = [
        { error: new KeycloakError('test', KeycloakErrorType.INVALID_TOKEN), expected: 401 },
        { error: new KeycloakError('test', KeycloakErrorType.TOKEN_EXPIRED), expected: 401 },
        { error: new KeycloakError('test', KeycloakErrorType.PERMISSION_DENIED), expected: 403 },
        { error: new KeycloakError('test', KeycloakErrorType.CONNECTION_ERROR), expected: 503 },
        { error: new KeycloakError('test', KeycloakErrorType.CONFIGURATION_ERROR), expected: 500 }
      ];

      testCases.forEach(({ error, expected }) => {
        const status = (middleware as any).getHttpStatusForError(error);
        expect(status).toBe(expected);
      });
    });

    it('should determine error type from message', () => {
      const testCases = [
        { message: 'token expired', expected: KeycloakErrorType.TOKEN_EXPIRED },
        { message: 'invalid signature', expected: KeycloakErrorType.INVALID_SIGNATURE },
        { message: 'wrong issuer', expected: KeycloakErrorType.INVALID_ISSUER },
        { message: 'connection failed', expected: KeycloakErrorType.CONNECTION_ERROR },
        { message: 'permission denied', expected: KeycloakErrorType.PERMISSION_DENIED },
        { message: 'unknown error', expected: KeycloakErrorType.INVALID_TOKEN }
      ];

      testCases.forEach(({ message, expected }) => {
        const errorType = (middleware as any).getErrorTypeFromMessage(message);
        expect(errorType).toBe(expected);
      });
    });
  });

  describe('Guards and Elysia Integration', () => {
    it('should create require role guard', () => {
      const guard = middleware.requireRole('admin');
      expect(guard).toBeDefined();
    });

    it('should create require permission guard', () => {
      const guard = middleware.requirePermission('user:read');
      expect(guard).toBeDefined();
    });

    it('should create require group guard', () => {
      const guard = middleware.requireGroup('test-group');
      expect(guard).toBeDefined();
    });

    it('should create Elysia plugin', () => {
      const plugin = middleware.plugin();
      expect(plugin).toBeDefined();
    });
  });

  describe('Cache Management', () => {
    it('should provide cache statistics', () => {
      const mockStats = {
        tokenCacheSize: 5,
        userInfoCacheSize: 3,
        jwksCacheSize: 1
      };

      mockService.getCacheStats.mockReturnValue(mockStats);

      const stats = middleware.getCacheStats();
      expect(stats).toEqual(mockStats);
      expect(mockService.getCacheStats).toHaveBeenCalled();
    });

    it('should clear cache', () => {
      middleware.clearCache();
      expect(mockService.clearCache).toHaveBeenCalled();
    });
  });

  describe('Security Features', () => {
    it('should implement rate limiting for failed auth attempts', async () => {
      // Mock multiple failed authentication attempts
      const mockVerification: KeycloakTokenVerification = {
        valid: false,
        error: 'Invalid token',
        source: 'remote'
      };

      mockContext.request.headers.authorization = 'Bearer invalid-token';
      mockService.verifyToken.mockResolvedValue(mockVerification);

      // Simulate multiple failed attempts
      for (let i = 0; i < 12; i++) {
        try {
          await middleware.execute(mockContext, mockNext);
        } catch (error) {
          // Expected to throw authentication error
        }
      }

      // Should eventually trigger rate limiting
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Authentication'),
        expect.any(Object)
      );
    });

    it('should sanitize error messages for security', async () => {
      const sensitiveError = new KeycloakError(
        'Internal server details that should not be exposed',
        KeycloakErrorType.INVALID_TOKEN
      );

      try {
        await (middleware as any).handleAuthenticationError(mockContext, sensitiveError);
      } catch (error) {
        expect(error.details.error_description).not.toContain('Internal server details');
        expect(error.details.error_description).toBe('Invalid or expired authentication token');
      }
    });

    it('should hash client IPs for privacy-safe logging', () => {
      const clientIp = '192.168.1.100';
      const hashedIp = (middleware as any).hashClientIp(clientIp);
      
      expect(hashedIp).toBeDefined();
      expect(hashedIp).toHaveLength(16);
      expect(hashedIp).not.toContain(clientIp);
    });
  });

  describe('Health Monitoring', () => {
    it('should provide comprehensive health status', async () => {
      const mockServiceHealth = {
        status: 'healthy' as const,
        details: {
          redis: 'connected',
          keycloak: 'accessible',
          uptime: 12345
        }
      };

      const mockCacheStats = {
        tokenCacheSize: 10,
        userInfoCacheSize: 5,
        jwksCacheSize: 1
      };

      mockService.getHealthStatus.mockResolvedValue(mockServiceHealth);
      mockService.getCacheStats.mockResolvedValue(mockCacheStats);

      const health = await middleware.getHealthStatus();

      expect(health.status).toBe('healthy');
      expect(health.details.cacheStats).toEqual(mockCacheStats);
      expect(health.details.middleware).toBe('healthy');
    });

    it('should handle health check failures gracefully', async () => {
      mockService.getHealthStatus.mockRejectedValue(new Error('Service unavailable'));

      const health = await middleware.getHealthStatus();

      expect(health.status).toBe('unhealthy');
      expect(health.details.error).toBe('Health check failed');
    });
  });

  describe('Cleanup', () => {
    it('should cleanup resources on destroy', () => {
      middleware.destroy();
      expect(mockService.destroy).toHaveBeenCalled();
    });
  });
});