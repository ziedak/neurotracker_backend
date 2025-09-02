/**
 * @fileoverview UserServiceV2 - Enterprise user management service with repository layer
 * @module services/UserService
 * @version 2.0.0
 * @author Enterprise Development Team
 */

import type { EntityId, IUser, Timestamp } from "../types/core";
import { UserStatus, createTimestamp } from "../types/core";
import type {
  IUserService,
  IUserCreateData,
  IUserUpdateData,
  ICredentialVerificationResult,
  IUserActivitySummary,
  IBatchOperationResult,
  ICacheStatistics,
  IServiceHealth,
} from "../contracts/services";
import type { IEnhancedUser, IBatchError } from "../types/enhanced";
import { ValidationError } from "../errors/core";
import { PasswordSecurity } from "../utils/PasswordSecurity";
import { InputValidator } from "../utils/InputValidator";
import {
  UserRepository,
  CreateUserInput,
  UpdateUserInput,
  getRepositoryFactory,
} from "../repositories";

/**
 * UserServiceV2 Implementation using Repository Pattern
 */
export class UserServiceV2 implements IUserService {
  private readonly userRepository: UserRepository;
  private readonly cache: Map<string, { user: IUser; timestamp: number }> =
    new Map();
  private readonly cacheTimeout = 5 * 60 * 1000; // 5 minutes
  private readonly maxCacheSize = 1000;
  private readonly startTime = Date.now();

  private metrics = {
    cacheHits: 0,
    cacheMisses: 0,
    operationsTotal: 0,
    errorsTotal: 0,
    lastOperation: null as Date | null,
  };

  constructor() {
    this.userRepository = getRepositoryFactory().getUserRepository();
  }

  async findById(userId: EntityId): Promise<IEnhancedUser | null> {
    this.metrics.operationsTotal++;
    this.metrics.lastOperation = new Date();

    const cached = this.getCacheEntry(userId);
    if (cached) {
      this.metrics.cacheHits++;
      return this.convertToIEnhancedUser(cached);
    }

    this.metrics.cacheMisses++;

    try {
      const user = await this.userRepository.findById(userId);

      if (user) {
        this.setCacheEntry(userId, user);
        return this.convertToIEnhancedUser(user);
      }

      return null;
    } catch (error) {
      this.metrics.errorsTotal++;
      throw error;
    }
  }

  async findByEmail(email: string): Promise<IEnhancedUser | null> {
    this.metrics.operationsTotal++;
    this.metrics.lastOperation = new Date();

    try {
      // SECURITY: Validate email format before querying database
      const emailValidation = InputValidator.validateEmail(email);
      if (!emailValidation.success) {
        return null; // Invalid email format, no need to query database
      }

      const user = await this.userRepository.findByEmail(emailValidation.data!);

      if (user) {
        this.setCacheEntry(user.id as EntityId, user);
        return this.convertToIEnhancedUser(user);
      }

      return null;
    } catch (error) {
      this.metrics.errorsTotal++;
      throw error;
    }
  }

  async findByUsername(username: string): Promise<IEnhancedUser | null> {
    this.metrics.operationsTotal++;
    this.metrics.lastOperation = new Date();

    try {
      // SECURITY: Validate username format before querying database
      const usernameValidation = InputValidator.validateUsername(username);
      if (!usernameValidation.success) {
        return null; // Invalid username format, no need to query database
      }

      const user = await this.userRepository.findByUsername(
        usernameValidation.data!
      );

      if (user) {
        this.setCacheEntry(user.id as EntityId, user);
        return this.convertToIEnhancedUser(user);
      }

      return null;
    } catch (error) {
      this.metrics.errorsTotal++;
      throw error;
    }
  }

  async findByIds(
    userIds: ReadonlyArray<EntityId>
  ): Promise<IBatchOperationResult<IEnhancedUser>> {
    this.metrics.operationsTotal++;
    this.metrics.lastOperation = new Date();

    const successful: IEnhancedUser[] = [];
    const failed: IBatchError[] = [];

    for (const userId of userIds) {
      try {
        const user = await this.findById(userId);
        if (user) {
          successful.push(user);
        }
      } catch (error) {
        failed.push({
          id: userId,
          error: {
            code: "SERVICE_ERROR" as import("../types/core").AuthErrorCode,
            message: error instanceof Error ? error.message : "Unknown error",
            details: { errorType: error?.constructor.name || "Error" },
            timestamp: createTimestamp(),
            traceId: crypto.randomUUID(),
          },
          input: userId,
        });
      }
    }

    return {
      successful,
      failed,
      totalProcessed: userIds.length,
      processingTime:
        Date.now() - (this.metrics.lastOperation?.getTime() || Date.now()),
      timestamp: new Date().toISOString() as Timestamp,
    };
  }

  async create(userData: IUserCreateData): Promise<IEnhancedUser> {
    this.metrics.operationsTotal++;
    this.metrics.lastOperation = new Date();

    try {
      // SECURITY: Comprehensive input validation
      const emailValidation = InputValidator.validateEmail(userData.email);
      if (!emailValidation.success) {
        throw new ValidationError(
          `Email validation failed: ${emailValidation.errors?.join(", ")}`
        );
      }

      const usernameValidation = InputValidator.validateUsername(
        userData.username
      );
      if (!usernameValidation.success) {
        throw new ValidationError(
          `Username validation failed: ${usernameValidation.errors?.join(", ")}`
        );
      }

      // Validate optional name fields
      let validatedFirstName: string | null = null;
      if (userData.firstName) {
        const firstNameValidation = InputValidator.validateName(
          userData.firstName
        );
        if (!firstNameValidation.success) {
          throw new ValidationError(
            `First name validation failed: ${firstNameValidation.errors?.join(
              ", "
            )}`
          );
        }
        validatedFirstName = firstNameValidation.data || null;
      }

      let validatedLastName: string | null = null;
      if (userData.lastName) {
        const lastNameValidation = InputValidator.validateName(
          userData.lastName
        );
        if (!lastNameValidation.success) {
          throw new ValidationError(
            `Last name validation failed: ${lastNameValidation.errors?.join(
              ", "
            )}`
          );
        }
        validatedLastName = lastNameValidation.data || null;
      }

      // Validate metadata if provided
      let validatedMetadata: Record<string, unknown> | null = null;
      if (userData.metadata) {
        const metadataValidation = InputValidator.validateMetadata(
          userData.metadata
        );
        if (!metadataValidation.success) {
          throw new ValidationError(
            `Metadata validation failed: ${metadataValidation.errors?.join(
              ", "
            )}`
          );
        }
        validatedMetadata = metadataValidation.data || null;
      }

      // SECURITY FIX: Hash password before storing
      const passwordHashResult = await PasswordSecurity.hashPassword(
        userData.password
      );

      const createInput: CreateUserInput = {
        email: emailValidation.data!,
        username: usernameValidation.data!,
        password: passwordHashResult.hash, // Store hashed password
        firstName: validatedFirstName,
        lastName: validatedLastName,
        status: UserStatus.ACTIVE,
        emailVerified: false,
        phoneVerified: false,
        metadata: validatedMetadata,
      };

      const user = await this.userRepository.create(createInput);
      this.setCacheEntry(user.id as EntityId, user);

      return this.convertToIEnhancedUser(user);
    } catch (error) {
      this.metrics.errorsTotal++;
      throw error;
    }
  }

  async update(
    userId: EntityId,
    updateData: IUserUpdateData
  ): Promise<IEnhancedUser> {
    this.metrics.operationsTotal++;
    this.metrics.lastOperation = new Date();

    try {
      const updateInput: Partial<UpdateUserInput> = {};

      // SECURITY: Validate email if provided
      if (updateData.email !== undefined) {
        const emailValidation = InputValidator.validateEmail(updateData.email);
        if (!emailValidation.success) {
          throw new ValidationError(
            `Email validation failed: ${emailValidation.errors?.join(", ")}`
          );
        }
        updateInput.email = emailValidation.data!;
      }

      // SECURITY: Validate username if provided
      if (updateData.username !== undefined) {
        const usernameValidation = InputValidator.validateUsername(
          updateData.username
        );
        if (!usernameValidation.success) {
          throw new ValidationError(
            `Username validation failed: ${usernameValidation.errors?.join(
              ", "
            )}`
          );
        }
        updateInput.username = usernameValidation.data!;
      }

      // SECURITY: Validate first name if provided
      if (updateData.firstName !== undefined) {
        if (updateData.firstName) {
          const firstNameValidation = InputValidator.validateName(
            updateData.firstName
          );
          if (!firstNameValidation.success) {
            throw new ValidationError(
              `First name validation failed: ${firstNameValidation.errors?.join(
                ", "
              )}`
            );
          }
          updateInput.firstName = firstNameValidation.data!;
        } else {
          updateInput.firstName = null;
        }
      }

      // SECURITY: Validate last name if provided
      if (updateData.lastName !== undefined) {
        if (updateData.lastName) {
          const lastNameValidation = InputValidator.validateName(
            updateData.lastName
          );
          if (!lastNameValidation.success) {
            throw new ValidationError(
              `Last name validation failed: ${lastNameValidation.errors?.join(
                ", "
              )}`
            );
          }
          updateInput.lastName = lastNameValidation.data!;
        } else {
          updateInput.lastName = null;
        }
      }

      if (updateData.isActive !== undefined) {
        updateInput.status = updateData.isActive
          ? UserStatus.ACTIVE
          : UserStatus.INACTIVE;
      }

      // SECURITY: Validate metadata if provided
      if (updateData.metadata !== undefined) {
        if (updateData.metadata) {
          const metadataValidation = InputValidator.validateMetadata(
            updateData.metadata
          );
          if (!metadataValidation.success) {
            throw new ValidationError(
              `Metadata validation failed: ${metadataValidation.errors?.join(
                ", "
              )}`
            );
          }
          updateInput.metadata = metadataValidation.data!;
        } else {
          updateInput.metadata = null;
        }
      }

      const user = await this.userRepository.update(userId, updateInput);
      this.setCacheEntry(userId, user);

      return this.convertToIEnhancedUser(user);
    } catch (error) {
      this.metrics.errorsTotal++;
      throw error;
    }
  }

  async delete(userId: EntityId): Promise<boolean> {
    this.metrics.operationsTotal++;
    this.metrics.lastOperation = new Date();

    try {
      const result = await this.userRepository.delete(userId);
      this.cache.delete(userId);
      return result;
    } catch (error) {
      this.metrics.errorsTotal++;
      throw error;
    }
  }

  async verifyCredentials(
    email: string,
    password: string
  ): Promise<ICredentialVerificationResult> {
    this.metrics.operationsTotal++;
    this.metrics.lastOperation = new Date();

    try {
      const user = await this.userRepository.findByEmail(email);

      if (!user) {
        return {
          isValid: false,
          user: null,
          failureReason: "User not found",
          requiresPasswordReset: false,
          lockUntil: null,
        };
      }

      // SECURITY FIX: Replace plaintext comparison with secure Argon2 verification
      const passwordVerification = await PasswordSecurity.verifyPassword(
        password,
        user.password
      );
      const isPasswordValid = passwordVerification.isValid;

      if (!isPasswordValid) {
        return {
          isValid: false,
          user: null,
          failureReason: "Invalid password",
          requiresPasswordReset: false,
          lockUntil: null,
        };
      }

      if (user.status !== UserStatus.ACTIVE) {
        return {
          isValid: false,
          user: null,
          failureReason: "Account inactive",
          requiresPasswordReset: false,
          lockUntil: null,
        };
      }

      return {
        isValid: true,
        user: this.convertToIEnhancedUser(user),
        failureReason: null,
        requiresPasswordReset: false,
        lockUntil: null,
      };
    } catch (error) {
      this.metrics.errorsTotal++;
      throw error;
    }
  }

  async updatePassword(
    userId: EntityId,
    currentPassword: string,
    newPassword: string
  ): Promise<boolean> {
    this.metrics.operationsTotal++;
    this.metrics.lastOperation = new Date();

    try {
      // SECURITY: Validate password strength before proceeding
      // Note: This will throw an error if validation fails
      PasswordSecurity.validatePasswordStrength(newPassword);

      const user = await this.userRepository.findById(userId);
      if (!user) {
        return false;
      }

      // SECURITY FIX: Verify current password using secure comparison
      const currentPasswordVerification = await PasswordSecurity.verifyPassword(
        currentPassword,
        user.password
      );
      if (!currentPasswordVerification.isValid) {
        return false;
      }

      // Hash new password before storing
      const newPasswordHashResult = await PasswordSecurity.hashPassword(
        newPassword
      );

      // Update password in database
      await this.userRepository.update(userId, {
        password: newPasswordHashResult.hash,
      });

      // Invalidate cache
      this.cache.delete(userId);

      return true;
    } catch (error) {
      this.metrics.errorsTotal++;
      throw error;
    }
  }

  async getActivitySummary(
    userId: EntityId,
    _days: number = 30
  ): Promise<IUserActivitySummary> {
    this.metrics.operationsTotal++;
    this.metrics.lastOperation = new Date();

    try {
      const user = await this.userRepository.findById(userId);
      if (!user) {
        throw new Error("User not found");
      }

      return {
        userId,
        totalLogins: 0,
        lastLogin: user.lastLoginAt || null,
        averageSessionDuration: 0,
        totalSessions: 0,
        failedLoginAttempts: 0,
        uniqueDevices: 0,
        suspiciousActivities: 0,
      };
    } catch (error) {
      this.metrics.errorsTotal++;
      throw error;
    }
  }

  async warmCache(userIds: ReadonlyArray<EntityId>): Promise<void> {
    for (const userId of userIds) {
      try {
        await this.findById(userId);
      } catch (error) {
        continue;
      }
    }
  }

  async clearCache(userId: EntityId): Promise<void> {
    this.cache.delete(userId);
  }

  async getCacheStats(): Promise<ICacheStatistics> {
    const now = Date.now();
    let expiredCount = 0;

    for (const [, entry] of this.cache) {
      if (now - entry.timestamp > this.cacheTimeout) {
        expiredCount++;
      }
    }

    const totalRequests = this.metrics.cacheHits + this.metrics.cacheMisses;
    const hitRate =
      totalRequests > 0 ? this.metrics.cacheHits / totalRequests : 0;

    return {
      hitCount: this.metrics.cacheHits,
      missCount: this.metrics.cacheMisses,
      hitRate,
      evictionCount: expiredCount,
      averageLoadTime: 0,
      cacheSize: this.cache.size,
      lastUpdated: new Date().toISOString() as Timestamp,
    };
  }

  async getHealth(): Promise<IServiceHealth> {
    try {
      await this.userRepository.count();

      return {
        service: "UserServiceV2",
        status: "healthy",
        uptime: Date.now() - this.startTime,
        lastCheck: new Date().toISOString() as Timestamp,
        dependencies: [
          {
            name: "UserRepository",
            status: "healthy",
            responseTime: 0,
            error: null,
            lastCheck: new Date().toISOString() as Timestamp,
          },
        ],
        metrics: {
          operationsTotal: this.metrics.operationsTotal,
          errorsTotal: this.metrics.errorsTotal,
          cacheSize: this.cache.size,
          cacheHitRate: (await this.getCacheStats()).hitRate,
        },
      };
    } catch (error) {
      return {
        service: "UserServiceV2",
        status: "unhealthy",
        uptime: Date.now() - this.startTime,
        lastCheck: new Date().toISOString() as Timestamp,
        dependencies: [
          {
            name: "UserRepository",
            status: "unhealthy",
            responseTime: 0,
            error: error instanceof Error ? error.message : "Unknown error",
            lastCheck: new Date().toISOString() as Timestamp,
          },
        ],
        metrics: {
          operationsTotal: this.metrics.operationsTotal,
          errorsTotal: this.metrics.errorsTotal,
          cacheSize: this.cache.size,
        },
      };
    }
  }

  private setCacheEntry(id: EntityId, user: IUser): void {
    if (this.cache.size >= this.maxCacheSize) {
      const oldestEntry = Array.from(this.cache.entries()).sort(
        ([, a], [, b]) => a.timestamp - b.timestamp
      )[0];

      if (oldestEntry) {
        this.cache.delete(oldestEntry[0]);
      }
    }

    this.cache.set(id, { user, timestamp: Date.now() });
  }

  private getCacheEntry(id: EntityId): IUser | null {
    const entry = this.cache.get(id);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > this.cacheTimeout) {
      this.cache.delete(id);
      return null;
    }

    return entry.user;
  }

  private convertToIEnhancedUser(user: IUser): IEnhancedUser {
    return {
      ...user,
      id: user.id as EntityId,
      createdAt: user.createdAt.toISOString() as Timestamp,
      updatedAt: user.updatedAt.toISOString() as Timestamp,
      lastLoginAt: (user.lastLoginAt?.toISOString() as Timestamp) || null,
      passwordHash: user.password as any,
      isActive: user.status === UserStatus.ACTIVE,
      isEmailVerified: user.emailVerified,
      securityMetadata: {
        failedLoginAttempts: 0,
        lastFailedLoginAt: null,
        passwordChangedAt: user.updatedAt.toISOString() as Timestamp,
        mfaEnabled: false,
        mfaBackupCodes: [],
        securityQuestions: [],
        trustedDevices: [],
        suspiciousActivities: [],
      },
      preferences: {
        theme: "light",
        language: "en",
        timezone: "UTC",
        notifications: {
          email: true,
          sms: false,
          push: true,
          securityAlerts: true,
          marketingEmails: false,
        },
        privacy: {
          profileVisibility: "private",
          activityTracking: true,
          analyticsConsent: false,
          cookieConsent: false,
          dataRetention: 365,
        },
      },
    } as IEnhancedUser;
  }
}
