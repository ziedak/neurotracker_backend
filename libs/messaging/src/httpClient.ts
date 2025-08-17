import axios, { AxiosRequestConfig, AxiosResponse } from "axios";

export const HttpClient = axios.create({
  timeout: 5000,
  headers: {
    "Content-Type": "application/json",
  },
});

/**
 * Generic HTTP request with retry and error handling
 * @template T - Expected response data type
 * @param config - Axios request config
 * @param retryCount - Number of retries
 * @param retryDelay - Delay between retries (ms)
 * @returns AxiosResponse<T>
 */
export async function requestWithRetry<T = unknown>(
  config: AxiosRequestConfig,
  retryCount = 3,
  retryDelay = 500
): Promise<AxiosResponse<T>> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retryCount; attempt++) {
    try {
      const response = await HttpClient.request<T>(config);
      if (response.status >= 200 && response.status < 300) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < retryCount) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }
  throw lastError;
}
