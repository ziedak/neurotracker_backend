import { Logger } from "@libs/monitoring";

const logger = Logger.getInstance("event-pipeline-schema-registry");

interface SchemaVersion {
  version: string;
  schema: any;
  registeredAt: string;
}

export class RegistryService {
  private registry: Map<string, SchemaVersion> = new Map();

  registerSchema(version: string, schema: any) {
    this.registry.set(version, {
      version,
      schema,
      registeredAt: new Date().toISOString(),
    });
    logger.info("Schema registered", { version });
  }

  getSchema(version: string): SchemaVersion | undefined {
    return this.registry.get(version);
  }

  listSchemas(): SchemaVersion[] {
    return Array.from(this.registry.values());
  }
}
