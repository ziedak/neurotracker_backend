import { Logger, MetricsCollector } from "@libs/monitoring";
import { CacheService } from "./CacheService";

export interface APIGatewayRequest {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  headers?: Record<string, string>;
  body?: any;
  timeout?: number;
}

export interface APIGatewayResponse {
  success: boolean;
  data?: any;
  error?: string;
  status?: number;
  headers?: Record<string, string>;
}

export interface GatewayHealth {
  status: "healthy" | "degraded" | "unhealthy";
  latency?: number;
  uptime?: number;
  lastCheck: Date;
}

/**
 * API Gateway Service for Dashboard
 * Handles communication with the backend API Gateway
 */
export class APIGatewayService {
  private readonly cache: CacheService;
  private readonly logger: ILogger;
  private readonly metrics: MetricsCollector;
  private readonly gatewayUrl: string;
  private readonly defaultTimeout: number = 30000; // 30 seconds

  constructor(cache: CacheService, logger: ILogger, metrics: MetricsCollector) {
    this.cache = cache;
    this.logger = logger;
    this.metrics = metrics;
    this.gatewayUrl = process.env.API_GATEWAY_URL || "http://localhost:3000";
  }

  /**
   * Make a request to the API Gateway
   */
  async request(
    path: string,
    options: APIGatewayRequest = {}
  ): Promise<APIGatewayResponse> {
    const startTime = Date.now();

    try {
      await this.metrics.recordCounter("api_gateway_requests");

      const {
        method = "GET",
        headers = {},
        body,
        timeout = this.defaultTimeout,
      } = options;

      const url = `${this.gatewayUrl}${path}`;

      // Prepare request options
      const requestOptions: RequestInit = {
        method,
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "dashboard-service",
          ...headers,
        },
        signal: AbortSignal.timeout(timeout),
      };

      if (body && method !== "GET") {
        requestOptions.body = JSON.stringify(body);
      }

      this.logger.debug("API Gateway request", {
        url,
        method,
        hasBody: !!body,
      });

      const response = await fetch(url, requestOptions);
      const duration = Date.now() - startTime;

      // Record metrics
      await this.metrics.recordTimer("api_gateway_request_duration", duration);
      await this.metrics.recordCounter(`api_gateway_status_${response.status}`);

      if (!response.ok) {
        await this.metrics.recordCounter("api_gateway_errors");

        const errorText = await response.text();
        this.logger.warn("API Gateway error response", {
          status: response.status,
          url,
          error: errorText,
        });

        return {
          success: false,
          error: `HTTP ${response.status}: ${errorText}`,
          status: response.status,
        };
      }

      // Parse response
      let data: any;
      const contentType = response.headers.get("content-type");

      if (contentType?.includes("application/json")) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      await this.metrics.recordCounter("api_gateway_success");

      this.logger.debug("API Gateway response", {
        status: response.status,
        duration,
        dataSize: JSON.stringify(data).length,
      });

      // Convert headers to object
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      return {
        success: true,
        data,
        status: response.status,
        headers: responseHeaders,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      await this.metrics.recordCounter("api_gateway_request_failures");
      await this.metrics.recordTimer(
        "api_gateway_failed_request_duration",
        duration
      );

      this.logger.error("API Gateway request failed", error as Error, {
        path,
        method: options.method || "GET",
        duration,
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Make a GET request with caching
   */
  async get(
    path: string,
    authHeader?: string,
    cacheTTL?: number
  ): Promise<APIGatewayResponse> {
    // Check cache first if TTL is specified
    if (cacheTTL && cacheTTL > 0) {
      const cacheKey = `api_gateway:${path}`;
      const cached = await this.cache.get(cacheKey);

      if (cached) {
        await this.metrics.recordCounter("api_gateway_cache_hits");
        return cached as APIGatewayResponse;
      }
    }

    const response = await this.request(path, {
      method: "GET",
      headers: authHeader ? { Authorization: authHeader } : undefined,
    });

    // Cache successful responses
    if (response.success && cacheTTL && cacheTTL > 0) {
      const cacheKey = `api_gateway:${path}`;
      await this.cache.set(cacheKey, response, cacheTTL);
      await this.metrics.recordCounter("api_gateway_cache_sets");
    }

    return response;
  }

  /**
   * Make a POST request
   */
  async post(
    path: string,
    body: any,
    authHeader?: string
  ): Promise<APIGatewayResponse> {
    return this.request(path, {
      method: "POST",
      body,
      headers: authHeader ? { Authorization: authHeader } : undefined,
    });
  }

  /**
   * Make a PUT request
   */
  async put(
    path: string,
    body: any,
    authHeader?: string
  ): Promise<APIGatewayResponse> {
    return this.request(path, {
      method: "PUT",
      body,
      headers: authHeader ? { Authorization: authHeader } : undefined,
    });
  }

  /**
   * Make a DELETE request
   */
  async delete(path: string, authHeader?: string): Promise<APIGatewayResponse> {
    return this.request(path, {
      method: "DELETE",
      headers: authHeader ? { Authorization: authHeader } : undefined,
    });
  }

  /**
   * Fetch analytics data from data intelligence service
   */
  async fetchAnalytics(
    type: string,
    params?: Record<string, any>,
    authHeader?: string
  ): Promise<APIGatewayResponse> {
    const queryParams = new URLSearchParams();

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          queryParams.set(key, String(value));
        }
      });
    }

    const path = `/api/data/v1/analytics/${type}${
      queryParams.toString() ? "?" + queryParams.toString() : ""
    }`;
    return this.get(path, authHeader, 300); // Cache for 5 minutes
  }

  /**
   * Fetch features data
   */
  async fetchFeatures(
    cartId: string,
    authHeader?: string
  ): Promise<APIGatewayResponse> {
    const path = `/api/data/v1/features/${cartId}`;
    return this.get(path, authHeader, 60); // Cache for 1 minute
  }

  /**
   * Fetch export data
   */
  async fetchExport(
    type: string,
    params?: Record<string, any>,
    authHeader?: string
  ): Promise<APIGatewayResponse> {
    const queryParams = new URLSearchParams();

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          queryParams.set(key, String(value));
        }
      });
    }

    const path = `/api/data/v1/export/${type}${
      queryParams.toString() ? "?" + queryParams.toString() : ""
    }`;
    return this.get(path, authHeader); // Don't cache exports
  }

  /**
   * Submit GDPR request
   */
  async submitGDPRRequest(
    type: "forget" | "export",
    userId: string,
    authHeader?: string
  ): Promise<APIGatewayResponse> {
    const path = `/api/data/v1/gdpr/${type}/${userId}`;
    return this.request(path, {
      method: "POST",
      headers: authHeader ? { Authorization: authHeader } : undefined,
    });
  }

  /**
   * Check GDPR request status
   */
  async checkGDPRStatus(
    requestId: string,
    authHeader?: string
  ): Promise<APIGatewayResponse> {
    const path = `/api/data/v1/gdpr/status/${requestId}`;
    return this.get(path, authHeader, 30); // Cache for 30 seconds
  }

  /**
   * Generate report through data intelligence service
   */
  async generateReport(
    type: string,
    parameters: Record<string, any>,
    authHeader?: string
  ): Promise<APIGatewayResponse> {
    return this.post(
      "/api/data/v1/reports/generate",
      {
        type,
        ...parameters,
      },
      authHeader
    );
  }

  /**
   * Get report by ID
   */
  async getReport(
    reportId: string,
    authHeader?: string
  ): Promise<APIGatewayResponse> {
    const path = `/api/data/v1/reports/${reportId}`;
    return this.get(path, authHeader, 300); // Cache for 5 minutes
  }

  /**
   * Health check for API Gateway
   */
  async healthCheck(): Promise<GatewayHealth> {
    try {
      const startTime = Date.now();

      const response = await this.request("/health", {
        method: "GET",
        timeout: 5000, // 5 second timeout for health checks
      });

      const latency = Date.now() - startTime;

      let status: "healthy" | "degraded" | "unhealthy";

      if (response.success) {
        status = latency < 1000 ? "healthy" : "degraded";
      } else {
        status = "unhealthy";
      }

      return {
        status,
        latency,
        lastCheck: new Date(),
      };
    } catch (error) {
      this.logger.error("API Gateway health check failed", error as Error);

      return {
        status: "unhealthy",
        lastCheck: new Date(),
      };
    }
  }

  /**
   * Get API Gateway statistics
   */
  async getStats(): Promise<Record<string, any>> {
    try {
      const health = await this.healthCheck();

      return {
        gatewayUrl: this.gatewayUrl,
        health: health.status,
        latency: health.latency,
        lastHealthCheck: health.lastCheck.toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to get API Gateway stats", error as Error);
      return {
        gatewayUrl: this.gatewayUrl,
        health: "unknown",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Clear API Gateway cache
   */
  async clearCache(): Promise<void> {
    try {
      await this.cache.deletePattern("api_gateway:*");
      this.logger.info("API Gateway cache cleared");
    } catch (error) {
      this.logger.error("Failed to clear API Gateway cache", error as Error);
    }
  }

  /**
   * Batch request multiple endpoints
   */
  async batchRequest(
    requests: Array<{ path: string; options?: APIGatewayRequest }>
  ): Promise<APIGatewayResponse[]> {
    try {
      const promises = requests.map(({ path, options }) =>
        this.request(path, options)
      );

      const responses = await Promise.allSettled(promises);

      return responses.map((result) => {
        if (result.status === "fulfilled") {
          return result.value;
        } else {
          return {
            success: false,
            error:
              result.reason instanceof Error
                ? result.reason.message
                : "Request failed",
          };
        }
      });
    } catch (error) {
      this.logger.error("Batch request failed", error as Error);
      throw error;
    }
  }
}
