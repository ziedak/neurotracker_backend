import axios, { AxiosRequestConfig, AxiosResponse, AxiosError } from "axios";
import { executeWithRetry } from "@libs/utils";

/**
 * HTTP Client Configuration Interface
 */
export interface HttpClientConfig {
  timeout?: number;
  headers?: Record<string, string>;
  baseURL?: string;
  retries?: number;
  retryDelay?: number;
}

/**
 * HTTP Error Response Interface
 */
export interface HttpErrorResponse {
  status: number;
  statusText: string;
  data?: any;
  message: string;
}

/**
 * Enhanced HTTP Client with better configuration and error handling
 */
export class HttpClient {
  private client: ReturnType<typeof axios.create>;
  private config: HttpClientConfig;

  constructor(config: HttpClientConfig = {}) {
    this.config = {
      timeout: 5000,
      headers: { "Content-Type": "application/json" },
      retries: 3,
      retryDelay: 500,
      ...config,
    };

    const axiosConfig: any = {
      timeout: this.config.timeout,
      headers: this.config.headers || { "Content-Type": "application/json" },
    };

    if (this.config.baseURL) {
      axiosConfig.baseURL = this.config.baseURL;
    }

    this.client = axios.create(axiosConfig);

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    // Request interceptor
    this.client.interceptors.request.use(
      (config) => {
        // Add request ID for tracking
        if (config.headers) {
          (config.headers as any)["X-Request-ID"] = crypto.randomUUID();
        } else {
          config.headers = { "X-Request-ID": crypto.randomUUID() } as any;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        const errorResponse: HttpErrorResponse = {
          status: error.response?.status || 0,
          statusText: error.response?.statusText || "Unknown Error",
          data: error.response?.data,
          message: error.message,
        };
        return Promise.reject(errorResponse);
      }
    );
  }

  async request<T = unknown>(
    config: AxiosRequestConfig
  ): Promise<AxiosResponse<T>> {
    return this.client.request<T>(config);
  }

  /**
   * Make a request and return parsed JSON data
   */
  async requestJson<T = unknown>(config: AxiosRequestConfig): Promise<T> {
    const response = await this.request<T>(config);
    return response.data;
  }

  /**
   * GET request that returns JSON data
   */
  async get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.request<T>({ ...config, method: "GET", url });
    return response.data;
  }

  /**
   * POST request that returns JSON data
   */
  async post<T = unknown>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<T> {
    const response = await this.request<T>({
      ...config,
      method: "POST",
      url,
      data,
    });
    return response.data;
  }
}

// Legacy export for backward compatibility
export const httpClient = new HttpClient();

/**
 * Generic HTTP request with retry and error handling
 * @template T - Expected response data type
 * @param config - Axios request config
 * @param retryCount - Number of retries
 * @param retryDelay - Delay between retries (ms)
 * @returns AxiosResponse<T>
 */
/**
 * Enhanced HTTP request with retry, circuit breaker, and better error handling
 */
export async function sendHttpRequestWithRetryAndBreaker<T = unknown>(
  config: AxiosRequestConfig,
  retryCount = 3,
  retryDelay = 500
): Promise<AxiosResponse<T>> {
  const httpClient = new HttpClient({
    retries: retryCount,
    retryDelay,
  });

  return executeWithRetry(
    async () => {
      const response = await httpClient.request<T>(config);
      if (response.status >= 200 && response.status < 300) {
        return response;
      }
      const error = new Error(
        `HTTP request failed: ${response.statusText}`
      ) as any;
      error.status = response.status;
      error.response = response;
      throw error;
    },
    (error: any) => {
      if (error.status) {
        return `HTTP ${error.status}: ${error.message}`;
      }
      return `HTTP request failed: ${error.message || error}`;
    },
    {
      operationName: "HTTP Request",
      maxRetries: retryCount,
      retryDelay,
      enableCircuitBreaker: true,
    }
  );
}

/**
 * Simple retry logic without circuit breaker (deprecated - use sendHttpRequestWithRetryAndBreaker)
 * @deprecated Use sendHttpRequestWithRetryAndBreaker for better error handling
 */
export async function requestWithRetry<T = unknown>(
  config: AxiosRequestConfig,
  retryCount = 3,
  retryDelay = 500
): Promise<AxiosResponse<T>> {
  const httpClient = new HttpClient({ retries: retryCount, retryDelay });
  let lastError: HttpErrorResponse | unknown;

  for (let attempt = 0; attempt <= retryCount; attempt++) {
    try {
      const response = await httpClient.request<T>(config);
      if (response.status >= 200 && response.status < 300) {
        return response;
      }
      lastError = {
        status: response.status,
        statusText: response.statusText,
        data: response.data,
        message: `HTTP ${response.status}: ${response.statusText}`,
      } as HttpErrorResponse;
    } catch (error) {
      lastError = error;
    }

    if (attempt < retryCount) {
      await new Promise((resolve) =>
        setTimeout(resolve, retryDelay * Math.pow(2, attempt))
      ); // Exponential backoff
    }
  }

  throw lastError;
}

/**
 * Create a typed HTTP client for specific API endpoints
 */
export function createTypedHttpClient(
  config: HttpClientConfig = {}
): HttpClient {
  return new HttpClient(config);
}

/**
 * HTTP status code utilities
 */
export const HttpStatus = {
  isSuccess: (status: number): boolean => status >= 200 && status < 300,
  isClientError: (status: number): boolean => status >= 400 && status < 500,
  isServerError: (status: number): boolean => status >= 500,
  isRetryable: (status: number): boolean =>
    status >= 500 || status === 408 || status === 429,
} as const;

/**
 * Enhanced HTTP request that returns JSON data directly
 */
export async function sendHttpRequestForJson<T = unknown>(
  config: AxiosRequestConfig,
  retryCount = 3,
  retryDelay = 500
): Promise<T> {
  const response = await sendHttpRequestWithRetryAndBreaker<T>(
    config,
    retryCount,
    retryDelay
  );
  return response.data;
}

/**
 * Export default instance for backward compatibility
 */
export default new HttpClient();
