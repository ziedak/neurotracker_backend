/**
 * AuthV2Config unit tests
 * Covers config creation, defaults, and env loading
 */
import {
  DEFAULT_CONFIG,
  createAuthV2Config,
  loadConfigFromEnv,
} from "../src/services/token/config";

describe("AuthV2Config", () => {
  it("should export default config", () => {
    expect(DEFAULT_CONFIG).toHaveProperty("encryption");
    expect(DEFAULT_CONFIG).toHaveProperty("session");
  });

  it("should create config with overrides", () => {
    const customKey = "custom-key-that-is-at-least-32-chars-long";
    const config = createAuthV2Config({ encryption: { key: customKey } });
    expect(config.encryption.key).toBe(customKey);
  });

  it("should load config from env", () => {
    const envKey = "env-key-that-is-at-least-32-chars-long";
    process.env["KEYCLOAK_ENCRYPTION_KEY"] = envKey;
    const config = loadConfigFromEnv();
    expect(config.encryption.key).toBe(envKey);
    delete process.env["KEYCLOAK_ENCRYPTION_KEY"];
  });

  it("should fallback to default if env missing", () => {
    delete process.env["KEYCLOAK_ENCRYPTION_KEY"];
    const config = loadConfigFromEnv();
    expect(config.encryption.key).toBe(DEFAULT_CONFIG.encryption.key);
  });
});
