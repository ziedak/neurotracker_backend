import { Logger } from "@libs/monitoring";
import { StoreService } from "../services/StoreService";

export interface StoreRequest {
  filters?: Record<string, any>;
  pagination?: {
    page: number;
    limit: number;
  };
}

export interface ProductRequest {
  name?: string;
  description?: string;
  price?: number;
  currency?: string;
  sku?: string;
  imageUrl?: string;
  category?: string;
}

export interface CartRequest {
  userId?: string;
  status?: "ACTIVE" | "ABANDONED" | "CONVERTED" | "EXPIRED";
  dateFrom?: string;
  dateTo?: string;
}

/**
 * Store Controller for Dashboard
 * Handles store operations, products, and cart management
 */
export class StoreController {
  private readonly storeService: StoreService;
  private readonly logger: Logger;

  constructor(storeService: StoreService, logger: Logger) {
    this.storeService = storeService;
    this.logger = logger;
  }

  /**
   * Get all products with optional filters
   */
  async getProducts(request: StoreRequest): Promise<any> {
    try {
      this.logger.info("Getting products", { request });

      const { filters = {}, pagination = { page: 1, limit: 50 } } = request;
      const offset = (pagination.page - 1) * pagination.limit;

      const products = await this.storeService.getProducts(
        filters,
        pagination.limit,
        offset
      );

      return {
        success: true,
        data: {
          products,
          pagination: {
            page: pagination.page,
            limit: pagination.limit,
          },
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to get products", error as Error, { request });
      return {
        success: false,
        error: "Failed to retrieve products",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Get product by ID
   */
  async getProductById(productId: string): Promise<any> {
    try {
      this.logger.info("Getting product by ID", { productId });

      const product = await this.storeService.getProductById(productId);

      if (!product) {
        return {
          success: false,
          error: "Product not found",
          message: `Product with ID ${productId} does not exist`,
        };
      }

      return {
        success: true,
        data: { product },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to get product by ID", error as Error, {
        productId,
      });
      return {
        success: false,
        error: "Failed to retrieve product",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Create a new product
   */
  async createProduct(request: ProductRequest): Promise<any> {
    try {
      this.logger.info("Creating product", { request });

      // Validate required fields
      if (!request.name || !request.price) {
        return {
          success: false,
          error: "Missing required fields",
          message: "Name and price are required",
        };
      }

      const product = await this.storeService.createProduct({
        name: request.name,
        description: request.description,
        price: request.price,
        currency: request.currency,
        sku: request.sku,
        imageUrl: request.imageUrl,
        category: request.category,
      });

      return {
        success: true,
        data: { product },
        message: "Product created successfully",
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to create product", error as Error, {
        request,
      });
      return {
        success: false,
        error: "Failed to create product",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Update a product
   */
  async updateProduct(
    productId: string,
    request: ProductRequest
  ): Promise<any> {
    try {
      this.logger.info("Updating product", { productId, request });

      // Check if product exists
      const existingProduct = await this.storeService.getProductById(productId);
      if (!existingProduct) {
        return {
          success: false,
          error: "Product not found",
          message: `Product with ID ${productId} does not exist`,
        };
      }

      const product = await this.storeService.updateProduct(productId, request);

      return {
        success: true,
        data: { product },
        message: "Product updated successfully",
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to update product", error as Error, {
        productId,
        request,
      });
      return {
        success: false,
        error: "Failed to update product",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Delete a product
   */
  async deleteProduct(productId: string): Promise<any> {
    try {
      this.logger.info("Deleting product", { productId });

      // Check if product exists
      const existingProduct = await this.storeService.getProductById(productId);
      if (!existingProduct) {
        return {
          success: false,
          error: "Product not found",
          message: `Product with ID ${productId} does not exist`,
        };
      }

      await this.storeService.deleteProduct(productId);

      return {
        success: true,
        message: "Product deleted successfully",
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to delete product", error as Error, {
        productId,
      });
      return {
        success: false,
        error: "Failed to delete product",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Get all carts with optional filters
   */
  async getCarts(request: CartRequest): Promise<any> {
    try {
      this.logger.info("Getting carts", { request });

      const filters: any = {};

      if (request.status) {
        filters.status = request.status;
      }
      if (request.userId) {
        filters.userId = request.userId;
      }
      if (request.dateFrom || request.dateTo) {
        filters.dateFrom = request.dateFrom
          ? new Date(request.dateFrom)
          : undefined;
        filters.dateTo = request.dateTo ? new Date(request.dateTo) : undefined;
      }

      const carts = await this.storeService.getCarts(filters, 50, 0);

      return {
        success: true,
        data: { carts },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to get carts", error as Error, { request });
      return {
        success: false,
        error: "Failed to retrieve carts",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Get cart by ID
   */
  async getCartById(cartId: string): Promise<any> {
    try {
      this.logger.info("Getting cart by ID", { cartId });

      const cart = await this.storeService.getCartById(cartId);

      if (!cart) {
        return {
          success: false,
          error: "Cart not found",
          message: `Cart with ID ${cartId} does not exist`,
        };
      }

      return {
        success: true,
        data: { cart },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to get cart by ID", error as Error, { cartId });
      return {
        success: false,
        error: "Failed to retrieve cart",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Get store statistics
   */
  async getStoreStats(): Promise<any> {
    try {
      this.logger.info("Getting store statistics");

      const stats = await this.storeService.getStoreStats();

      return {
        success: true,
        data: { statistics: stats },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to get store statistics", error as Error);
      return {
        success: false,
        error: "Failed to retrieve store statistics",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Search products
   */
  async searchProducts(query: string, limit: number = 20): Promise<any> {
    try {
      this.logger.info("Searching products", { query, limit });

      const products = await this.storeService.searchProducts(query, limit);

      return {
        success: true,
        data: { products },
        query,
        limit,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to search products", error as Error, {
        query,
        limit,
      });
      return {
        success: false,
        error: "Failed to search products",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Get product categories
   */
  async getCategories(): Promise<any> {
    try {
      this.logger.info("Getting product categories");

      const categories = await this.storeService.getCategories();

      return {
        success: true,
        data: { categories },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to get categories", error as Error);
      return {
        success: false,
        error: "Failed to retrieve categories",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Get abandoned carts for recovery
   */
  async getAbandonedCarts(
    hours: number = 24,
    limit: number = 100
  ): Promise<any> {
    try {
      this.logger.info("Getting abandoned carts", { hours, limit });

      const carts = await this.storeService.getAbandonedCarts(hours, limit);

      return {
        success: true,
        data: { carts },
        hours,
        limit,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to get abandoned carts", error as Error, {
        hours,
        limit,
      });
      return {
        success: false,
        error: "Failed to retrieve abandoned carts",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Update cart status
   */
  async updateCartStatus(
    cartId: string,
    status: "ACTIVE" | "ABANDONED" | "CONVERTED" | "EXPIRED"
  ): Promise<any> {
    try {
      this.logger.info("Updating cart status", { cartId, status });

      // Check if cart exists
      const existingCart = await this.storeService.getCartById(cartId);
      if (!existingCart) {
        return {
          success: false,
          error: "Cart not found",
          message: `Cart with ID ${cartId} does not exist`,
        };
      }

      const cart = await this.storeService.updateCartStatus(cartId, status);

      return {
        success: true,
        data: { cart },
        message: "Cart status updated successfully",
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to update cart status", error as Error, {
        cartId,
        status,
      });
      return {
        success: false,
        error: "Failed to update cart status",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Get top products by sales
   */
  async getTopProducts(limit: number = 10): Promise<any> {
    try {
      this.logger.info("Getting top products", { limit });

      const products = await this.storeService.getTopProducts(limit);

      return {
        success: true,
        data: { products },
        limit,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to get top products", error as Error, {
        limit,
      });
      return {
        success: false,
        error: "Failed to retrieve top products",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Clear store cache
   */
  async clearStoreCache(): Promise<any> {
    try {
      this.logger.info("Clearing store cache");

      await this.storeService.clearStoreCache();

      return {
        success: true,
        message: "Store cache cleared successfully",
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to clear store cache", error as Error);
      return {
        success: false,
        error: "Failed to clear store cache",
        message: (error as Error).message,
      };
    }
  }

  /**
   * Get store health check
   */
  async getStoreServiceHealth(): Promise<any> {
    try {
      this.logger.info("Getting store service health");

      const stats = await this.storeService.getStoreStats();

      const health = {
        status: "healthy",
        totalProducts: stats.totalProducts,
        totalCarts: stats.totalCarts,
        activeCarts: stats.activeCarts,
        lastCheck: new Date().toISOString(),
      };

      return {
        success: true,
        data: { health },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to get store service health", error as Error);
      return {
        success: false,
        error: "Failed to retrieve store service health",
        message: (error as Error).message,
      };
    }
  }
}
