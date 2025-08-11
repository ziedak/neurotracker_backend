/**
 * Simplified AI Engine Services
 * Optimized for performance and maintainability
 */

import { performance } from "perf_hooks";

// Simple types
interface SimplePrediction {
  cartId: string;
  probability: number;
  confidence: number;
  modelVersion: string;
  timestamp: string;
}

interface PredictRequest {
  cartId: string;
  modelName?: string;
}

// Simple in-memory cache with size limits
class SimpleCache<T> {
  private cache = new Map<string, { data: T; expires: number }>();
  private readonly maxSize: number;
  private readonly defaultTtl: number;

  constructor(maxSize = 1000, defaultTtl = 900000) { // 15 min TTL
    this.maxSize = maxSize;
    this.defaultTtl = defaultTtl;
  }

  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry || entry.expires < Date.now()) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  set(key: string, data: T, ttl = this.defaultTtl): void {
    // Cleanup if we're at max size
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      data,
      expires: Date.now() + ttl
    });
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

// Simplified prediction service
export class SimplePredictionService {
  private readonly cache = new SimpleCache<SimplePrediction>();
  private stats = { total: 0, hits: 0, errors: 0 };

  async predict(request: PredictRequest): Promise<SimplePrediction> {
    const startTime = performance.now();
    this.stats.total++;

    try {
      const cacheKey = `${request.cartId}:${request.modelName || 'default'}`;
      
      // Check cache first
      const cached = this.cache.get(cacheKey);
      if (cached) {
        this.stats.hits++;
        return cached;
      }

      // Generate prediction (simplified)
      const prediction = this.generatePrediction(request);
      
      // Cache result
      this.cache.set(cacheKey, prediction);
      
      return prediction;
    } catch (error) {
      this.stats.errors++;
      throw new Error(`Prediction failed: ${error}`);
    }
  }

  async batchPredict(requests: PredictRequest[]): Promise<SimplePrediction[]> {
    // Simple parallel processing with error isolation
    const results = await Promise.allSettled(
      requests.map(req => this.predict(req))
    );

    return results
      .filter((result): result is PromiseFulfilledResult<SimplePrediction> => 
        result.status === 'fulfilled')
      .map(result => result.value);
  }

  private generatePrediction(request: PredictRequest): SimplePrediction {
    // Simplified prediction logic
    const cartHash = this.hashString(request.cartId);
    const probability = 0.3 + (cartHash % 100) / 100 * 0.4; // 0.3 to 0.7
    
    return {
      cartId: request.cartId,
      probability: Math.round(probability * 100) / 100,
      confidence: 0.85,
      modelVersion: "1.0.0",
      timestamp: new Date().toISOString()
    };
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) & 0xffffffff;
    }
    return Math.abs(hash);
  }

  getStats() {
    return {
      ...this.stats,
      cacheSize: this.cache.size(),
      hitRate: this.stats.total > 0 ? this.stats.hits / this.stats.total : 0
    };
  }

  clearCache(): void {
    this.cache.clear();
  }
}

// Simplified feature service
export class SimpleFeatureService {
  async getFeatures(cartId: string): Promise<Record<string, number>> {
    // Mock feature computation
    const features = {
      cart_value: 100 + (this.hashString(cartId) % 500),
      session_duration: 300 + (this.hashString(cartId) % 600),
      page_views: 5 + (this.hashString(cartId) % 10),
      user_engagement: 0.5 + (this.hashString(cartId) % 50) / 100
    };

    return features;
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) & 0xffffffff;
    }
    return Math.abs(hash);
  }
}

// Simple service factory
export class Services {
  private static predictionService: SimplePredictionService;
  private static featureService: SimpleFeatureService;

  static getPredictionService(): SimplePredictionService {
    if (!this.predictionService) {
      this.predictionService = new SimplePredictionService();
    }
    return this.predictionService;
  }

  static getFeatureService(): SimpleFeatureService {
    if (!this.featureService) {
      this.featureService = new SimpleFeatureService();
    }
    return this.featureService;
  }
}
