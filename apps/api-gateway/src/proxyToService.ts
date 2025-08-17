import { Logger } from "@libs/monitoring";
import { AppError } from "@libs/utils";
import type {
  EndpointRegistryService,
  LoadBalancingStrategy,
} from "./services/EndpointRegistryService";
import { requestWithRetry } from "@libs/messaging";

/**
 * Proxies an HTTP request to a registered service endpoint with retry and logging.
 * @template T - Expected response data type
 * @param serviceName - Name of the service to proxy to
 * @param request - Incoming HTTP request
 * @param serviceRegistry - Registry for service endpoints
 * @param logger - Logger instance
 * @param options - Proxy options (authHeader, loadBalancingStrategy, retryCount, retryDelay)
 * @returns Response data and status
 */
export async function proxyToService<T = unknown>(
  serviceName: string,
  request: Request,
  serviceRegistry: EndpointRegistryService,
  logger: Logger,
  options?: {
    authHeader?: string;
    loadBalancingStrategy?: LoadBalancingStrategy;
    retryCount?: number;
    retryDelay?: number;
  }
): Promise<{ data: T; status: number }> {
  const requestId = `proxy_${Date.now()}_${Math.random()
    .toString(36)
    .substr(2, 9)}`;

  logger.info("Proxying request", {
    requestId,
    serviceName,
    path: new URL(request.url).pathname,
  });

  try {
    const startTime = Date.now();

    // Get service URL from registry
    const serviceUrl = serviceRegistry.getService(
      serviceName,
      options?.loadBalancingStrategy ?? "random"
    );
    if (!serviceUrl) {
      throw new AppError(`${serviceName} service unavailable`, 503);
    }

    // Build target URL
    const url = new URL(request.url);
    const targetPath = url.pathname.replace(
      `/api/${serviceName.split("-")[0]}`,
      ""
    );
    const targetUrl = `${serviceUrl}${targetPath}${url.search}`;

    // Forward request with retry using messaging lib
    const headers: Record<string, string> = {
      "X-Request-ID": requestId,
      "X-Forwarded-For": request.headers.get("X-Forwarded-For") || "gateway",
      "Content-Type": request.headers.get("Content-Type") || "application/json",
    };
    if (options?.authHeader) {
      headers.Authorization = options.authHeader;
    }
    const axiosConfig = {
      url: targetUrl,
      method: request.method as any,
      headers,
      data:
        request.method !== "GET" && request.method !== "HEAD"
          ? await request.text()
          : undefined,
      validateStatus: () => true,
    };
    const response = await requestWithRetry<T>(
      axiosConfig,
      options?.retryCount ?? 3,
      options?.retryDelay ?? 500
    );

    const duration = Date.now() - startTime;
    logger.info("Proxy request completed", {
      requestId,
      serviceName,
      duration,
      status: response.status,
    });

    // Return response
    let data: T;
    if (response.headers["content-type"]?.includes("application/json")) {
      data = response.data as T;
    } else {
      data = response.data as unknown as T;
    }
    return { data, status: response.status };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error("Proxy error", err, { requestId, serviceName });
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError("Gateway error", 500);
  }
}
