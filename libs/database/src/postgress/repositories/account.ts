/**
 * Account Repository
 *
 * Handles database operations for OAuth provider accounts.
 * Supports Better-Auth social login integrations.
 *
 * @module repositories/account
 */

import type { PrismaClient } from "@prisma/client";
import type {
  Account,
  AccountCreateInput,
  AccountUpdateInput,
  AccountFilters,
} from "../../models/account";

/**
 * Account Repository Class
 *
 * Provides CRUD operations and queries for OAuth provider accounts.
 */
export class AccountRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Create a new account
   */
  async create(data: AccountCreateInput): Promise<Account> {
    return this.prisma.account.create({
      data,
      include: {
        user: true,
      },
    }) as Promise<Account>;
  }

  /**
   * Find account by ID
   */
  async findById(id: string): Promise<Account | null> {
    return this.prisma.account.findUnique({
      where: { id },
      include: {
        user: true,
      },
    }) as Promise<Account | null>;
  }

  /**
   * Find account by provider and account ID
   */
  async findByProvider(
    providerId: string,
    accountId: string
  ): Promise<Account | null> {
    // Use findFirst since compound unique may not be typed correctly
    return this.prisma.account.findFirst({
      where: {
        providerId,
        accountId,
      },
      include: {
        user: true,
      },
    }) as Promise<Account | null>;
  }

  /**
   * Find all accounts for a user
   */
  async findByUserId(userId: string): Promise<Account[]> {
    return this.prisma.account.findMany({
      where: { userId },
      include: {
        user: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    }) as Promise<Account[]>;
  }

  /**
   * Find accounts with filters
   */
  async findMany(filters: AccountFilters = {}): Promise<Account[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};

    if (filters.providerId) {
      where.providerId = filters.providerId;
    }

    if (filters.userId) {
      where.userId = filters.userId;
    }

    if (filters.hasAccessToken !== undefined) {
      where.accessToken = filters.hasAccessToken ? { not: null } : null;
    }

    if (filters.hasRefreshToken !== undefined) {
      where.refreshToken = filters.hasRefreshToken ? { not: null } : null;
    }

    if (
      filters.accessTokenExpired !== undefined &&
      filters.accessTokenExpired
    ) {
      where.accessTokenExpiresAt = {
        lt: new Date(),
      };
    }

    if (filters.createdAfter) {
      where.createdAt = { ...where.createdAt, gte: filters.createdAfter };
    }

    if (filters.createdBefore) {
      where.createdAt = { ...where.createdAt, lte: filters.createdBefore };
    }

    return this.prisma.account.findMany({
      where,
      include: {
        user: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    }) as Promise<Account[]>;
  }

  /**
   * Update account
   */
  async update(id: string, data: AccountUpdateInput): Promise<Account> {
    return this.prisma.account.update({
      where: { id },
      data,
      include: {
        user: true,
      },
    }) as Promise<Account>;
  }

  /**
   * Update account tokens
   */
  async updateTokens(
    id: string,
    tokens: {
      accessToken?: string;
      refreshToken?: string;
      idToken?: string;
      accessTokenExpiresAt?: Date;
      refreshTokenExpiresAt?: Date;
    }
  ): Promise<Account> {
    return this.prisma.account.update({
      where: { id },
      data: tokens,
      include: {
        user: true,
      },
    }) as Promise<Account>;
  }

  /**
   * Delete account
   */
  async delete(id: string): Promise<Account> {
    return this.prisma.account.delete({
      where: { id },
    }) as Promise<Account>;
  }

  /**
   * Delete all accounts for a user
   */
  async deleteByUserId(userId: string): Promise<number> {
    const result = await this.prisma.account.deleteMany({
      where: { userId },
    });
    return result.count;
  }

  /**
   * Delete account by provider
   */
  async deleteByProvider(
    providerId: string,
    accountId: string
  ): Promise<Account | null> {
    // Use findFirst + delete since compound unique may not be typed correctly
    const account = await this.prisma.account.findFirst({
      where: {
        providerId,
        accountId,
      },
    });

    if (!account) {
      return null;
    }

    return this.prisma.account.delete({
      where: { id: account.id },
    }) as Promise<Account>;
  }

  /**
   * Check if account exists
   */
  async exists(providerId: string, accountId: string): Promise<boolean> {
    const count = await this.prisma.account.count({
      where: {
        providerId,
        accountId,
      },
    });
    return count > 0;
  }

  /**
   * Count accounts for a user
   */
  async countByUserId(userId: string): Promise<number> {
    return this.prisma.account.count({
      where: { userId },
    });
  }

  /**
   * Get expired access tokens (for cleanup)
   */
  async findExpiredAccessTokens(): Promise<Account[]> {
    return this.prisma.account.findMany({
      where: {
        accessTokenExpiresAt: {
          lt: new Date(),
        },
        accessToken: {
          not: null,
        },
      },
    }) as Promise<Account[]>;
  }

  /**
   * Upsert Keycloak account (create or update)
   * For centralized token vault pattern
   */
  async upsertKeycloakAccount(data: {
    userId: string;
    keycloakUserId: string;
    accessToken: string;
    refreshToken: string;
    idToken?: string | null;
    accessTokenExpiresAt: Date;
    refreshTokenExpiresAt?: Date | null;
    scope?: string | null;
  }): Promise<Account> {
    // Try to find existing Keycloak account
    const existing = await this.prisma.account.findFirst({
      where: {
        userId: data.userId,
        providerId: "keycloak",
      },
    });

    if (existing) {
      // Update existing account
      return this.prisma.account.update({
        where: { id: existing.id },
        data: {
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          idToken: data.idToken ?? null,
          accessTokenExpiresAt: data.accessTokenExpiresAt,
          refreshTokenExpiresAt: data.refreshTokenExpiresAt ?? null,
          scope: data.scope ?? null,
        },
      }) as Promise<Account>;
    }

    // Create new account
    return this.prisma.account.create({
      data: {
        userId: data.userId,
        accountId: data.keycloakUserId,
        providerId: "keycloak",
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        idToken: data.idToken ?? null,
        accessTokenExpiresAt: data.accessTokenExpiresAt,
        refreshTokenExpiresAt: data.refreshTokenExpiresAt ?? null,
        scope: data.scope ?? null,
      },
    }) as Promise<Account>;
  }

  /**
   * Get tokens from vault
   */
  async getTokens(accountId: string): Promise<{
    accessToken: string | null;
    refreshToken: string | null;
    idToken: string | null;
    accessTokenExpiresAt: Date | null;
    refreshTokenExpiresAt: Date | null;
  } | null> {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: {
        accessToken: true,
        refreshToken: true,
        idToken: true,
        accessTokenExpiresAt: true,
        refreshTokenExpiresAt: true,
      },
    });

    return account;
  }

  /**
   * Clear tokens from vault (for logout)
   */
  async clearTokens(accountId: string): Promise<void> {
    await this.prisma.account.update({
      where: { id: accountId },
      data: {
        accessToken: null,
        refreshToken: null,
        idToken: null,
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: null,
      },
    });
  }

  /**
   * Get Keycloak account for user
   */
  async getKeycloakAccount(userId: string): Promise<Account | null> {
    return this.prisma.account.findFirst({
      where: {
        userId,
        providerId: "keycloak",
      },
    }) as Promise<Account | null>;
  }

  /**
   * Check if tokens are expired
   */
  async areTokensExpired(accountId: string): Promise<boolean> {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: {
        accessTokenExpiresAt: true,
      },
    });

    if (!account?.accessTokenExpiresAt) {
      return true; // Assume expired if not found or no expiration set
    }

    return account.accessTokenExpiresAt < new Date();
  }
}
