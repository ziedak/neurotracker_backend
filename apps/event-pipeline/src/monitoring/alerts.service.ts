import { Logger } from "@libs/monitoring";

const logger = new Logger("event-pipeline-alerts");

export class AlertsService {
  alert(message: string, meta?: any) {
    // Log alert and optionally store/notify
    logger.warn(`ALERT: ${message}`, meta);
    // TODO: Integrate with notification system (email, Slack, etc.)
  }
}
