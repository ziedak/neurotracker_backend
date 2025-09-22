/**
 * AuthV2Config unit tests
 * Covers config creation, defaults, and env loading
 */
import {
  DEFAULT_CONFIG,
  createAuthV2Config,
  loadConfigFromEnv,
} from "../src/services/config";

describe("AuthV2Config", () => {
  it("should export default config", () => {
    expect(DEFAULT_CONFIG).toHaveProperty("encryption");
    expect(DEFAULT_CONFIG).toHaveProperty("session");
  });

  it("should create config with overrides", () => {
    const config = createAuthV2Config({ encryption: { key: "custom-key" } });
    expect(config.encryption.key).toBe("custom-key");
  });

  it("should load config from env", () => {
    process.env["KEYCLOAK_ENCRYPTION_KEY"] = "env-key";
    const config = loadConfigFromEnv();
    expect(config.encryption.key).toBe("env-key");
    delete process.env["KEYCLOAK_ENCRYPTION_KEY"];
  });

  it("should fallback to default if env missing", () => {
    delete process.env["KEYCLOAK_ENCRYPTION_KEY"];
    const config = loadConfigFromEnv();
    expect(config.encryption.key).toBe(DEFAULT_CONFIG.encryption.key);
  });
});
