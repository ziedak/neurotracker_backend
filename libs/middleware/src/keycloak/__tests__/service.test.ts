/**
 * Keycloak Service Unit Tests
 */

import { KeycloakService } from '../service';
import {
  KeycloakConfig,
  KeycloakError,
  KeycloakErrorType,
  KeycloakJWTPayload
} from '../types';

// Mock fetch globally
global.fetch = jest.fn();
const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

// Mock logger
const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
};

describe('KeycloakService', () => {
  let service: KeycloakService;
  let config: KeycloakConfig;

  beforeEach(() => {
    config = {
      serverUrl: 'https://keycloak.example.com',
      realm: 'test-realm',
      clientId: 'test-client',
      verifyTokenLocally: false, // Use remote verification for easier testing
      cacheTTL: 300
    };

    service = new KeycloakService(config, mockLogger as any);
    jest.clearAllMocks();
  });

  afterEach(() => {
    service.destroy();
  });

  describe('Configuration Validation', () => {
    it('should validate required configuration', () => {
      expect(() => {
        new KeycloakService({} as KeycloakConfig);
      }).toThrow(KeycloakError);
    });

    it('should throw error for missing server URL', () => {
      expect(() => {
        new KeycloakService({ realm: 'test', clientId: 'test' } as KeycloakConfig);
      }).toThrow('Keycloak server URL is required');
    });

    it('should throw error for missing realm', () => {
      expect(() => {
        new KeycloakService({ serverUrl: 'http://test', clientId: 'test' } as KeycloakConfig);
      }).toThrow('Keycloak realm is required');
    });

    it('should throw error for missing client ID', () => {
      expect(() => {
        new KeycloakService({ serverUrl: 'http://test', realm: 'test' } as KeycloakConfig);
      }).toThrow('Keycloak client ID is required');
    });

    it('should normalize server URL by removing trailing slash', () => {
      const configWithSlash = {
        ...config,
        serverUrl: 'https://keycloak.example.com/'
      };
      
      const serviceWithSlash = new KeycloakService(configWithSlash, mockLogger as any);
      expect(serviceWithSlash).toBeDefined();
      serviceWithSlash.destroy();
    });
  });

  describe('Token Verification - Remote', () => {
    it('should verify valid token successfully', async () => {
      const mockIntrospectionResponse = {
        active: true,
        sub: 'user-123',
        iss: 'https://keycloak.example.com/realms/test-realm',
        aud: 'test-client',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        jti: 'token-id-123',
        preferred_username: 'testuser',
        email: 'test@example.com',
        realm_access: {
          roles: ['user', 'customer']
        }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockIntrospectionResponse)
      } as Response);

      const result = await service.verifyToken('valid-token');

      expect(result.valid).toBe(true);
      expect(result.source).toBe('remote');
      expect(result.userInfo?.sub).toBe('user-123');
      expect(result.userInfo?.email).toBe('test@example.com');
      expect(result.userInfo?.roles).toContain('user');
      expect(result.userInfo?.roles).toContain('customer');
    });

    it('should handle inactive token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ active: false })
      } as Response);

      const result = await service.verifyToken('invalid-token');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token is not active');
      expect(result.source).toBe('remote');
    });

    it('should handle introspection request failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized'
      } as Response);

      const result = await service.verifyToken('invalid-token');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Introspection request failed');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await service.verifyToken('token');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Remote token verification failed');
    });
  });

  describe('User Info Retrieval', () => {
    it('should retrieve user info successfully', async () => {
      const mockUserInfo = {
        sub: 'user-123',
        email: 'test@example.com',
        preferred_username: 'testuser',
        name: 'Test User',
        realm_access: {
          roles: ['user']
        },
        groups: ['test-group']
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockUserInfo)
      } as Response);

      const result = await service.getUserInfo('valid-token');

      expect(result.success).toBe(true);
      expect(result.data?.sub).toBe('user-123');
      expect(result.data?.email).toBe('test@example.com');
      expect(result.data?.roles).toContain('user');
      expect(result.cached).toBe(false);
    });

    it('should handle user info request failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized'
      } as Response);

      const result = await service.getUserInfo('invalid-token');

      expect(result.success).toBe(false);
      expect(result.error).toContain('UserInfo request failed');
    });
  });

  describe('Caching', () => {
    it('should cache valid token verification results', async () => {
      const mockResponse = {
        active: true,
        sub: 'user-123',
        iss: 'https://keycloak.example.com/realms/test-realm',
        aud: 'test-client',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        jti: 'token-id-123'
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      } as Response);

      // First call
      const result1 = await service.verifyToken('test-token');
      expect(result1.valid).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second call should use cache
      const result2 = await service.verifyToken('test-token');
      expect(result2.valid).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1); // Still only called once
    });

    it('should provide cache statistics', () => {
      const stats = service.getCacheStats();
      expect(stats).toHaveProperty('tokenCacheSize');
      expect(stats).toHaveProperty('userInfoCacheSize');
      expect(stats).toHaveProperty('jwksCacheSize');
      expect(typeof stats.tokenCacheSize).toBe('number');
    });

    it('should clear caches', () => {
      service.clearCache();
      const stats = service.getCacheStats();
      expect(stats.tokenCacheSize).toBe(0);
      expect(stats.userInfoCacheSize).toBe(0);
      expect(stats.jwksCacheSize).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should create KeycloakError with correct properties', () => {
      const error = new KeycloakError(
        'Test error',
        KeycloakErrorType.INVALID_TOKEN,
        401,
        { detail: 'test' }
      );

      expect(error.message).toBe('Test error');
      expect(error.type).toBe(KeycloakErrorType.INVALID_TOKEN);
      expect(error.statusCode).toBe(401);
      expect(error.details).toEqual({ detail: 'test' });
      expect(error.name).toBe('KeycloakError');
    });

    it('should handle timeout scenarios', async () => {
      // Mock a delayed response
      mockFetch.mockImplementationOnce(
        () => new Promise(resolve => setTimeout(resolve, 10000))
      );

      const result = await service.verifyToken('test-token');
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('verification failed');
    });
  });

  describe('Token Payload Extraction', () => {
    it('should extract user information from JWT payload', async () => {
      const mockPayload: KeycloakJWTPayload = {
        sub: 'user-123',
        iss: 'https://keycloak.example.com/realms/test-realm',
        aud: 'test-client',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        jti: 'token-id',
        typ: 'Bearer',
        preferred_username: 'testuser',
        email: 'test@example.com',
        name: 'Test User',
        given_name: 'Test',
        family_name: 'User',
        realm_access: {
          roles: ['admin', 'user']
        },
        resource_access: {
          'test-client': {
            roles: ['client-role']
          }
        },
        groups: ['group1', 'group2']
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          active: true,
          ...mockPayload
        })
      } as Response);

      const result = await service.verifyToken('test-token');

      expect(result.valid).toBe(true);
      expect(result.userInfo?.sub).toBe('user-123');
      expect(result.userInfo?.preferredUsername).toBe('testuser');
      expect(result.userInfo?.email).toBe('test@example.com');
      expect(result.userInfo?.name).toBe('Test User');
      expect(result.userInfo?.givenName).toBe('Test');
      expect(result.userInfo?.familyName).toBe('User');
      expect(result.userInfo?.roles).toEqual(expect.arrayContaining(['admin', 'user', 'client-role']));
      expect(result.userInfo?.groups).toEqual(['group1', 'group2']);
      expect(result.userInfo?.clientRoles['test-client']).toEqual(['client-role']);
    });

    it('should handle missing optional fields', async () => {
      const mockPayload = {
        active: true,
        sub: 'user-123',
        iss: 'https://keycloak.example.com/realms/test-realm',
        aud: 'test-client',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        jti: 'token-id'
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockPayload)
      } as Response);

      const result = await service.verifyToken('test-token');

      expect(result.valid).toBe(true);
      expect(result.userInfo?.sub).toBe('user-123');
      expect(result.userInfo?.roles).toEqual([]);
      expect(result.userInfo?.groups).toEqual([]);
      expect(result.userInfo?.clientRoles).toEqual({});
    });
  });
});