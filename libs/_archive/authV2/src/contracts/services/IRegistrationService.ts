import { IAuthenticationContext, EntityId } from "../../types/core";

import {
  IRegistrationData,
  IRegistrationResult,
  IPasswordChangeData,
} from "../services";

/**
 * Password validation result interface
 */
export interface IPasswordValidationResult {
  readonly isValid: boolean;
  readonly errors: ReadonlyArray<string>;
  readonly strengthScore: number; // 0-100
  readonly suggestions: ReadonlyArray<string>;
}

/**
 * Registration validation result interface
 */
export interface IRegistrationValidationResult {
  readonly isValid: boolean;
  readonly errors: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
}

/**
 * Account recovery options
 */
export interface IAccountRecoveryOptions {
  readonly recoveryMethod: "email" | "phone" | "security_questions";
  readonly identifier: string; // email, phone, or username
  readonly context?: IAuthenticationContext;
}

/**
 * Account recovery result
 */
export interface IAccountRecoveryResult {
  readonly success: boolean;
  readonly recoveryToken?: string;
  readonly expiresAt?: number;
  readonly errorMessage?: string;
}

/**
 * Registration service interface
 * Handles user registration, password management, and account recovery
 * Following Single Responsibility Principle - focused on registration operations only
 */
export interface IRegistrationService {
  /**
   * Register a new user account
   */
  registerUser(
    registrationData: IRegistrationData,
    context?: IAuthenticationContext
  ): Promise<IRegistrationResult>;

  /**
   * Validate registration data before processing
   */
  validateRegistrationData(
    registrationData: IRegistrationData
  ): Promise<IRegistrationValidationResult>;

  /**
   * Validate password strength and requirements
   */
  validatePassword(password: string): Promise<IPasswordValidationResult>;

  /**
   * Change user password with validation
   */
  changePassword(
    userId: EntityId,
    passwordChangeData: IPasswordChangeData,
    context?: IAuthenticationContext
  ): Promise<boolean>;

  /**
   * Initiate account recovery process
   */
  initiateAccountRecovery(
    options: IAccountRecoveryOptions
  ): Promise<IAccountRecoveryResult>;

  /**
   * Complete account recovery with token
   */
  completeAccountRecovery(
    recoveryToken: string,
    newPassword: string,
    context?: IAuthenticationContext
  ): Promise<boolean>;

  /**
   * Verify email address
   */
  verifyEmail(
    userId: EntityId,
    verificationToken: string,
    context?: IAuthenticationContext
  ): Promise<boolean>;

  /**
   * Verify phone number
   */
  verifyPhone(
    userId: EntityId,
    verificationCode: string,
    context?: IAuthenticationContext
  ): Promise<boolean>;

  /**
   * Resend verification email
   */
  resendEmailVerification(
    userId: EntityId,
    context?: IAuthenticationContext
  ): Promise<boolean>;

  /**
   * Resend phone verification code
   */
  resendPhoneVerification(
    userId: EntityId,
    context?: IAuthenticationContext
  ): Promise<boolean>;

  /**
   * Check if email is already registered
   */
  isEmailRegistered(email: string): Promise<boolean>;

  /**
   * Check if username is already taken
   */
  isUsernameTaken(username: string): Promise<boolean>;

  /**
   * Deactivate user account
   */
  deactivateAccount(
    userId: EntityId,
    reason: string,
    context?: IAuthenticationContext
  ): Promise<boolean>;

  /**
   * Reactivate user account
   */
  reactivateAccount(
    userId: EntityId,
    context?: IAuthenticationContext
  ): Promise<boolean>;
}
