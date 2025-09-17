import {
  TokenIntrospectionService,
  createTokenIntrospectionService,
} from "../../src/index";

describe("TokenIntrospectionService", () => {
  let service: TokenIntrospectionService;
  let mockCacheService: any;

  beforeEach(() => {
    mockCacheService = (global as any).testUtils.createMockCacheService();

    const mockFactory = (
      global as any
    ).testUtils.createMockKeycloakClientFactory();

    service = createTokenIntrospectionService(mockFactory, mockCacheService);
  });

  describe("validateJWT", () => {
    it("should validate JWT token", async () => {
      const mockToken = "valid.jwt.token";
      const mockConfig = (
        global as any
      ).testUtils.createMockKeycloakClientConfig();

      // Mock the cache response
      mockCacheService.get.mockResolvedValueOnce({ data: null });

      const result = await service.validateJWT(mockToken, mockConfig);

      expect(result).toEqual(
        expect.objectContaining({
          valid: expect.any(Boolean),
          cached: expect.any(Boolean),
        })
      );
    });

    it("should handle cached JWT validation", async () => {
      const mockToken = "cached.jwt.token";
      const cachedResult = {
        valid: true,
        claims: { sub: "user123" },
        cached: true,
      };

      mockCacheService.get.mockResolvedValueOnce({ data: cachedResult });

      const result = await service.validateJWT(mockToken);

      expect(result.cached).toBe(true);
      expect(mockCacheService.get).toHaveBeenCalled();
    });

    it("should cache JWT validation results", async () => {
      const mockToken = "new.jwt.token";

      mockCacheService.get.mockResolvedValueOnce({ data: null });
      mockCacheService.set.mockResolvedValueOnce(true);

      await service.validateJWT(mockToken);

      expect(mockCacheService.set).toHaveBeenCalled();
    });
  });

  describe("introspect", () => {
    it("should introspect active token", async () => {
      const token = "opaque.access.token";
      const mockConfig = (
        global as any
      ).testUtils.createMockKeycloakClientConfig();
      const mockResponse = (
        global as any
      ).testUtils.createMockIntrospectionResponse();

      mockCacheService.get.mockResolvedValueOnce({ data: null });

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await service.introspect(token, mockConfig);

      expect(result.active).toBe(true);
      expect(result).toEqual(
        expect.objectContaining({
          active: true,
          client_id: expect.any(String),
        })
      );
    });

    it("should handle inactive token", async () => {
      const token = "invalid.token";
      const mockConfig = (
        global as any
      ).testUtils.createMockKeycloakClientConfig();

      mockCacheService.get.mockResolvedValueOnce({ data: null });

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ active: false }),
      });

      const result = await service.introspect(token, mockConfig);

      expect(result.active).toBe(false);
    });

    it("should cache introspection results", async () => {
      const token = "cacheable.token";
      const mockConfig = (
        global as any
      ).testUtils.createMockKeycloakClientConfig();
      const mockResponse = (
        global as any
      ).testUtils.createMockIntrospectionResponse();

      mockCacheService.get.mockResolvedValueOnce({ data: null });
      mockCacheService.set.mockResolvedValueOnce(true);

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      await service.introspect(token, mockConfig);

      expect(mockCacheService.set).toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("should handle network errors gracefully", async () => {
      const token = "network.error.token";

      mockCacheService.get.mockResolvedValueOnce({ data: null });
      (global.fetch as jest.Mock).mockRejectedValueOnce(
        new Error("Network error")
      );

      const result = await service.validateJWT(token);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Network error");
    });

    it("should handle service errors during introspection", async () => {
      const token = "service.error.token";
      const mockConfig = (
        global as any
      ).testUtils.createMockKeycloakClientConfig();

      mockCacheService.get.mockResolvedValueOnce({ data: null });
      (global.fetch as jest.Mock).mockRejectedValueOnce(
        new Error("Service unavailable")
      );

      await expect(service.introspect(token, mockConfig)).rejects.toThrow(
        "Service unavailable"
      );
    });
  });

  describe("cache management", () => {
    it("should provide validation statistics", async () => {
      const mockStats = { Hits: 10, Misses: 5 };
      mockCacheService.getStats.mockReturnValueOnce(mockStats);

      const stats = await service.getValidationStats();

      expect(stats).toEqual(
        expect.objectContaining({
          cacheHits: 10,
          cacheMisses: 5,
          introspectionCalls: expect.any(Number),
          jwtValidations: expect.any(Number),
        })
      );
    });

    it("should cleanup expired tokens", async () => {
      mockCacheService.invalidatePattern.mockResolvedValue(5);

      await service.cleanupExpiredTokens();

      expect(mockCacheService.invalidatePattern).toHaveBeenCalledTimes(2);
    });
  });
});
