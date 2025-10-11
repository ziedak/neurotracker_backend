/**
 * Verification Repository
 *
 * Handles database operations for email verification and password reset tokens.
 * Supports Better-Auth verification flows.
 *
 * @module repositories/verification
 */

import type { PrismaClient } from "@prisma/client";
import type {
  Verification,
  VerificationCreateInput,
  VerificationUpdateInput,
  VerificationFilters,
} from "../../models/account";

/**
 * Verification Repository Class
 *
 * Provides CRUD operations and queries for verification tokens.
 */
export class VerificationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Create a new verification token
   */
  async create(data: VerificationCreateInput): Promise<Verification> {
    return this.prisma.verification.create({
      data,
    }) as Promise<Verification>;
  }

  /**
   * Find verification by ID
   */
  async findById(id: string): Promise<Verification | null> {
    return this.prisma.verification.findUnique({
      where: { id },
    }) as Promise<Verification | null>;
  }

  /**
   * Find verification by identifier and value
   */
  async findByIdentifierAndValue(
    identifier: string,
    value: string
  ): Promise<Verification | null> {
    // Use findFirst since compound unique may not be typed correctly
    return this.prisma.verification.findFirst({
      where: {
        identifier,
        value,
      },
    }) as Promise<Verification | null>;
  }

  /**
   * Find all verifications for an identifier (email)
   */
  async findByIdentifier(identifier: string): Promise<Verification[]> {
    return this.prisma.verification.findMany({
      where: { identifier },
      orderBy: {
        createdAt: "desc",
      },
    }) as Promise<Verification[]>;
  }

  /**
   * Find latest verification for an identifier
   */
  async findLatestByIdentifier(
    identifier: string
  ): Promise<Verification | null> {
    const verifications = await this.prisma.verification.findMany({
      where: { identifier },
      orderBy: {
        createdAt: "desc",
      },
      take: 1,
    });
    return (verifications[0] as Verification) || null;
  }

  /**
   * Find verifications with filters
   */
  async findMany(filters: VerificationFilters = {}): Promise<Verification[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};

    if (filters.identifier) {
      where.identifier = filters.identifier;
    }

    if (filters.expired !== undefined) {
      if (filters.expired) {
        where.expiresAt = { lt: new Date() };
      } else {
        where.expiresAt = { gte: new Date() };
      }
    }

    if (filters.createdAfter) {
      where.createdAt = { ...where.createdAt, gte: filters.createdAfter };
    }

    if (filters.createdBefore) {
      where.createdAt = { ...where.createdAt, lte: filters.createdBefore };
    }

    return this.prisma.verification.findMany({
      where,
      orderBy: {
        createdAt: "desc",
      },
    }) as Promise<Verification[]>;
  }

  /**
   * Update verification
   */
  async update(
    id: string,
    data: VerificationUpdateInput
  ): Promise<Verification> {
    return this.prisma.verification.update({
      where: { id },
      data,
    }) as Promise<Verification>;
  }

  /**
   * Delete verification
   */
  async delete(id: string): Promise<Verification> {
    return this.prisma.verification.delete({
      where: { id },
    }) as Promise<Verification>;
  }

  /**
   * Delete verification by identifier and value
   */
  async deleteByIdentifierAndValue(
    identifier: string,
    value: string
  ): Promise<Verification | null> {
    // Use findFirst + delete since compound unique may not be typed correctly
    const verification = await this.prisma.verification.findFirst({
      where: {
        identifier,
        value,
      },
    });

    if (!verification) {
      return null;
    }

    return this.prisma.verification.delete({
      where: { id: verification.id },
    }) as Promise<Verification>;
  }

  /**
   * Delete all verifications for an identifier
   */
  async deleteByIdentifier(identifier: string): Promise<number> {
    const result = await this.prisma.verification.deleteMany({
      where: { identifier },
    });
    return result.count;
  }

  /**
   * Delete expired verifications (cleanup)
   */
  async deleteExpired(): Promise<number> {
    const result = await this.prisma.verification.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });
    return result.count;
  }

  /**
   * Check if valid verification exists
   */
  async existsValid(identifier: string, value: string): Promise<boolean> {
    const count = await this.prisma.verification.count({
      where: {
        identifier,
        value,
        expiresAt: {
          gte: new Date(),
        },
      },
    });
    return count > 0;
  }

  /**
   * Count verifications for an identifier
   */
  async countByIdentifier(identifier: string): Promise<number> {
    return this.prisma.verification.count({
      where: { identifier },
    });
  }

  /**
   * Count expired verifications
   */
  async countExpired(): Promise<number> {
    return this.prisma.verification.count({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });
  }

  /**
   * Verify and consume token (atomic operation)
   */
  async verifyAndConsume(
    identifier: string,
    value: string
  ): Promise<Verification | null> {
    // Find valid verification
    const verification = await this.findByIdentifierAndValue(identifier, value);

    if (!verification) {
      return null;
    }

    // Check if expired
    if (verification.expiresAt < new Date()) {
      // Delete expired token
      await this.delete(verification.id);
      return null;
    }

    // Delete consumed token (one-time use)
    await this.delete(verification.id);

    return verification;
  }
}
