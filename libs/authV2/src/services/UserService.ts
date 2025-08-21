/**
 * @fileoverview UserServiceV2 - Enterprise user management service with repository layer
 * @module services/UserService
 * @version 2.0.0
 * @author Enterprise Development Team
 */

import type { EntityId, IUser, Timestamp } from "../types/core";
import { UserStatus } from "../types/core";
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
import type { IEnhancedUser } from "../types/enhanced";
import { ValidationError } from "../errors/core";
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
      const user = await this.userRepository.findByEmail(email);

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
      const user = await this.userRepository.findByUsername(username);

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
    const failed: Array<{ id: string; error: any; input: any }> = [];

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
            message: error instanceof Error ? error.message : "Unknown error",
            type: error?.constructor.name || "Error",
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
      if (!userData.email || !userData.username) {
        throw new ValidationError("Email and username are required");
      }

      const createInput: CreateUserInput = {
        email: userData.email,
        username: userData.username,
        password: userData.password,
        firstName: userData.firstName || null,
        lastName: userData.lastName || null,
        status: UserStatus.ACTIVE,
        emailVerified: false,
        phoneVerified: false,
        metadata: userData.metadata || null,
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
      if (updateData.email !== undefined) updateInput.email = updateData.email;
      if (updateData.username !== undefined)
        updateInput.username = updateData.username;
      if (updateData.firstName !== undefined)
        updateInput.firstName = updateData.firstName || null;
      if (updateData.lastName !== undefined)
        updateInput.lastName = updateData.lastName || null;
      if (updateData.isActive !== undefined)
        updateInput.status = updateData.isActive
          ? UserStatus.ACTIVE
          : UserStatus.INACTIVE;
      if (updateData.metadata !== undefined)
        updateInput.metadata = updateData.metadata || null;

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

      const isPasswordValid = user.password === password;

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
    _newPassword: string
  ): Promise<boolean> {
    this.metrics.operationsTotal++;
    this.metrics.lastOperation = new Date();

    try {
      const user = await this.userRepository.findById(userId);
      if (!user) {
        return false;
      }

      if (user.password !== currentPassword) {
        return false;
      }

      // TODO: In a real implementation, you'd hash the password and update it
      // For now, we just invalidate the cache as password update would be handled elsewhere
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
