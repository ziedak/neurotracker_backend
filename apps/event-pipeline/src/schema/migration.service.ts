import { createLogger } from "@libs/utils";

export class MigrationService {
  private logger = createLogger("event-pipeline-schema-migration");
  migrate(oldSchema: any, newSchema: any): any {
    // For now, just log and return new schema
    this.logger.info("Schema migration", {
      from: oldSchema?.version,
      to: newSchema?.version,
    });
    return newSchema;
  }
}
