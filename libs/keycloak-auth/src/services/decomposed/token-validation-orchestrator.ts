import { createLogger, type ILogger } from "@libs/utils";
import { KeycloakClientFactory } from "../../client/keycloak-client-factory";
import { jwtVerify, createRemoteJWKSet } from "jose";
import { validateInput, TokenPayloadSchema } from "../../validation/index";
import {
  TokenValidationResult,
  KeycloakClientConfig,
  TokenClaims,
} from "../../types/index";
import { ServiceHealth, IBaseService, ServiceConfig } from "./interfaces";
import { ITokenCacheService } from "./token-cache.service";

/**
 * JWT validation context
 */
export interface JWTValidationContext {
  token: string;
  config: KeycloakClientConfig;
  cachedResult?: TokenValidationResult;
  publicKey?: string;
  claims?: TokenClaims;
}

/**
 * Validation step result
 */
export interface ValidationStepResult {
  success: boolean;
  data?: any;
  error?: string;
  step: string;
  duration: number;
}

/**
 * Token validation orchestrator configuration
 */
export interface TokenValidationOrchestratorConfig {
  enableCache: boolean;
  enableDetailedLogging: boolean;
  validationTimeout: number;
  skipIssuerValidation: boolean;
  skipAudienceValidation: boolean;
}

/**
 * Interface for token validation orchestrator
 */
export interface ITokenValidationOrchestrator extends IBaseService {
  /**
   * Validate JWT token with full orchestration
   */
  validateJWT(
    token: string,
    clientConfig?: KeycloakClientConfig
  ): Promise<TokenValidationResult>;

  /**
   * Validate JWT with custom context
   */
  validateJWTWithContext(
    context: JWTValidationContext
  ): Promise<TokenValidationResult>;

  /**
   * Get validation statistics
   */
  getValidationStats(): {
    totalValidations: number;
    successfulValidations: number;
    failedValidations: number;
    averageValidationTime: number;
    cacheHitRate: number;
  };
}

/**
 * Token Validation Orchestrator
 *
 * Orchestrates the complete JWT validation pipeline with proper error handling,
 * caching integration, and performance monitoring. This service coordinates
 * between caching, public key management, and validation logic.
 *
 * Features:
 * - Complete validation pipeline orchestration
 * - Integrated caching and public key management
 * - Comprehensive error handling and logging
 * - Performance monitoring and statistics
 * - Configurable validation steps
 */
export class TokenValidationOrchestrator
  implements ITokenValidationOrchestrator
{
  private logger: ILogger;
  private config: TokenValidationOrchestratorConfig;
  private serviceConfig: ServiceConfig;

  // Validation statistics
  private stats = {
    totalValidations: 0,
    successfulValidations: 0,
    failedValidations: 0,
    totalValidationTime: 0,
    cacheHits: 0,
    cacheMisses: 0,
  };

  constructor(
    private readonly keycloakClientFactory: KeycloakClientFactory,
    private readonly cacheService: ITokenCacheService,
    config?: Partial<TokenValidationOrchestratorConfig>
  ) {
    this.logger = createLogger("token-validation-orchestrator");

    this.config = {
      enableCache: true,
      enableDetailedLogging: false,
      validationTimeout: 30000, // 30 seconds
      skipIssuerValidation: false,
      skipAudienceValidation: false,
      ...config,
    };

    this.serviceConfig = {
      enabled: true,
      environment: process.env["NODE_ENV"] || "development",
      instanceId: process.env["INSTANCE_ID"] || "default",
    };

    this.logger.info("TokenValidationOrchestrator initialized", {
      config: this.config,
    });
  }

  /**
   * Validate JWT token with full orchestration
   *
   * @param token - JWT token to validate
   * @param clientConfig - Optional Keycloak client configuration (defaults to websocket client)
   * @returns Promise<TokenValidationResult> - Validation result
   */
  public async validateJWT(
    token: string,
    clientConfig?: KeycloakClientConfig
  ): Promise<TokenValidationResult> {
    const startTime = Date.now();
    this.stats.totalValidations++;

    try {
      // Use provided config or get default websocket client config
      const config =
        clientConfig || this.keycloakClientFactory.getClient("websocket");

      const context: JWTValidationContext = {
        token,
        config,
      };

      const result = await this.validateJWTWithContext(context);
      const duration = Date.now() - startTime;

      this.stats.totalValidationTime += duration;

      if (result.valid) {
        this.stats.successfulValidations++;
      } else {
        this.stats.failedValidations++;
      }

      if (this.config.enableDetailedLogging) {
        this.logger.info("JWT validation completed", {
          valid: result.valid,
          duration,
          cached: result.cached,
          subject: result.claims?.sub,
        });
      }

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.stats.totalValidationTime += duration;
      this.stats.failedValidations++;

      this.logger.error("JWT validation failed", {
        duration,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        valid: false,
        error: error instanceof Error ? error.message : String(error),
        cached: false,
      };
    }
  }

  /**
   * Validate JWT with custom context
   *
   * @param context - JWT validation context
   * @returns Promise<TokenValidationResult> - Validation result
   */
  public async validateJWTWithContext(
    context: JWTValidationContext
  ): Promise<TokenValidationResult> {
    const steps: ValidationStepResult[] = [];

    try {
      // Step 1: Check cache
      const cacheStep = await this.checkCacheStep(context);
      steps.push(cacheStep);

      if (cacheStep.success && cacheStep.data) {
        this.stats.cacheHits++;
        return cacheStep.data;
      }

      this.stats.cacheMisses++;

      // Step 2: Get client configuration
      const configStep = await this.getClientConfigStep(context);
      steps.push(configStep);

      if (!configStep.success) {
        throw new Error(
          configStep.error || "Failed to get client configuration"
        );
      }

      // Step 3: Perform JWT validation
      const validationStep = await this.performValidationStep(context);
      steps.push(validationStep);

      if (!validationStep.success) {
        throw new Error(validationStep.error || "JWT validation failed");
      }

      // Step 4: Cache successful result
      if (this.config.enableCache && validationStep.data) {
        await this.cacheResultStep(context, validationStep.data);
      }

      // Step 5: Log successful validation
      this.logSuccessfulValidation(validationStep.data.claims);

      return validationStep.data;
    } catch (error) {
      // Log failed validation with step details
      this.logger.warn("JWT validation failed at step", {
        error: error instanceof Error ? error.message : String(error),
        steps: steps.map((s) => ({
          step: s.step,
          success: s.success,
          duration: s.duration,
        })),
      });

      return {
        valid: false,
        error: error instanceof Error ? error.message : String(error),
        cached: false,
      };
    }
  }

  /**
   * Get validation statistics
   */
  public getValidationStats(): {
    totalValidations: number;
    successfulValidations: number;
    failedValidations: number;
    averageValidationTime: number;
    cacheHitRate: number;
  } {
    const averageValidationTime =
      this.stats.totalValidations > 0
        ? this.stats.totalValidationTime / this.stats.totalValidations
        : 0;

    const totalCacheRequests = this.stats.cacheHits + this.stats.cacheMisses;
    const cacheHitRate =
      totalCacheRequests > 0
        ? Math.round((this.stats.cacheHits / totalCacheRequests) * 100 * 100) /
          100
        : 0;

    return {
      totalValidations: this.stats.totalValidations,
      successfulValidations: this.stats.successfulValidations,
      failedValidations: this.stats.failedValidations,
      averageValidationTime,
      cacheHitRate,
    };
  }

  /**
   * Get service health status
   */
  public getHealthStatus(): ServiceHealth {
    const stats = this.getValidationStats();

    return {
      healthy: stats.failedValidations < stats.totalValidations * 0.1, // < 10% failure rate
      status:
        stats.failedValidations < stats.totalValidations * 0.1
          ? "healthy"
          : "degraded",
      uptimeSeconds: Math.floor(Date.now() / 1000), // Simplified uptime
      lastCheck: Date.now(),
      details: {
        stats,
        config: this.config,
      },
    };
  }

  /**
   * Get service configuration
   */
  public getConfig(): ServiceConfig {
    return this.serviceConfig;
  }

  /**
   * Shutdown service
   */
  public async shutdown(): Promise<void> {
    this.logger.info("Shutting down TokenValidationOrchestrator");
    // No specific cleanup needed
    this.logger.info("TokenValidationOrchestrator shutdown completed");
  }

  /**
   * Check cache step
   */
  private async checkCacheStep(
    context: JWTValidationContext
  ): Promise<ValidationStepResult> {
    const startTime = Date.now();

    try {
      if (!this.config.enableCache) {
        return {
          success: false,
          step: "cache_check",
          duration: Date.now() - startTime,
        };
      }

      const cacheKey = `jwt:validation:${this.hashToken(context.token)}`;
      const cached = await this.cacheService.get<TokenValidationResult>(
        cacheKey
      );

      if (cached.hit && cached.data && cached.data.valid) {
        return {
          success: true,
          data: { ...cached.data, cached: true },
          step: "cache_check",
          duration: Date.now() - startTime,
        };
      }

      return {
        success: false,
        step: "cache_check",
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        step: "cache_check",
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Get client configuration step
   */
  private async getClientConfigStep(
    context: JWTValidationContext
  ): Promise<ValidationStepResult> {
    const startTime = Date.now();

    try {
      // Use provided config or get default
      const config =
        context.config || this.keycloakClientFactory.getClient("frontend");

      return {
        success: true,
        data: config,
        step: "client_config",
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        step: "client_config",
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Perform JWT validation step
   */
  private async performValidationStep(
    context: JWTValidationContext
  ): Promise<ValidationStepResult> {
    const startTime = Date.now();

    try {
      const config = context.config;

      // Get discovery document
      const discovery = await this.keycloakClientFactory.getDiscoveryDocument(
        config.realm
      );

      if (!discovery.jwks_uri) {
        throw new Error(`JWKS endpoint not found for realm '${config.realm}'`);
      }

      // Create JWKS
      const JWKS = createRemoteJWKSet(new URL(discovery.jwks_uri));

      // Verify JWT using the getKey function overload
      const verifyOptions: any = {
        issuer: this.config.skipIssuerValidation ? undefined : discovery.issuer,
      };

      if (!this.config.skipAudienceValidation) {
        verifyOptions.audience = config.clientId;
      }

      const { payload } = await jwtVerify(context.token, JWKS, verifyOptions);

      // Validate payload
      const validatedPayload = validateInput(
        TokenPayloadSchema,
        payload,
        "JWT token payload"
      );

      const claims = validatedPayload as TokenClaims;

      const result: TokenValidationResult = {
        valid: true,
        claims,
        cached: false,
      };

      return {
        success: true,
        data: result,
        step: "jwt_validation",
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        step: "jwt_validation",
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Cache result step
   */
  private async cacheResultStep(
    context: JWTValidationContext,
    result: TokenValidationResult
  ): Promise<void> {
    try {
      if (!result.claims) return;

      const cacheKey = `jwt:validation:${this.hashToken(context.token)}`;
      const ttl = this.calculateCacheTtl(result.claims);

      await this.cacheService.set(cacheKey, result, ttl);
    } catch (error) {
      this.logger.warn("Failed to cache validation result", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Log successful validation
   */
  private logSuccessfulValidation(claims: TokenClaims): void {
    this.logger.info("JWT validation successful", {
      subject: claims.sub,
      client: claims.azp,
      expiry: new Date((claims.exp || 0) * 1000).toISOString(),
    });
  }

  /**
   * Calculate cache TTL based on token expiration
   */
  private calculateCacheTtl(claims: TokenClaims): number {
    if (claims.exp) {
      const now = Math.floor(Date.now() / 1000);
      const ttl = claims.exp - now - 60; // Cache until 1 minute before expiration
      return Math.max(ttl, 300); // Minimum 5 minutes
    }
    return 3600; // Default 1 hour
  }

  /**
   * Hash token for cache key
   */
  private hashToken(token: string): string {
    // Simple hash for demo - in production use proper crypto
    let hash = 0;
    for (let i = 0; i < token.length; i++) {
      const char = token.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }
}

/**
 * Factory function to create token validation orchestrator
 */
export const createTokenValidationOrchestrator = (
  keycloakClientFactory: KeycloakClientFactory,
  cacheService: ITokenCacheService,
  config?: Partial<TokenValidationOrchestratorConfig>
): TokenValidationOrchestrator => {
  return new TokenValidationOrchestrator(
    keycloakClientFactory,
    cacheService,
    config
  );
};
