import { IAuthenticationContext, JWTToken, APIKey } from "../../types/core";

import { IEnhancedUser } from "../../types/enhanced";
import { IAuthenticationCredentials } from "../services";

/**
 * Credential validation result interface
 */
export interface ICredentialValidationResult {
  readonly isValid: boolean;
  readonly user?: IEnhancedUser;
  readonly errorMessage?: string;
  readonly securityContext?: {
    readonly attemptId: string;
    readonly clientInfo?: {
      readonly ip?: string;
      readonly userAgent?: string;
    };
    readonly validationTimestamp: number;
  };
}

/**
 * Credential validator service interface
 * Handles validation logic for different authentication methods
 * Following Single Responsibility Principle - focused on credential validation only
 */
export interface ICredentialValidator {
  /**
   * Validate password-based credentials
   */
  validatePasswordCredentials(credentials: {
    readonly username: string;
    readonly password: string;
    readonly context?: IAuthenticationContext;
  }): Promise<ICredentialValidationResult>;

  /**
   * Validate API key credentials
   */
  validateAPIKeyCredentials(credentials: {
    readonly apiKey: APIKey;
    readonly context?: IAuthenticationContext;
  }): Promise<ICredentialValidationResult>;

  /**
   * Validate JWT token credentials
   */
  validateJWTCredentials(credentials: {
    readonly token: JWTToken;
    readonly context?: IAuthenticationContext;
  }): Promise<ICredentialValidationResult>;

  /**
   * Validate refresh token for token renewal
   */
  validateRefreshToken(
    refreshToken: JWTToken
  ): Promise<ICredentialValidationResult>;

  /**
   * Pre-validate credentials format before processing
   */
  preValidateCredentials(credentials: IAuthenticationCredentials): boolean;
}
