/**
 * AuthV2Config integration tests
 * Covers environment variable loading and default fallback
 */
import { loadConfigFromEnv, DEFAULT_CONFIG } from "../../src/services/config";

describe("AuthV2Config Integration", () => {
  afterEach(() => {
    delete process.env.KEYCLOAK_ENCRYPTION_KEY;
  });

  it("should load encryption key from environment", () => {
    process.env.KEYCLOAK_ENCRYPTION_KEY = "integration-env-key";
    const config = loadConfigFromEnv();
    expect(config.encryption.key).toBe("integration-env-key");
  });

  it("should fallback to default if env missing", () => {
    const config = loadConfigFromEnv();
    expect(config.encryption.key).toBe(DEFAULT_CONFIG.encryption.key);
  });
});
