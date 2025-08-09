import { Logger } from "@libs/monitoring";
import { AppError, retryWithBackoff } from "@libs/utils";

const logger = new Logger("service-registry");

export class ServiceRegistry {
  private services = new Map<string, string[]>();

  register(serviceName: string, url: string): void {
    if (!this.services.has(serviceName)) {
      this.services.set(serviceName, []);
    }
    const instances = this.services.get(serviceName)!;
    if (!instances.includes(url)) {
      instances.push(url);
      logger.info("Service registered", { serviceName, url });
    }
  }

  getService(serviceName: string): string | null {
    const instances = this.services.get(serviceName);
    if (!instances || instances.length === 0) {
      logger.warn("No instances available for service", { serviceName });
      return null;
    }

    // Simple round-robin load balancing
    const index = Math.floor(Math.random() * instances.length);
    return instances[index];
  }

  removeService(serviceName: string, url: string): void {
    const instances = this.services.get(serviceName);
    if (instances) {
      const index = instances.indexOf(url);
      if (index > -1) {
        instances.splice(index, 1);
        logger.info("Service unregistered", { serviceName, url });
      }
    }
  }

  getAllServices(): Array<{
    name: string;
    instances: string[];
    healthy: boolean;
  }> {
    return Array.from(this.services.entries()).map(([name, instances]) => ({
      name,
      instances,
      healthy: instances.length > 0,
    }));
  }

  getServiceCount(): number {
    return this.services.size;
  }

  getHealthyServiceCount(): number {
    return Array.from(this.services.values()).filter(
      (instances) => instances.length > 0
    ).length;
  }
}

// Service proxy function
export async function proxyToService(
  serviceName: string,
  request: Request,
  serviceRegistry: ServiceRegistry,
  authHeader?: string
): Promise<{ data: any; status: number }> {
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
    const serviceUrl = serviceRegistry.getService(serviceName);
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

    // Forward request with retry
    const response = await retryWithBackoff(
      async () => {
        const headers: Record<string, string> = {
          "X-Request-ID": requestId,
          "X-Forwarded-For":
            request.headers.get("X-Forwarded-For") || "gateway",
          "Content-Type":
            request.headers.get("Content-Type") || "application/json",
        };

        if (authHeader) {
          headers.Authorization = authHeader;
        }

        const proxyResponse = await fetch(targetUrl, {
          method: request.method,
          headers,
          body:
            request.method !== "GET" && request.method !== "HEAD"
              ? await request.text()
              : undefined,
        });

        if (!proxyResponse.ok) {
          throw new AppError(
            `Service responded with ${proxyResponse.status}`,
            proxyResponse.status
          );
        }

        return proxyResponse;
      },
      3,
      500
    );

    const duration = Date.now() - startTime;
    logger.info("Proxy request completed", {
      requestId,
      serviceName,
      duration,
      status: response.status,
    });

    // Return response
    const contentType = response.headers.get("content-type");
    let data: any;

    if (contentType?.includes("application/json")) {
      data = await response.json();
    } else {
      data = await response.text();
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
