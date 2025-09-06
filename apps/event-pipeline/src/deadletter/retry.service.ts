import { createLogger } from "libs/utils/src/Logger";
import { RoutingService } from "../processing/routing.service";

export class RetryService {
  private routingService = new RoutingService();
  private logger = createLogger("event-pipeline-retry");

  async retry(event: any) {
    try {
      this.logger.info("Retrying dead letter event", { event });
      await this.routingService.route(event);
      return { status: "retried" };
    } catch (error: any) {
      this.logger.error("Retry failed", error);
      return { status: "error", message: error.message };
    }
  }
}
