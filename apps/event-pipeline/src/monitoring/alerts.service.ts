import { createLogger } from "@libs/utils";

export class AlertsService {
  private logger = createLogger("event-pipeline-alerts");
  alert(message: string, meta?: any) {
    // Log alert and optionally store/notify
    this.logger.warn(`ALERT: ${message}`, meta);
    // TODO: Integrate with notification system (email, Slack, etc.)
  }
}
