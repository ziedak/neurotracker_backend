/**
 * AccountService - Centralized Token Vault Manager
 *
 * Manages all token storage operations through the Account table.
 * Single source of truth for authentication tokens.
 */

import { createLogger } from "@libs/utils";
import type { ILogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import { AccountRepository, type PrismaClient } from "@libs/database";
import {
  getTokenEncryption,
  type TokenEncryption,
} from "../encryption/TokenEncryption";

export interface TokenVaultInput {
  userId: string;
  keycloakUserId: string;
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt?: Date;
  scope?: string;
}

export interface TokenVaultData {
  accountId: string;
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt?: Date;
}

export interface TokenUpdateInput {
  accountId: string;
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt?: Date;
}

export class AccountService {
  private readonly logger: ILogger;
  private readonly accountRepo: AccountRepository;
  private readonly tokenEncryption: TokenEncryption;

  constructor(
    prisma: PrismaClient,
    private readonly metrics?: IMetricsCollector
  ) {
    this.logger = createLogger("AccountService");
    this.accountRepo = new AccountRepository(prisma);
    this.tokenEncryption = getTokenEncryption();
  }

  /**
   * Store or update tokens in the vault (Keycloak account)
   */
  async storeTokens(input: TokenVaultInput): Promise<string> {
    const startTime = performance.now();

    try {
      this.logger.debug("Storing tokens in vault", {
        userId: input.userId,
        keycloakUserId: input.keycloakUserId,
      });

      // Encrypt tokens before storage
      const encryptedTokens = this.tokenEncryption.encryptTokens({
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        idToken: input.idToken ?? null,
      });

      // Upsert account (create or update)
      const account = await this.accountRepo.upsertKeycloakAccount({
        userId: input.userId,
        keycloakUserId: input.keycloakUserId,
        accessToken: encryptedTokens.accessToken!,
        refreshToken: encryptedTokens.refreshToken!,
        idToken: encryptedTokens.idToken ?? null,
        accessTokenExpiresAt: input.accessTokenExpiresAt,
        refreshTokenExpiresAt: input.refreshTokenExpiresAt ?? null,
        scope: input.scope ?? null,
      });

      this.metrics?.recordTimer(
        "account.store_tokens_duration",
        performance.now() - startTime
      );
      this.metrics?.recordCounter("account.tokens_stored", 1);

      this.logger.info("Tokens stored in vault", {
        accountId: account.id,
        userId: input.userId,
      });

      return account.id;
    } catch (error) {
      this.metrics?.recordCounter("account.store_tokens_error", 1);
      this.logger.error("Failed to store tokens", {
        error: error instanceof Error ? error.message : String(error),
        userId: input.userId,
      });
      throw new Error("Failed to store tokens in vault");
    }
  }

  /**
   * Retrieve tokens from vault (decrypted)
   */
  async getTokens(accountId: string): Promise<TokenVaultData | null> {
    const startTime = performance.now();

    try {
      this.logger.debug("Retrieving tokens from vault", { accountId });

      const tokenData = await this.accountRepo.getTokens(accountId);

      if (!tokenData || !tokenData.accessToken) {
        this.logger.warn("No tokens found in vault", { accountId });
        return null;
      }

      // Decrypt tokens
      const decryptedTokens = this.tokenEncryption.decryptTokens({
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken,
        idToken: tokenData.idToken,
      });

      this.metrics?.recordTimer(
        "account.get_tokens_duration",
        performance.now() - startTime
      );
      this.metrics?.recordCounter("account.tokens_retrieved", 1);

      const result: TokenVaultData = {
        accountId,
        accessToken: decryptedTokens.accessToken!,
        refreshToken: decryptedTokens.refreshToken!,
        accessTokenExpiresAt: tokenData.accessTokenExpiresAt!,
      };

      if (decryptedTokens.idToken) {
        result.idToken = decryptedTokens.idToken;
      }

      if (tokenData.refreshTokenExpiresAt) {
        result.refreshTokenExpiresAt = tokenData.refreshTokenExpiresAt;
      }

      return result;
    } catch (error) {
      this.metrics?.recordCounter("account.get_tokens_error", 1);
      this.logger.error("Failed to retrieve tokens", {
        error: error instanceof Error ? error.message : String(error),
        accountId,
      });
      throw new Error("Failed to retrieve tokens from vault");
    }
  }

  /**
   * Update tokens in vault (for token refresh)
   */
  async updateTokens(input: TokenUpdateInput): Promise<void> {
    const startTime = performance.now();

    try {
      this.logger.debug("Updating tokens in vault", {
        accountId: input.accountId,
      });

      // Encrypt new tokens
      const encryptedTokens = this.tokenEncryption.encryptTokens({
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        idToken: input.idToken ?? null,
      });

      // Update account
      const updateData: {
        accessToken: string;
        refreshToken: string;
        idToken?: string;
        accessTokenExpiresAt: Date;
        refreshTokenExpiresAt?: Date;
      } = {
        accessToken: encryptedTokens.accessToken!,
        refreshToken: encryptedTokens.refreshToken!,
        accessTokenExpiresAt: input.accessTokenExpiresAt,
      };

      if (encryptedTokens.idToken) {
        updateData.idToken = encryptedTokens.idToken;
      }

      if (input.refreshTokenExpiresAt) {
        updateData.refreshTokenExpiresAt = input.refreshTokenExpiresAt;
      }

      await this.accountRepo.updateTokens(input.accountId, updateData);

      this.metrics?.recordTimer(
        "account.update_tokens_duration",
        performance.now() - startTime
      );
      this.metrics?.recordCounter("account.tokens_updated", 1);

      this.logger.info("Tokens updated in vault", {
        accountId: input.accountId,
      });
    } catch (error) {
      this.metrics?.recordCounter("account.update_tokens_error", 1);
      this.logger.error("Failed to update tokens", {
        error: error instanceof Error ? error.message : String(error),
        accountId: input.accountId,
      });
      throw new Error("Failed to update tokens in vault");
    }
  }

  /**
   * Clear tokens from vault (for logout)
   */
  async clearTokens(accountId: string): Promise<void> {
    try {
      this.logger.debug("Clearing tokens from vault", { accountId });

      await this.accountRepo.clearTokens(accountId);

      this.metrics?.recordCounter("account.tokens_cleared", 1);

      this.logger.info("Tokens cleared from vault", { accountId });
    } catch (error) {
      this.metrics?.recordCounter("account.clear_tokens_error", 1);
      this.logger.error("Failed to clear tokens", {
        error: error instanceof Error ? error.message : String(error),
        accountId,
      });
      throw new Error("Failed to clear tokens from vault");
    }
  }

  /**
   * Get Keycloak account for user
   */
  async getKeycloakAccount(
    userId: string
  ): Promise<{ accountId: string } | null> {
    try {
      const account = await this.accountRepo.getKeycloakAccount(userId);
      return account ? { accountId: account.id } : null;
    } catch (error) {
      this.logger.error("Failed to get Keycloak account", {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
      return null;
    }
  }

  /**
   * Check if tokens are expired
   */
  async areTokensExpired(accountId: string): Promise<boolean> {
    try {
      return await this.accountRepo.areTokensExpired(accountId);
    } catch (error) {
      this.logger.error("Failed to check token expiration", {
        error: error instanceof Error ? error.message : String(error),
        accountId,
      });
      return true; // Assume expired on error
    }
  }
}
