// Mock for @libs/config
export const getEnv = jest.fn().mockReturnValue("mock-value");

export const config = {
  keycloak: {
    url: "http://localhost:8080",
    realm: "test-realm",
    clientId: "test-client",
    clientSecret: "test-secret",
  },
  jwt: {
    secret: "test-jwt-secret",
    expiresIn: "1h",
  },
  database: {
    url: "postgresql://test:test@localhost:5432/test",
  },
  redis: {
    url: "redis://localhost:6379",
  },
};
