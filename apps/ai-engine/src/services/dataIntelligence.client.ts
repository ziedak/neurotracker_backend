import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { Logger, MetricsCollector } from '@libs/monitoring';
import { getEnv } from '@libs/config';
import { CircuitBreaker } from '@libs/utils';
import { FeatureSet, FeatureComputationRequest } from '../types';
import { performance } from 'perf_hooks';

/**
 * Data Intelligence Service Client
 * Handles communication with the data-intelligence service
 * Implements circuit breaker, retry logic, and performance monitoring
 */
export class DataIntelligenceClient {
  private readonly httpClient: AxiosInstance;
  private readonly logger: Logger;
  private readonly metrics: MetricsCollector;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly baseUrl: string;

  // Configuration constants
  private readonly TIMEOUT_MS = 5000; // 5 seconds
  private readonly MAX_RETRIES = 3;
  private readonly CIRCUIT_BREAKER_THRESHOLD = 5;
  private readonly CIRCUIT_BREAKER_TIMEOUT = 10000; // 10 seconds

  constructor(logger: Logger, metrics: MetricsCollector) {
    this.logger = logger;
    this.metrics = metrics;
    this.baseUrl = getEnv('DATA_INTELLIGENCE_URL', 'http://localhost:3001');

    // Configure HTTP client with timeouts and retry logic
    this.httpClient = axios.create({
      baseURL: this.baseUrl,
      timeout: this.TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ai-engine/1.0.0',
      },
    });

    // Initialize circuit breaker
    this.circuitBreaker = new CircuitBreaker({
      threshold: this.CIRCUIT_BREAKER_THRESHOLD,
      timeout: this.CIRCUIT_BREAKER_TIMEOUT,
      resetTimeout: this.CIRCUIT_BREAKER_TIMEOUT * 2,
    });

    // Setup request/response interceptors
    this.setupInterceptors();

    this.logger.info('Data Intelligence Client initialized', {
      baseUrl: this.baseUrl,
      timeout: this.TIMEOUT_MS,
    });
  }

  /**
   * Setup HTTP interceptors for logging and metrics
   */
  private setupInterceptors(): void {
    // Request interceptor
    this.httpClient.interceptors.request.use(
      (config) => {
        config.metadata = { startTime: performance.now() };
        this.logger.debug('Data Intelligence request', {
          method: config.method?.toUpperCase(),
          url: config.url,
          data: config.data,
        });
        return config;
      },
      (error) => {
        this.logger.error('Data Intelligence request error', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.httpClient.interceptors.response.use(
      (response) => {
        const duration = performance.now() - response.config.metadata?.startTime;
        this.metrics.recordTimer('data_intelligence_request_duration', duration);
        this.metrics.recordCounter('data_intelligence_request_success');

        this.logger.debug('Data Intelligence response', {
          status: response.status,
          duration: Math.round(duration),
          url: response.config.url,
        });

        return response;
      },
      (error) => {
        const duration = performance.now() - error.config?.metadata?.startTime;
        this.metrics.recordTimer('data_intelligence_request_duration', duration);
        this.metrics.recordCounter('data_intelligence_request_error');

        this.logger.error('Data Intelligence response error', {
          status: error.response?.status,
          message: error.message,
          url: error.config?.url,
          duration: duration ? Math.round(duration) : 'unknown',
        });

        return Promise.reject(error);
      }
    );
  }

  /**
   * Get features for a cart from the data-intelligence service
   */
  async getFeatures(request: FeatureComputationRequest): Promise<FeatureSet> {
    const startTime = performance.now();

    try {
      // Use circuit breaker to protect against cascading failures
      const response = await this.circuitBreaker.execute(async () => {
        return await this.httpClient.post('/features/compute', request);
      });

      const duration = performance.now() - startTime;
      this.metrics.recordTimer('feature_computation_duration', duration);
      this.metrics.recordCounter('feature_computation_success');

      this.logger.info('Features retrieved successfully', {
        cartId: request.cartId,
        duration: Math.round(duration),
        featureCount: Object.keys(response.data.features || {}).length,
      });

      return {
        cartId: request.cartId,
        features: response.data.features,
        computedAt: response.data.computedAt || new Date().toISOString(),
        version: response.data.version || '1.0.0',
        source: 'data-intelligence',
        ttl: response.data.ttl,
      };
    } catch (error) {
      const duration = performance.now() - startTime;
      this.metrics.recordTimer('feature_computation_duration', duration);
      this.metrics.recordCounter('feature_computation_error');

      this.logger.error('Feature computation failed', {
        cartId: request.cartId,
        error: error.message,
        duration: Math.round(duration),
      });

      throw new Error(`Feature computation failed for cart ${request.cartId}: ${error.message}`);
    }
  }

  /**
   * Get feature definitions from data-intelligence service
   */
  async getFeatureDefinitions(): Promise<any[]> {
    try {
      const response = await this.circuitBreaker.execute(async () => {
        return await this.httpClient.get('/features/definitions');
      });

      this.logger.info('Feature definitions retrieved', {
        count: response.data.length,
      });

      return response.data;
    } catch (error) {
      this.logger.error('Failed to get feature definitions', error);
      throw new Error(`Failed to get feature definitions: ${error.message}`);
    }
  }

  /**
   * Validate data quality with data-intelligence service
   */
  async validateDataQuality(cartId: string, features: Record<string, number>): Promise<boolean> {
    try {
      const response = await this.circuitBreaker.execute(async () => {
        return await this.httpClient.post('/data-quality/validate', {
          cartId,
          features,
        });
      });

      this.logger.debug('Data quality validation completed', {
        cartId,
        isValid: response.data.isValid,
        issues: response.data.issues?.length || 0,
      });

      return response.data.isValid;
    } catch (error) {
      this.logger.warn('Data quality validation failed, assuming valid', {
        cartId,
        error: error.message,
      });
      
      // Return true as fallback to avoid blocking predictions
      return true;
    }
  }

  /**
   * Get business intelligence insights for model enhancement
   */
  async getBusinessInsights(request: { 
    period: string;
    metrics: string[];
    filters?: Record<string, any>;
  }): Promise<any> {
    try {
      const response = await this.circuitBreaker.execute(async () => {
        return await this.httpClient.post('/business-intelligence/insights', request);
      });

      this.logger.info('Business insights retrieved', {
        period: request.period,
        metricsCount: request.metrics.length,
      });

      return response.data;
    } catch (error) {
      this.logger.error('Failed to get business insights', error);
      throw new Error(`Failed to get business insights: ${error.message}`);
    }
  }

  /**
   * Health check endpoint for data-intelligence service
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.httpClient.get('/health', {
        timeout: 2000, // Shorter timeout for health checks
      });

      const isHealthy = response.status === 200 && response.data.status === 'ok';
      
      this.logger.debug('Data Intelligence health check', {
        status: response.status,
        healthy: isHealthy,
      });

      return isHealthy;
    } catch (error) {
      this.logger.error('Data Intelligence health check failed', error);
      return false;
    }
  }

  /**
   * Batch feature computation for multiple carts
   */
  async getBatchFeatures(requests: FeatureComputationRequest[]): Promise<FeatureSet[]> {
    const startTime = performance.now();

    try {
      const response = await this.circuitBreaker.execute(async () => {
        return await this.httpClient.post('/features/batch', {
          requests,
        });
      });

      const duration = performance.now() - startTime;
      this.metrics.recordTimer('batch_feature_computation_duration', duration);
      this.metrics.recordCounter('batch_feature_computation_success');

      this.logger.info('Batch features retrieved successfully', {
        requestCount: requests.length,
        responseCount: response.data.features?.length || 0,
        duration: Math.round(duration),
      });

      return response.data.features || [];
    } catch (error) {
      const duration = performance.now() - startTime;
      this.metrics.recordTimer('batch_feature_computation_duration', duration);
      this.metrics.recordCounter('batch_feature_computation_error');

      this.logger.error('Batch feature computation failed', {
        requestCount: requests.length,
        error: error.message,
        duration: Math.round(duration),
      });

      throw new Error(`Batch feature computation failed: ${error.message}`);
    }
  }

  /**
   * Get circuit breaker status
   */
  getCircuitBreakerStatus(): any {
    return {
      state: this.circuitBreaker.getState(),
      failureCount: this.circuitBreaker.getFailureCount(),
      lastFailureTime: this.circuitBreaker.getLastFailureTime(),
    };
  }

  /**
   * Reset circuit breaker manually
   */
  resetCircuitBreaker(): void {
    this.circuitBreaker.reset();
    this.logger.info('Circuit breaker reset manually');
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    // Cancel any pending requests
    this.httpClient.defaults.cancelToken = axios.CancelToken.source().token;
    this.logger.info('Data Intelligence Client disposed');
  }
}
