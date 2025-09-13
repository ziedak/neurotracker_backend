// Mock for @keycloak/keycloak-admin-client
export default class KeycloakAdminClient {
  constructor() {
    // Mock constructor
  }

  // Mock methods as needed
  async auth(): Promise<void> {
    return Promise.resolve();
  }

  users(): Promise<{
    find: jest.MockedFunction<() => Promise<unknown[]>>;
    create: jest.MockedFunction<(user: unknown) => Promise<unknown>>;
    update: jest.MockedFunction<(user: unknown) => Promise<unknown>>;
    del: jest.MockedFunction<(userId: string) => Promise<void>>;
  }> {
    return Promise.resolve({
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      del: jest.fn().mockResolvedValue(undefined),
    });
  }

  realms(): Promise<{
    find: jest.MockedFunction<() => Promise<unknown[]>>;
    create: jest.MockedFunction<(realm: unknown) => Promise<unknown>>;
  }> {
    return Promise.resolve({
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
    });
  }
}

export { KeycloakAdminClient };
