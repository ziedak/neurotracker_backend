// Mock for @keycloak/keycloak-admin-client
export default class KeycloakAdminClient {
  constructor() {
    // Mock constructor
  }

  // Mock methods as needed
  async auth() {
    return Promise.resolve();
  }

  async users() {
    return {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      del: jest.fn().mockResolvedValue(undefined),
    };
  }

  async realms() {
    return {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
    };
  }
}

export { KeycloakAdminClient };
