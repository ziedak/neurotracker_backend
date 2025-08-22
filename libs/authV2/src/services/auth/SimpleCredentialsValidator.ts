/**
 * @fileoverview Simple Credentials Validator - Minimal Implementation
 * @module services/auth/SimpleCredentialsValidator
 * @version 1.0.0
 */

import {
  IAuthenticationCredentials,
  IRegistrationData,
} from "../../contracts/services";
import { ValidationError } from "../../errors/core";

/**
 * Simple credentials validator with basic validation
 */
export class SimpleCredentialsValidator {
  /**
   * Validate authentication credentials
   */
  validateAuthenticationCredentials(
    credentials: IAuthenticationCredentials
  ): void {
    if (!credentials) {
      throw new ValidationError("Credentials are required");
    }

    // Basic validation based on credential type
    if ("email" in credentials) {
      if (!credentials.email || !credentials.password) {
        throw new ValidationError("Email and password are required");
      }
    } else if ("username" in credentials) {
      if (!credentials.username || !credentials.password) {
        throw new ValidationError("Username and password are required");
      }
    } else if ("apiKey" in credentials) {
      if (!credentials.apiKey) {
        throw new ValidationError("API key is required");
      }
    } else if ("token" in credentials) {
      if (!credentials.token) {
        throw new ValidationError("Token is required");
      }
    } else {
      throw new ValidationError("Invalid credentials format");
    }
  }

  /**
   * Validate registration data
   */
  validateRegistrationData(data: IRegistrationData): void {
    if (!data) {
      throw new ValidationError("Registration data is required");
    }

    if (!data.email || !data.username || !data.password) {
      throw new ValidationError("Email, username, and password are required");
    }

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data.email)) {
      throw new ValidationError("Invalid email format");
    }

    // Basic password strength validation
    if (data.password.length < 8) {
      throw new ValidationError("Password must be at least 8 characters long");
    }
  }
}
