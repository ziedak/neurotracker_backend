// Mock for @keycloak/keycloak-admin-client
const mockKeycloakClient = {
  auth: jest.fn(),
  users: {
    create: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    del: jest.fn(),
    count: jest.fn(),
  },
  groups: {
    find: jest.fn(),
  },
  roles: {
    find: jest.fn(),
  },
  setConfig: jest.fn(),
  init: jest.fn(),
};

const KeycloakAdminClient = jest
  .fn()
  .mockImplementation(() => mockKeycloakClient);

export default KeycloakAdminClient;
export { KeycloakAdminClient };
