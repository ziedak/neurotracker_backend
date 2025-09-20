import { createLogger } from "@libs/utils";

export interface PolicyRepresentation {
  id?: string;
  name: string;
  description?: string;
  type:
    | "role"
    | "user"
    | "client"
    | "time"
    | "aggregate"
    | "resource"
    | "scope"
    | "js";
  logic?: "POSITIVE" | "NEGATIVE";
  decisionStrategy?: "UNANIMOUS" | "AFFIRMATIVE" | "CONSENSUS";
  config?: Record<string, any>;
}

export interface IKeycloakAuthorizationServicesClient {
  createPolicy(policy: PolicyRepresentation): Promise<PolicyRepresentation>;
}

export interface RoleHierarchy {
  [role: string]: {
    inherits: string[];
    permissions: string[];
    description?: string;
  };
}

const logger = createLogger("PolicySyncService");

export interface IPolicySyncService {
  syncPoliciesToKeycloak(
    roleHierarchy: RoleHierarchy,
    authzClient: IKeycloakAuthorizationServicesClient
  ): Promise<void>;
}

export class PolicySyncService implements IPolicySyncService {
  async syncPoliciesToKeycloak(
    roleHierarchy: RoleHierarchy,
    authzClient: IKeycloakAuthorizationServicesClient
  ): Promise<void> {
    logger.info("Syncing role hierarchy policies to Keycloak");
    for (const [roleName, roleDefinition] of Object.entries(roleHierarchy)) {
      try {
        // Create role-based policy
        const rolePolicy: PolicyRepresentation = {
          name: `${roleName}-policy`,
          type: "role",
          description:
            roleDefinition.description || `Policy for role: ${roleName}`,
          config: {
            roles: JSON.stringify([{ id: roleName, required: false }]),
          },
        };
        await authzClient.createPolicy(rolePolicy);

        // Create policies for inherited roles if they exist
        if (roleDefinition.inherits.length > 0) {
          const inheritancePolicy: PolicyRepresentation = {
            name: `${roleName}-inheritance-policy`,
            type: "role",
            description: `Inheritance policy for ${roleName}`,
            config: {
              roles: JSON.stringify(
                [roleName, ...roleDefinition.inherits].map((role) => ({
                  id: role,
                  required: false,
                }))
              ),
            },
          };
          await authzClient.createPolicy(inheritancePolicy);
        }
        logger.debug("Policy synced to Keycloak", { roleName });
      } catch (error) {
        logger.error("Failed to sync policy to Keycloak", {
          roleName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
