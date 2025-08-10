import { Logger } from "@libs/monitoring";
import { RoutingService } from "../processing/routing.service";

const logger = new Logger("event-pipeline-retry");

export class RetryService {
  private routingService = new RoutingService();

  async retry(event: any) {
    try {
      logger.info("Retrying dead letter event", { event });
      await this.routingService.route(event);
      return { status: "retried" };
    } catch (error: any) {
      logger.error("Retry failed", error);
      return { status: "error", message: error.message };
    }
  }
}
