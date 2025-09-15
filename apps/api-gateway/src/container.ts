import { createLogger, ILogger } from "@libs/utils";
import { MetricsCollector } from "@libs/monitoring";

import { EndpointRegistryService } from "./services/EndpointRegistryService";

/**
 * Simple service container for API Gateway
 * Creates and manages service instances
 */
export class GatewayContainer {
  private _initialized: boolean = false;
  private _logger: ILogger | null = null;
  private _metricsCollector: MetricsCollector | null = null;
  private _endpointRegistry: EndpointRegistryService | null = null;

  /**
   * Initialize all services
   */
  public initialize(): void {
    if (this._initialized) return;

    // Create logger instance
    this._logger = createLogger("api-gateway");

    // Create metrics collector instance
    this._metricsCollector = MetricsCollector.create();

    // Create endpoint registry service
    this._endpointRegistry = new EndpointRegistryService(this._logger);

    this._initialized = true;

    this._logger.info("API Gateway Container initialized");
  }

  /**
   * Get logger service
   */
  public getLogger(): ILogger {
    if (!this._logger) throw new Error("Container not initialized");
    return this._logger;
  }

  /**
   * Get metrics collector service
   */
  public getMetricsCollector(): MetricsCollector {
    if (!this._metricsCollector) throw new Error("Container not initialized");
    return this._metricsCollector;
  }

  /**
   * Get endpoint registry service
   */
  public getEndpointRegistry(): EndpointRegistryService {
    if (!this._endpointRegistry) throw new Error("Container not initialized");
    return this._endpointRegistry;
  }
}

// Export singleton instance
export const container = new GatewayContainer();
