/**
 * AuthV2Config integration tests
 * Covers environment variable loading and default fallback
 */
import {
  loadConfigFromEnv,
  DEFAULT_CONFIG,
} from "../../src/services/token/config";

describe("AuthV2Config Integration", () => {
  afterEach(() => {
    delete process.env["KEYCLOAK_ENCRYPTION_KEY"];
  });

  it("should load encryption key from environment", () => {
    process.env["KEYCLOAK_ENCRYPTION_KEY"] =
      "this-is-a-valid-32-character-encryption-key-for-testing";
    const config = loadConfigFromEnv();
    expect(config.encryption.key).toBe(
      "this-is-a-valid-32-character-encryption-key-for-testing"
    );
  });

  it("should fallback to default if env missing", () => {
    const config = loadConfigFromEnv();
    expect(config.encryption.key).toBe(DEFAULT_CONFIG.encryption.key);
  });
});
