import { createLogger } from "@libs/utils";
import { HttpClient } from "@libs/messaging";
import { injectable } from "tsyringe";

@injectable()
export class RoutingService {
  private logger;
  private httpClient: HttpClient;

  constructor() {
    this.logger = createLogger("RoutingService");
    this.httpClient = new HttpClient();
  }

  async route(event: any): Promise<void> {
    try {
      switch (event.eventType) {
        case "cart_abandoned":
          await this.httpClient.post(
            "http://prediction:3002/api/predict/analyze",
            event
          );
          break;
        case "cart_updated":
          await this.httpClient.post(
            "http://analytics:3004/api/analytics/update",
            event
          );
          break;
        case "purchase_completed":
          await this.httpClient.post(
            "http://completion:3005/api/completion/trigger",
            event
          );
          break;
        default:
          this.logger.info("Event type not routed", {
            eventType: event.eventType,
          });
      }
      this.logger.info("Event routed", {
        eventId: event.eventId,
        eventType: event.eventType,
      });
    } catch (error) {
      this.logger.error("Routing failed", error as Error, { event });
      throw error;
    }
  }
}
