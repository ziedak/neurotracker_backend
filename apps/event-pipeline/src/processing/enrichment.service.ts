import { PostgreSQLClient } from "@libs/database";
import { Logger } from "@libs/monitoring";

export class EnrichmentService {
  private db: any;
  private logger: Logger;

  constructor() {
    this.db = PostgreSQLClient.getInstance();
    this.logger = new Logger("EnrichmentService");
  }

  async enrich(event: any): Promise<any> {
    try {
      // Example: enrich with user and store info
      const user = event.userId
        ? await this.db.user.findUnique({ where: { id: event.userId } })
        : null;
      const store = event.storeId
        ? await this.db.store.findUnique({ where: { id: event.storeId } })
        : null;
      return {
        ...event,
        user,
        store,
      };
    } catch (error) {
      this.logger.error("Enrichment failed", error as Error, { event });
      return event;
    }
  }
}
