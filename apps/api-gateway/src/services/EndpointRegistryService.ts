import { Logger } from "@libs/monitoring";
/**
 * ServiceInstance: Represents a service endpoint instance
 */
export interface ServiceInstance {
  url: string;
  // Future: add metadata (health, version, etc.)
}

/**
 * LoadBalancingStrategy: Supported strategies for selecting service instance
 */
export type LoadBalancingStrategy = "random" | "roundRobin";

/**
 * EndpointRegistryService: Manages service instance URLs for API Gateway routing
 * - Strict TypeScript, clean architecture, extensible
 * - Parameterized load balancing
 */
export class EndpointRegistryService {
  private services = new Map<string, ServiceInstance[]>();
  private roundRobinIndex = new Map<string, number>();

  constructor(private logger: Logger) {}

  /**
   * Register a new service instance URL
   * @param serviceName - Name of the service
   * @param url - Endpoint URL
   */
  register(serviceName: string, url: string): void {
    if (!this.services.has(serviceName)) {
      this.services.set(serviceName, []);
      this.roundRobinIndex.set(serviceName, 0);
    }
    const instances = this.services.get(serviceName)!;
    if (!instances.some((inst) => inst.url === url)) {
      instances.push({ url });
      this.logger.info("Service registered", { serviceName, url });
    }
  }

  /**
   * Get a service instance URL using the specified load balancing strategy
   * @param serviceName - Name of the service
   * @param strategy - Load balancing strategy (default: random)
   * @returns Service instance URL or null
   */
  getService(
    serviceName: string,
    strategy: LoadBalancingStrategy = "random"
  ): string | null {
    const instances = this.services.get(serviceName);
    if (!instances || instances.length === 0) {
      this.logger.warn("No instances available for service", { serviceName });
      return null;
    }
    if (strategy === "roundRobin") {
      const idx = this.roundRobinIndex.get(serviceName) ?? 0;
      const instance = instances[idx % instances.length];
      this.roundRobinIndex.set(serviceName, (idx + 1) % instances.length);
      return instance.url;
    }
    // Default: random
    const index = Math.floor(Math.random() * instances.length);
    return instances[index].url;
  }

  /**
   * Remove a service instance URL
   * @param serviceName - Name of the service
   * @param url - Endpoint URL
   */
  removeService(serviceName: string, url: string): void {
    const instances = this.services.get(serviceName);
    if (!instances) {
      this.logger.warn("Service not found for removal", { serviceName });
      return;
    }
    const index = instances.findIndex((inst) => inst.url === url);
    if (index > -1) {
      instances.splice(index, 1);
      this.logger.info("Service unregistered", { serviceName, url });
    } else {
      this.logger.warn("Instance URL not found for removal", {
        serviceName,
        url,
      });
    }
  }

  /**
   * Get all registered services and their instances
   */
  getAllServices(): Array<{
    name: string;
    instances: string[];
    healthy: boolean;
  }> {
    return Array.from(this.services.entries()).map(([name, instances]) => ({
      name,
      instances: instances.map((inst) => inst.url),
      healthy: instances.length > 0,
    }));
  }

  /**
   * Get total number of registered services
   */
  getServiceCount(): number {
    return this.services.size;
  }

  /**
   * Get number of healthy services (with at least one instance)
   */
  getHealthyServiceCount(): number {
    return Array.from(this.services.values()).filter(
      (instances) => instances.length > 0
    ).length;
  }
}
