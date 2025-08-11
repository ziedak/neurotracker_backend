import { Logger } from "@libs/monitoring";

/**
 * Authentication Middleware for Dashboard
 * Basic implementation for development purposes
 */
export class AuthMiddleware {
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Simple authentication check
   */
  async authenticate(request: any): Promise<any> {
    try {
      // For development - allow all requests
      this.logger.debug("Authentication passed (development mode)");
      return request;
    } catch (error) {
      this.logger.error("Authentication failed", error as Error);
      throw error;
    }
  }
}
