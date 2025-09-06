import { createLogger } from "libs/utils/src/Logger";

export class ValidatorService {
  private logger = createLogger("event-pipeline-schema-validator");
  validate(event: any, schema: any): boolean {
    // Basic shape validation
    if (!schema || typeof schema !== "object")
      throw new Error("Invalid schema");
    for (const key of Object.keys(schema)) {
      if (!(key in event)) {
        this.logger.warn("Event missing required field", { key });
        return false;
      }
    }
    return true;
  }
}
