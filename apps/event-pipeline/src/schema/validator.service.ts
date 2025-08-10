import { Logger } from "@libs/monitoring";

const logger = new Logger("event-pipeline-schema-validator");

export class ValidatorService {
  validate(event: any, schema: any): boolean {
    // Basic shape validation
    if (!schema || typeof schema !== "object")
      throw new Error("Invalid schema");
    for (const key of Object.keys(schema)) {
      if (!(key in event)) {
        logger.warn("Event missing required field", { key });
        return false;
      }
    }
    return true;
  }
}
