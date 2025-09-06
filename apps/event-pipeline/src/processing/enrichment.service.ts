import { PostgreSQLClient } from "@libs/database";
import { createLogger } from "libs/utils/src/Logger";
import { inject } from "tsyringe";

export class EnrichmentService {
  private logger = createLogger("EnrichmentService");
  constructor(@inject("PostgreSQLClient") private db: PostgreSQLClient) {}

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
