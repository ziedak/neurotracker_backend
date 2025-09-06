import { createLogger } from "libs/utils/src/Logger";

interface SchemaVersion {
  version: string;
  schema: any;
  registeredAt: string;
}

export class RegistryService {
  private registry: Map<string, SchemaVersion> = new Map();
  private logger = createLogger("event-pipeline-schema-registry");

  registerSchema(version: string, schema: any) {
    this.registry.set(version, {
      version,
      schema,
      registeredAt: new Date().toISOString(),
    });
    this.logger.info("Schema registered", { version });
  }

  getSchema(version: string): SchemaVersion | undefined {
    return this.registry.get(version);
  }

  listSchemas(): SchemaVersion[] {
    return Array.from(this.registry.values());
  }
}
