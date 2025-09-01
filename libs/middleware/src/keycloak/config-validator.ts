/**
 * Keycloak Configuration Validator
 * Follows industry standards for configuration validation
 */

import { KeycloakConfig, KeycloakError, KeycloakErrorType } from "./types";
import { IKeycloakConfigValidator } from "./interfaces";

/**
 * Production-grade configuration validator
 */
export class KeycloakConfigValidator implements IKeycloakConfigValidator {
  private static readonly REQUIRED_FIELDS: Array<keyof KeycloakConfig> = [
    "serverUrl",
    "realm",
    "clientId",
  ];

  private static readonly URL_PATTERN = /^https?:\/\/.+/;
  private static readonly REALM_PATTERN = /^[a-zA-Z0-9_-]+$/;
  private static readonly CLIENT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

  /**
   * Validate and normalize configuration
   */
  validate(config: Partial<KeycloakConfig>): KeycloakConfig {
    if (!config) {
      throw new KeycloakError(
        "Configuration is required",
        KeycloakErrorType.CONFIGURATION_ERROR
      );
    }

    // Check required fields
    this.validateRequiredFields(config);

    // Validate field formats
    this.validateFieldFormats(config);

    // Create validated configuration with defaults
    return this.createValidatedConfig(config);
  }

  /**
   * Check if configuration is valid without throwing
   */
  isValid(config: Partial<KeycloakConfig>): boolean {
    try {
      this.validate(config);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate required fields
   */
  private validateRequiredFields(config: Partial<KeycloakConfig>): void {
    for (const field of KeycloakConfigValidator.REQUIRED_FIELDS) {
      if (!config[field]) {
        throw new KeycloakError(
          `Required field '${field}' is missing`,
          KeycloakErrorType.CONFIGURATION_ERROR
        );
      }
    }
  }

  /**
   * Validate field formats
   */
  private validateFieldFormats(config: Partial<KeycloakConfig>): void {
    // Validate server URL
    if (
      config.serverUrl &&
      !KeycloakConfigValidator.URL_PATTERN.test(config.serverUrl)
    ) {
      throw new KeycloakError(
        "Invalid serverUrl format. Must be a valid HTTP/HTTPS URL",
        KeycloakErrorType.CONFIGURATION_ERROR
      );
    }

    // Validate realm
    if (
      config.realm &&
      !KeycloakConfigValidator.REALM_PATTERN.test(config.realm)
    ) {
      throw new KeycloakError(
        "Invalid realm format. Must contain only alphanumeric characters, underscores, and hyphens",
        KeycloakErrorType.CONFIGURATION_ERROR
      );
    }

    // Validate client ID
    if (
      config.clientId &&
      !KeycloakConfigValidator.CLIENT_ID_PATTERN.test(config.clientId)
    ) {
      throw new KeycloakError(
        "Invalid clientId format. Must contain only alphanumeric characters, underscores, and hyphens",
        KeycloakErrorType.CONFIGURATION_ERROR
      );
    }

    // Validate cache TTL
    if (
      config.cacheTTL !== undefined &&
      (config.cacheTTL < 0 || config.cacheTTL > 86400)
    ) {
      throw new KeycloakError(
        "Invalid cacheTTL. Must be between 0 and 86400 seconds (24 hours)",
        KeycloakErrorType.CONFIGURATION_ERROR
      );
    }

    // Validate timeouts
    if (
      config.connectTimeout !== undefined &&
      (config.connectTimeout < 1000 || config.connectTimeout > 30000)
    ) {
      throw new KeycloakError(
        "Invalid connectTimeout. Must be between 1000 and 30000 milliseconds",
        KeycloakErrorType.CONFIGURATION_ERROR
      );
    }

    if (
      config.readTimeout !== undefined &&
      (config.readTimeout < 1000 || config.readTimeout > 60000)
    ) {
      throw new KeycloakError(
        "Invalid readTimeout. Must be between 1000 and 60000 milliseconds",
        KeycloakErrorType.CONFIGURATION_ERROR
      );
    }
  }

  /**
   * Create validated configuration with proper defaults
   */
  private createValidatedConfig(
    config: Partial<KeycloakConfig>
  ): KeycloakConfig {
    const serverUrl = config.serverUrl!.replace(/\/$/, "");
    const jwksUri =
      config.jwksUri ||
      `${serverUrl}/realms/${config.realm}/protocol/openid_connect/certs`;

    return {
      serverUrl,
      realm: config.realm!,
      clientId: config.clientId!,
      clientSecret: config.clientSecret,
      publicKey: config.publicKey,
      jwksUri,
      verifyTokenLocally: config.verifyTokenLocally ?? true,
      cacheTTL: config.cacheTTL ?? 300,
      enableUserInfoEndpoint: config.enableUserInfoEndpoint ?? true,
      requireAuth: config.requireAuth ?? true,
      rolesClaim: config.rolesClaim ?? "realm_access.roles",
      usernameClaim: config.usernameClaim ?? "preferred_username",
      emailClaim: config.emailClaim ?? "email",
      groupsClaim: config.groupsClaim ?? "groups",
      connectTimeout: config.connectTimeout ?? 5000,
      readTimeout: config.readTimeout ?? 5000,
      maxRetries: config.maxRetries ?? 3,
      retryDelay: config.retryDelay ?? 1000,
      circuitBreakerThreshold: config.circuitBreakerThreshold ?? 5,
      circuitBreakerResetTimeout: config.circuitBreakerResetTimeout ?? 30000,
      enableMetrics: config.enableMetrics ?? true,
      logLevel: config.logLevel ?? "info",
      skipPaths: config.skipPaths ?? [],
      trustedProxies: config.trustedProxies,
      corsOrigins: config.corsOrigins,
    } as KeycloakConfig;
  }

  /**
   * Create a default configuration for development
   */
  static createDevConfig(
    overrides: Partial<KeycloakConfig> = {}
  ): KeycloakConfig {
    const validator = new KeycloakConfigValidator();
    return validator.validate({
      serverUrl: "http://localhost:8080",
      realm: "master",
      clientId: "test-client",
      verifyTokenLocally: false, // Use remote validation in dev
      cacheTTL: 60, // Short cache in dev
      ...overrides,
    });
  }

  /**
   * Create a production configuration with security defaults
   */
  static createProductionConfig(
    config: Partial<KeycloakConfig>
  ): KeycloakConfig {
    const validator = new KeycloakConfigValidator();
    return validator.validate({
      verifyTokenLocally: true, // Local validation for performance
      cacheTTL: 900, // 15 minutes
      enableUserInfoEndpoint: true,
      connectTimeout: 3000, // Faster timeout in prod
      readTimeout: 10000,
      enableMetrics: true,
      ...config,
    });
  }
}
