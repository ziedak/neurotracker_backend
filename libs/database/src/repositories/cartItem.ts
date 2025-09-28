/**
 * @fileoverview CartItem Repository Implementation
 * @module database/repositories/cartItem
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { DatabaseClient } from "../types/DatabaseClient";
import type { IMetricsCollector } from "@libs/monitoring";
import type { ICache } from "../cache";
import { BaseRepository, type QueryOptions } from "./base";
import type { CartItem } from "../models";
import { Prisma } from "@prisma/client";

/**
 * CartItem creation input type
 */
export type CartItemCreateInput = Omit<
  Prisma.CartItemCreateInput,
  "id" | "createdAt" | "updatedAt"
> & {
  id?: string;
};

/**
 * CartItem update input type
 */
export type CartItemUpdateInput = Prisma.CartItemUpdateInput;

/**
 * CartItem repository interface
 */
export interface ICartItemRepository
  extends BaseRepository<
    CartItem,
    CartItemCreateInput,
    CartItemUpdateInput
  > {
  /**
   * Find items by cart ID
   */
  findByCartId(cartId: string, options?: QueryOptions): Promise<CartItem[]>;

  /**
   * Find items by product ID
   */
  findByProductId(
    productId: string,
    options?: QueryOptions
  ): Promise<CartItem[]>;

  /**
   * Find item by cart and product
   */
  findByCartAndProduct(
    cartId: string,
    productId: string
  ): Promise<CartItem | null>;

  /**
   * Update item quantity
   */
  updateQuantity(id: string, quantity: number): Promise<CartItem>;

  /**
   * Update item price
   */
  updatePrice(id: string, price: Prisma.Decimal): Promise<CartItem>;

  /**
   * Remove item from cart
   */
  removeFromCart(cartId: string, productId: string): Promise<CartItem | null>;

  /**
   * Clear all items from cart
   */
  clearCart(cartId: string): Promise<{ count: number }>;

  /**
   * Get cart total items count
   */
  getCartItemsCount(cartId: string): Promise<number>;

  /**
   * Get cart total value
   */
  getCartTotalValue(cartId: string): Promise<Prisma.Decimal>;
}

/**
 * CartItem repository implementation
 */
export class CartItemRepository
  extends BaseRepository<
    CartItem,
    CartItemCreateInput,
    CartItemUpdateInput
  >
  implements ICartItemRepository
{
  constructor(
    protected override readonly db: DatabaseClient,
    protected override readonly metricsCollector?: IMetricsCollector,
    protected readonly cacheService?: ICache
  ) {
    super(db, "CartItem", metricsCollector);
  }

  /**
   * Find cart item by ID
   */
  async findById(id: string, options?: QueryOptions): Promise<CartItem | null> {
    return this.executeOperation("findById", async () => {
      const { where, include, select } = options ?? {};
      const queryOptions = {
        where: { id, ...where },
        ...(select && { select }),
        ...(include && { include }),
      } as Prisma.CartItemFindUniqueArgs;

      const result = await this.db.cartItem.findUnique(queryOptions);
      return result as CartItem | null;
    });
  }

  /**
   * Find multiple cart items
   */
  async findMany(options?: QueryOptions): Promise<CartItem[]> {
    return this.executeOperation("findMany", async () => {
      const result = await this.db.cartItem.findMany({
        ...options,
      });
      return result as CartItem[];
    });
  }

  /**
   * Find first cart item matching criteria
   */
  async findFirst(options?: QueryOptions): Promise<CartItem | null> {
    return this.executeOperation("findFirst", async () => {
      const result = await this.db.cartItem.findFirst({
        ...options,
      });
      return result as CartItem | null;
    });
  }

  /**
   * Count cart items
   */
  async count(options?: QueryOptions): Promise<number> {
    return this.executeOperation("count", async () => {
      // Count operations don't support include, so we omit it
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { include, ...countOptions } = options ?? {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (this.db.cartItem.count as any)(countOptions);
    });
  }

  /**
   * Create new cart item
   */
  async create(data: CartItemCreateInput): Promise<CartItem> {
    return this.executeOperation("create", async () => {
      const result = await this.db.cartItem.create({
        data,
      });
      return result as CartItem;
    });
  }

  /**
   * Create multiple cart items
   */
  async createMany(data: CartItemCreateInput[]): Promise<CartItem[]> {
    return this.executeOperation("createMany", async () => {
      const results = await Promise.all(
        data.map((itemData) =>
          this.db.cartItem.create({
            data: itemData,
          })
        )
      );
      return results as CartItem[];
    });
  }

  /**
   * Update cart item by ID
   */
  async updateById(id: string, data: CartItemUpdateInput): Promise<CartItem> {
    return this.executeOperation("updateById", async () => {
      const result = await this.db.cartItem.update({
        where: { id },
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
      return result as CartItem;
    });
  }

  /**
   * Update multiple cart items
   */
  async updateMany(
    where: Record<string, unknown>,
    data: CartItemUpdateInput
  ): Promise<{ count: number }> {
    return this.executeOperation("updateMany", async () => {
      return this.db.cartItem.updateMany({
        where,
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
    });
  }

  /**
   * Delete cart item by ID
   */
  async deleteById(id: string): Promise<CartItem> {
    return this.executeOperation("deleteById", async () => {
      const result = await this.db.cartItem.delete({
        where: { id },
      });
      return result as CartItem;
    });
  }

  /**
   * Delete multiple cart items
   */
  async deleteMany(where: Record<string, unknown>): Promise<{ count: number }> {
    return this.executeOperation("deleteMany", async () => {
      return this.db.cartItem.deleteMany({
        where,
      });
    });
  }

  /**
   * Check if cart item exists
   */
  async exists(where: Record<string, unknown>): Promise<boolean> {
    return this.executeOperation("exists", async () => {
      const count = await this.db.cartItem.count({
        where,
      });
      return count > 0;
    });
  }

  /**
   * Execute operation within transaction
   */
  async transaction<R>(
    callback: (repo: ICartItemRepository) => Promise<R>
  ): Promise<R> {
    return this.db.$transaction(async (tx) => {
      const txRepo = new CartItemRepository(
        tx as DatabaseClient,
        this.metricsCollector,
        this.cacheService
      );
      return callback(txRepo);
    });
  }

  /**
   * Find items by cart ID
   */
  async findByCartId(
    cartId: string,
    options?: QueryOptions
  ): Promise<CartItem[]> {
    return this.executeOperation("findByCartId", async () => {
      const result = await this.db.cartItem.findMany({
        where: { cartId, ...options?.where },
        ...options,
      });
      return result as CartItem[];
    });
  }

  /**
   * Find items by product ID
   */
  async findByProductId(
    productId: string,
    options?: QueryOptions
  ): Promise<CartItem[]> {
    return this.executeOperation("findByProductId", async () => {
      const result = await this.db.cartItem.findMany({
        where: { productId, ...options?.where },
        ...options,
      });
      return result as CartItem[];
    });
  }

  /**
   * Find item by cart and product
   */
  async findByCartAndProduct(
    cartId: string,
    productId: string
  ): Promise<CartItem | null> {
    return this.executeOperation("findByCartAndProduct", async () => {
      const result = await this.db.cartItem.findUnique({
        where: {
          cartId_productId: {
            cartId,
            productId,
          },
        },
      });
      return result as CartItem | null;
    });
  }

  /**
   * Update item quantity
   */
  async updateQuantity(id: string, quantity: number): Promise<CartItem> {
    return this.executeOperation("updateQuantity", async () => {
      const result = await this.db.cartItem.update({
        where: { id },
        data: {
          quantity,
          updatedAt: new Date(),
        },
      });
      return result as CartItem;
    });
  }

  /**
   * Update item price
   */
  async updatePrice(id: string, price: Prisma.Decimal): Promise<CartItem> {
    return this.executeOperation("updatePrice", async () => {
      const result = await this.db.cartItem.update({
        where: { id },
        data: {
          price,
          updatedAt: new Date(),
        },
      });
      return result as CartItem;
    });
  }

  /**
   * Remove item from cart
   */
  async removeFromCart(
    cartId: string,
    productId: string
  ): Promise<CartItem | null> {
    return this.executeOperation("removeFromCart", async () => {
      try {
        const result = await this.db.cartItem.delete({
          where: {
            cartId_productId: {
              cartId,
              productId,
            },
          },
        });
        return result as CartItem;
      } catch {
        return null;
      }
    });
  }

  /**
   * Clear all items from cart
   */
  async clearCart(cartId: string): Promise<{ count: number }> {
    return this.executeOperation("clearCart", async () => {
      return this.db.cartItem.deleteMany({
        where: { cartId },
      });
    });
  }

  /**
   * Get cart total items count
   */
  async getCartItemsCount(cartId: string): Promise<number> {
    return this.executeOperation("getCartItemsCount", async () => {
      const result = await this.db.cartItem.aggregate({
        where: { cartId },
        _sum: {
          quantity: true,
        },
      });
      return result._sum.quantity ?? 0;
    });
  }

  /**
   * Get cart total value
   */
  async getCartTotalValue(cartId: string): Promise<Prisma.Decimal> {
    return this.executeOperation("getCartTotalValue", async () => {
      const items = await this.db.cartItem.findMany({
        where: { cartId },
        select: {
          quantity: true,
          price: true,
        },
      });

      const total = items.reduce((sum, item) => {
        return sum.add(item.price.mul(item.quantity));
      }, new Prisma.Decimal(0));

      return total;
    });
  }
}
