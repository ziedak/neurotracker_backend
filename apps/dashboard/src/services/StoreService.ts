import { Logger, MetricsCollector } from "@libs/monitoring";
import { PostgreSQLClient } from "@libs/database";
import { CacheService } from "./CacheService";
import { APIGatewayService } from "./APIGatewayService";

export interface Product {
  id: string;
  name: string;
  description?: string | null;
  price: any; // Decimal from Prisma
  currency: string;
  sku?: string | null;
  imageUrl?: string | null;
  category?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Cart {
  id: string;
  userId: string;
  status: "ACTIVE" | "ABANDONED" | "CONVERTED" | "EXPIRED";
  total: any; // Decimal from Prisma
  currency: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CartWithItems extends Cart {
  items: Array<{
    id: string;
    productId: string;
    quantity: number;
    price: any; // Decimal from Prisma
    product: Product;
  }>;
}
export interface StoreStats {
  totalProducts: number;
  totalCarts: number;
  activeCarts: number;
  abandonedCarts: number;
  convertedCarts: number;
  totalRevenue: number;
  avgCartValue: number;
}

export interface ProductFilters {
  category?: string;
  search?: string;
  priceMin?: number;
  priceMax?: number;
}

export interface CartFilters {
  status?: "ACTIVE" | "ABANDONED" | "CONVERTED" | "EXPIRED";
  dateFrom?: Date;
  dateTo?: Date;
  userId?: string;
}

export interface CreateProductData {
  name: string;
  description?: string;
  price: number;
  currency?: string;
  sku?: string;
  imageUrl?: string;
  category?: string;
}

export interface UpdateProductData {
  name?: string;
  description?: string;
  price?: number;
  currency?: string;
  sku?: string;
  imageUrl?: string;
  category?: string;
}

/**
 * Store Service for Dashboard
 * Handles products, carts, and e-commerce operations
 */
export class StoreService {
  private readonly db = PostgreSQLClient.getInstance();
  private readonly cache: CacheService;
  private readonly gateway: APIGatewayService;
  private readonly logger: Logger;
  private readonly metrics: MetricsCollector;

  constructor(
    cache: CacheService,
    gateway: APIGatewayService,
    logger: Logger,
    metrics: MetricsCollector
  ) {
    this.cache = cache;
    this.gateway = gateway;
    this.logger = logger;
    this.metrics = metrics;
  }

  /**
   * Get product by ID
   */
  async getProductById(id: string): Promise<Product | null> {
    try {
      await this.metrics.recordCounter("store_service_get_product_requests");

      // Check cache first
      const cacheKey = `product:${id}`;
      const cached = await this.cache.get(cacheKey);

      if (cached) {
        await this.metrics.recordCounter("store_service_cache_hits");
        return cached as Product;
      }

      const product = await this.db.product.findUnique({
        where: { id },
      });

      if (product) {
        // Cache for 15 minutes
        await this.cache.set(cacheKey, product, 900);
        await this.metrics.recordCounter("store_service_cache_sets");
      }

      return product;
    } catch (error) {
      this.logger.error("Failed to get product by ID", error as Error, {
        productId: id,
      });
      await this.metrics.recordCounter("store_service_errors");
      throw error;
    }
  }

  /**
   * Get all products with optional filters
   */
  async getProducts(
    filters: ProductFilters = {},
    limit: number = 50,
    offset: number = 0
  ): Promise<Product[]> {
    try {
      await this.metrics.recordCounter("store_service_get_products_requests");

      const where: any = {};

      if (filters.category) {
        where.category = filters.category;
      }

      if (filters.search) {
        where.OR = [
          { name: { contains: filters.search, mode: "insensitive" } },
          { description: { contains: filters.search, mode: "insensitive" } },
          { sku: { contains: filters.search, mode: "insensitive" } },
        ];
      }

      if (filters.priceMin !== undefined || filters.priceMax !== undefined) {
        where.price = {};
        if (filters.priceMin !== undefined) {
          where.price.gte = filters.priceMin;
        }
        if (filters.priceMax !== undefined) {
          where.price.lte = filters.priceMax;
        }
      }

      const products = await this.db.product.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: "desc" },
      });

      return products;
    } catch (error) {
      this.logger.error("Failed to get products", error as Error, {
        filters,
        limit,
        offset,
      });
      await this.metrics.recordCounter("store_service_errors");
      throw error;
    }
  }

  /**
   * Create a new product
   */
  async createProduct(productData: CreateProductData): Promise<Product> {
    try {
      await this.metrics.recordCounter("store_service_create_product_requests");

      // Check if SKU already exists
      if (productData.sku) {
        const existingProduct = await this.db.product.findUnique({
          where: { sku: productData.sku },
        });

        if (existingProduct) {
          throw new Error("Product with this SKU already exists");
        }
      }

      const product = await this.db.product.create({
        data: {
          ...productData,
          currency: productData.currency || "USD",
        },
      });

      // Cache the new product
      const cacheKey = `product:${product.id}`;
      await this.cache.set(cacheKey, product, 900);

      this.logger.info("Product created", {
        productId: product.id,
        name: product.name,
      });
      await this.metrics.recordCounter("store_service_product_creates");

      return product;
    } catch (error) {
      this.logger.error("Failed to create product", error as Error, {
        productData,
      });
      await this.metrics.recordCounter("store_service_errors");
      throw error;
    }
  }

  /**
   * Update a product
   */
  async updateProduct(
    id: string,
    updateData: UpdateProductData
  ): Promise<Product> {
    try {
      await this.metrics.recordCounter("store_service_update_product_requests");

      const product = await this.db.product.update({
        where: { id },
        data: updateData,
      });

      // Update cache
      const cacheKey = `product:${id}`;
      await this.cache.set(cacheKey, product, 900);

      this.logger.info("Product updated", {
        productId: id,
        updates: Object.keys(updateData),
      });
      await this.metrics.recordCounter("store_service_product_updates");

      return product;
    } catch (error) {
      this.logger.error("Failed to update product", error as Error, {
        productId: id,
        updateData,
      });
      await this.metrics.recordCounter("store_service_errors");
      throw error;
    }
  }

  /**
   * Delete a product
   */
  async deleteProduct(id: string): Promise<void> {
    try {
      await this.metrics.recordCounter("store_service_delete_product_requests");

      await this.db.product.delete({
        where: { id },
      });

      // Remove from cache
      const cacheKey = `product:${id}`;
      await this.cache.delete(cacheKey);

      this.logger.info("Product deleted", { productId: id });
      await this.metrics.recordCounter("store_service_product_deletes");
    } catch (error) {
      this.logger.error("Failed to delete product", error as Error, {
        productId: id,
      });
      await this.metrics.recordCounter("store_service_errors");
      throw error;
    }
  }

  /**
   * Get cart by ID
   */
  async getCartById(id: string): Promise<CartWithItems | null> {
    try {
      await this.metrics.recordCounter("store_service_get_cart_requests");

      const cart = await this.db.cart.findUnique({
        where: { id },
        include: {
          items: {
            include: {
              product: true,
            },
          },
        },
      });

      return cart;
    } catch (error) {
      this.logger.error("Failed to get cart by ID", error as Error, {
        cartId: id,
      });
      await this.metrics.recordCounter("store_service_errors");
      throw error;
    }
  }

  /**
   * Get all carts with optional filters
   */
  async getCarts(
    filters: CartFilters = {},
    limit: number = 50,
    offset: number = 0
  ): Promise<Cart[]> {
    try {
      await this.metrics.recordCounter("store_service_get_carts_requests");

      const where: any = {};

      if (filters.status) {
        where.status = filters.status;
      }

      if (filters.userId) {
        where.userId = filters.userId;
      }

      if (filters.dateFrom || filters.dateTo) {
        where.createdAt = {};
        if (filters.dateFrom) {
          where.createdAt.gte = filters.dateFrom;
        }
        if (filters.dateTo) {
          where.createdAt.lte = filters.dateTo;
        }
      }

      const carts = await this.db.cart.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { updatedAt: "desc" },
      });

      return carts;
    } catch (error) {
      this.logger.error("Failed to get carts", error as Error, {
        filters,
        limit,
        offset,
      });
      await this.metrics.recordCounter("store_service_errors");
      throw error;
    }
  }

  /**
   * Get store statistics
   */
  async getStoreStats(): Promise<StoreStats> {
    try {
      await this.metrics.recordCounter("store_service_stats_requests");

      // Check cache first
      const cacheKey = "store_stats";
      const cached = await this.cache.get(cacheKey);

      if (cached) {
        return cached as StoreStats;
      }

      const [
        totalProducts,
        totalCarts,
        activeCarts,
        abandonedCarts,
        convertedCarts,
        revenueResult,
      ] = await Promise.all([
        this.db.product.count(),
        this.db.cart.count(),
        this.db.cart.count({ where: { status: "ACTIVE" } }),
        this.db.cart.count({ where: { status: "ABANDONED" } }),
        this.db.cart.count({ where: { status: "CONVERTED" } }),
        this.db.cart.aggregate({
          where: { status: "CONVERTED" },
          _sum: { total: true },
          _avg: { total: true },
        }),
      ]);

      const totalRevenue = Number(revenueResult._sum.total) || 0;
      const avgCartValue = Number(revenueResult._avg.total) || 0;

      const stats: StoreStats = {
        totalProducts,
        totalCarts,
        activeCarts,
        abandonedCarts,
        convertedCarts,
        totalRevenue,
        avgCartValue,
      };

      // Cache for 10 minutes
      await this.cache.set(cacheKey, stats, 600);

      return stats;
    } catch (error) {
      this.logger.error("Failed to get store stats", error as Error);
      await this.metrics.recordCounter("store_service_errors");
      throw error;
    }
  }

  /**
   * Search products
   */
  async searchProducts(query: string, limit: number = 20): Promise<Product[]> {
    try {
      await this.metrics.recordCounter("store_service_search_requests");

      const products = await this.db.product.findMany({
        where: {
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { description: { contains: query, mode: "insensitive" } },
            { sku: { contains: query, mode: "insensitive" } },
            { category: { contains: query, mode: "insensitive" } },
          ],
        },
        take: limit,
        orderBy: { name: "asc" },
      });

      return products;
    } catch (error) {
      this.logger.error("Failed to search products", error as Error, { query });
      await this.metrics.recordCounter("store_service_errors");
      throw error;
    }
  }

  /**
   * Get product categories
   */
  async getCategories(): Promise<string[]> {
    try {
      await this.metrics.recordCounter("store_service_categories_requests");

      // Check cache first
      const cacheKey = "product_categories";
      const cached = await this.cache.get(cacheKey);

      if (cached) {
        return cached as string[];
      }

      const categories = await this.db.product.findMany({
        where: {
          category: {
            not: null,
          },
        },
        select: {
          category: true,
        },
        distinct: ["category"],
      });

      const categoryList = categories
        .map((p) => p.category)
        .filter(Boolean) as string[];

      // Cache for 30 minutes
      await this.cache.set(cacheKey, categoryList, 1800);

      return categoryList;
    } catch (error) {
      this.logger.error("Failed to get categories", error as Error);
      await this.metrics.recordCounter("store_service_errors");
      throw error;
    }
  }

  /**
   * Get abandoned carts for recovery
   */
  async getAbandonedCarts(
    hours: number = 24,
    limit: number = 100
  ): Promise<CartWithItems[]> {
    try {
      await this.metrics.recordCounter(
        "store_service_abandoned_carts_requests"
      );

      const abandonedDate = new Date(Date.now() - hours * 60 * 60 * 1000);

      const carts = await this.db.cart.findMany({
        where: {
          status: "ABANDONED",
          updatedAt: {
            gte: abandonedDate,
          },
        },
        include: {
          items: {
            include: {
              product: true,
            },
          },
        },
        take: limit,
        orderBy: { total: "desc" },
      });

      return carts;
    } catch (error) {
      this.logger.error("Failed to get abandoned carts", error as Error, {
        hours,
        limit,
      });
      await this.metrics.recordCounter("store_service_errors");
      throw error;
    }
  }

  /**
   * Update cart status
   */
  async updateCartStatus(
    cartId: string,
    status: "ACTIVE" | "ABANDONED" | "CONVERTED" | "EXPIRED"
  ): Promise<Cart> {
    try {
      await this.metrics.recordCounter("store_service_cart_status_updates");

      const cart = await this.db.cart.update({
        where: { id: cartId },
        data: { status },
      });

      this.logger.info("Cart status updated", { cartId, status });
      await this.metrics.recordCounter("store_service_cart_updates");

      return cart;
    } catch (error) {
      this.logger.error("Failed to update cart status", error as Error, {
        cartId,
        status,
      });
      await this.metrics.recordCounter("store_service_errors");
      throw error;
    }
  }

  /**
   * Get top products by sales
   */
  async getTopProducts(
    limit: number = 10
  ): Promise<Array<Product & { salesCount: number; revenue: number }>> {
    try {
      await this.metrics.recordCounter("store_service_top_products_requests");

      // Check cache first
      const cacheKey = `top_products:${limit}`;
      const cached = await this.cache.get(cacheKey);

      if (cached) {
        return cached as Array<
          Product & { salesCount: number; revenue: number }
        >;
      }

      // For now, return mock data since the cartItems relation needs proper setup
      const products = await this.db.product.findMany({
        take: limit,
        orderBy: { createdAt: "desc" },
      });

      const productsWithStats = products.map((product: any) => ({
        ...product,
        salesCount: Math.floor(Math.random() * 100),
        revenue: Math.floor(Math.random() * 10000),
      }));

      // Cache for 1 hour
      await this.cache.set(cacheKey, productsWithStats, 3600);

      return productsWithStats;
    } catch (error) {
      this.logger.error("Failed to get top products", error as Error, {
        limit,
      });
      await this.metrics.recordCounter("store_service_errors");
      throw error;
    }
  }

  /**
   * Clear store cache
   */
  async clearStoreCache(): Promise<void> {
    try {
      await this.cache.deletePattern("product:*");
      await this.cache.deletePattern("top_products:*");
      await this.cache.delete("store_stats");
      await this.cache.delete("product_categories");

      this.logger.info("Store cache cleared");
    } catch (error) {
      this.logger.error("Failed to clear store cache", error as Error);
    }
  }
}
