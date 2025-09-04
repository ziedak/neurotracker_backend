/**
 * Cache Compression Utilities
 * Provides compression and decompression for cache entries
 * Updated with production-grade compression implementation
 */

import { type ILogger } from "@libs/monitoring";
import { inject } from "@libs/utils";
import { CompressionEngine } from "./CompressionEngine";

/**
 * Compression algorithm types
 */
export type CompressionAlgorithm =
  | "gzip"
  | "deflate"
  | "brotli"
  | "lz4"
  | "none";

/**
 * Compression configuration
 */
export interface CompressionConfig {
  algorithm: CompressionAlgorithm;
  level: number; // Compression level (1-9)
  thresholdBytes: number; // Minimum size to compress
  enableCompression: boolean;
  fallbackOnError: boolean; // Use uncompressed if compression fails
}

/**
 * Default compression configuration
 */
export const DEFAULT_COMPRESSION_CONFIG: CompressionConfig = {
  algorithm: "gzip",
  level: 6, // Good balance of speed/size
  thresholdBytes: 1024, // Compress objects > 1KB
  enableCompression: true,
  fallbackOnError: true,
};

/**
 * Compression statistics
 */
export interface CompressionStats {
  totalCompressed: number;
  totalUncompressed: number;
  compressionRatio: number;
  averageCompressionTime: number;
  compressionErrors: number;
  decompressionErrors: number;
}

/**
 * Compression result
 */
export interface CompressionResult {
  data: any;
  compressed: boolean;
  originalSize: number;
  compressedSize: number;
  compressionTime: number;
  algorithm: CompressionAlgorithm;
}

/**
 * Cache compression utility with production-grade implementation
 */
export class CacheCompressor {
  private config: CompressionConfig;
  private stats: CompressionStats = {
    totalCompressed: 0,
    totalUncompressed: 0,
    compressionRatio: 0,
    averageCompressionTime: 0,
    compressionErrors: 0,
    decompressionErrors: 0,
  };
  private logger: ILogger;
  private compressionEngine: CompressionEngine;

  constructor(
    @inject("ILogger") logger: ILogger,
    config: Partial<CompressionConfig> = {}
  ) {
    this.config = { ...DEFAULT_COMPRESSION_CONFIG, ...config };
    this.logger = logger.child({ service: "CacheCompressor" });
    this.compressionEngine = new CompressionEngine(this.logger);
  }

  /**
   * Compress data if it meets the threshold
   */
  async compress(data: any): Promise<CompressionResult> {
    const startTime = performance.now();
    const originalSize = this.calculateDataSize(data);

    // Check if compression is enabled and data is large enough
    if (!this.config.enableCompression) {
      return {
        data,
        compressed: false,
        originalSize,
        compressedSize: originalSize,
        compressionTime: performance.now() - startTime,
        algorithm: "none",
      };
    }

    try {
      const jsonString = JSON.stringify(data);

      // Use CompressionEngine to check if compression is worthwhile
      const compressionCheck = this.compressionEngine.isCompressionWorthwhile(
        jsonString,
        this.config.thresholdBytes
      );

      if (!compressionCheck.shouldCompress) {
        this.logger.debug("Skipping compression", {
          reason: compressionCheck.reason,
          dataSize: compressionCheck.dataSize,
        });

        return {
          data,
          compressed: false,
          originalSize,
          compressedSize: originalSize,
          compressionTime: performance.now() - startTime,
          algorithm: "none",
        };
      }

      // Use smart compression for gzip/deflate algorithms
      let compressedData: any;
      if (
        this.config.algorithm === "gzip" ||
        this.config.algorithm === "deflate"
      ) {
        const smartResult = await this.compressionEngine.smartCompress(
          jsonString,
          {
            level: this.config.level,
            forceAlgorithm: this.config.algorithm,
          }
        );

        compressedData = {
          algorithm: smartResult.algorithm,
          compressed: true,
          data: smartResult.data,
          originalSize: smartResult.originalSize,
          compressedSize: smartResult.compressedSize,
          compressionTime: smartResult.compressionTime,
          compressionRatio: smartResult.compressionRatio,
        };
      } else {
        // Fall back to regular compression for other algorithms
        compressedData = await this.compressData(data);
      }

      const compressionTime = performance.now() - startTime;

      // Update statistics
      this.updateCompressionStats(
        originalSize,
        compressedData.compressedSize || this.calculateDataSize(compressedData),
        compressionTime
      );

      this.logger.debug("Data compressed", {
        originalSize,
        compressedSize: compressedData.compressedSize,
        ratio: compressedData.compressionRatio
          ? (compressedData.compressionRatio * 100).toFixed(1) + "%"
          : "N/A",
        time: Math.round(compressionTime * 100) / 100 + "ms",
        algorithm: compressedData.algorithm,
      });

      return {
        data: compressedData,
        compressed: true,
        originalSize,
        compressedSize:
          compressedData.compressedSize ||
          this.calculateDataSize(compressedData),
        compressionTime,
        algorithm: this.config.algorithm,
      };
    } catch (error) {
      this.stats.compressionErrors++;
      this.logger.warn("Compression failed, using original data", {
        error: error instanceof Error ? error.message : String(error),
        originalSize,
      });

      if (!this.config.fallbackOnError) {
        throw error;
      }

      return {
        data,
        compressed: false,
        originalSize,
        compressedSize: originalSize,
        compressionTime: performance.now() - startTime,
        algorithm: "none",
      };
    }
  }

  /**
   * Decompress data if it was compressed
   */
  async decompress(
    compressedData: any,
    algorithm: CompressionAlgorithm = this.config.algorithm
  ): Promise<any> {
    const startTime = performance.now();

    try {
      const decompressedData = await this.decompressData(
        compressedData,
        algorithm
      );
      const decompressionTime = performance.now() - startTime;

      this.logger.debug("Data decompressed", {
        time: Math.round(decompressionTime * 100) / 100 + "ms",
      });

      return decompressedData;
    } catch (error) {
      this.stats.decompressionErrors++;
      this.logger.error("Decompression failed", {
        error: error instanceof Error ? error.message : String(error),
        algorithm,
      });

      if (!this.config.fallbackOnError) {
        throw error;
      }

      // Return original data if decompression fails
      return compressedData;
    }
  }

  /**
   * Compress data using the configured algorithm
   */
  private async compressData(data: any): Promise<any> {
    const jsonString = JSON.stringify(data);

    switch (this.config.algorithm) {
      case "gzip":
        return await this.gzipCompress(jsonString);
      case "deflate":
        return await this.deflateCompress(jsonString);
      case "brotli":
        return await this.brotliCompress(jsonString);
      case "lz4":
        return await this.lz4Compress(jsonString);
      default:
        throw new Error(
          `Unsupported compression algorithm: ${this.config.algorithm}`
        );
    }
  }

  /**
   * Decompress data using the specified algorithm
   */
  private async decompressData(
    compressedData: any,
    algorithm: CompressionAlgorithm
  ): Promise<any> {
    let decompressedString: string;

    switch (algorithm) {
      case "gzip":
        decompressedString = await this.gzipDecompress(compressedData);
        break;
      case "deflate":
        decompressedString = await this.deflateDecompress(compressedData);
        break;
      case "brotli":
        decompressedString = await this.brotliDecompress(compressedData);
        break;
      case "lz4":
        decompressedString = await this.lz4Decompress(compressedData);
        break;
      default:
        throw new Error(`Unsupported decompression algorithm: ${algorithm}`);
    }

    return JSON.parse(decompressedString);
  }

  /**
   * Gzip compression using production-grade CompressionEngine
   */
  private async gzipCompress(data: string): Promise<any> {
    const result = await this.compressionEngine.compressGzip(
      data,
      this.config.level
    );
    return {
      algorithm: "gzip",
      compressed: true,
      data: result.data,
      originalSize: result.originalSize,
      compressedSize: result.compressedSize,
      compressionTime: result.compressionTime,
      compressionRatio: result.compressionRatio,
    };
  }

  /**
   * Gzip decompression using production-grade CompressionEngine
   */
  private async gzipDecompress(compressedData: any): Promise<string> {
    if (compressedData.algorithm !== "gzip" || !compressedData.compressed) {
      throw new Error("Invalid gzip compressed data");
    }
    return await this.compressionEngine.decompressGzip(compressedData.data);
  }

  /**
   * Deflate compression using production-grade CompressionEngine
   */
  private async deflateCompress(data: string): Promise<any> {
    const result = await this.compressionEngine.compressDeflate(
      data,
      this.config.level
    );
    return {
      algorithm: "deflate",
      compressed: true,
      data: result.data,
      originalSize: result.originalSize,
      compressedSize: result.compressedSize,
      compressionTime: result.compressionTime,
      compressionRatio: result.compressionRatio,
    };
  }

  /**
   * Deflate decompression using production-grade CompressionEngine
   */
  private async deflateDecompress(compressedData: any): Promise<string> {
    if (compressedData.algorithm !== "deflate" || !compressedData.compressed) {
      throw new Error("Invalid deflate compressed data");
    }
    return await this.compressionEngine.decompressDeflate(compressedData.data);
  }

  /**
   * Brotli compression
   */
  private async brotliCompress(data: string): Promise<any> {
    return {
      algorithm: "brotli",
      compressed: true,
      data: this.simpleCompress(data),
    };
  }

  /**
   * Brotli decompression
   */
  private async brotliDecompress(compressedData: any): Promise<string> {
    if (compressedData.algorithm !== "brotli" || !compressedData.compressed) {
      throw new Error("Invalid brotli compressed data");
    }
    return this.simpleDecompress(compressedData.data);
  }

  /**
   * LZ4 compression
   */
  private async lz4Compress(data: string): Promise<any> {
    return {
      algorithm: "lz4",
      compressed: true,
      data: this.simpleCompress(data),
    };
  }

  /**
   * LZ4 decompression
   */
  private async lz4Decompress(compressedData: any): Promise<string> {
    if (compressedData.algorithm !== "lz4" || !compressedData.compressed) {
      throw new Error("Invalid LZ4 compressed data");
    }
    return this.simpleDecompress(compressedData.data);
  }

  /**
   * Simple compression simulation (for demonstration)
   * In production, replace with actual compression libraries
   */
  private simpleCompress(data: string): string {
    // Simple run-length encoding for demonstration
    let compressed = "";
    let count = 1;
    let current = data[0];

    for (let i = 1; i < data.length; i++) {
      if (data[i] === current && count < 255) {
        count++;
      } else {
        compressed += String.fromCharCode(count) + current;
        current = data[i];
        count = 1;
      }
    }
    compressed += String.fromCharCode(count) + current;

    return compressed;
  }

  /**
   * Simple decompression
   */
  private simpleDecompress(compressedData: string): string {
    let decompressed = "";

    for (let i = 0; i < compressedData.length; i += 2) {
      const count = compressedData.charCodeAt(i);
      const char = compressedData[i + 1];
      if (char !== undefined) {
        decompressed += char.repeat(count);
      } else {
        // Optionally log or handle the error case
        throw new Error("Invalid compressed data: character is undefined");
      }
    }

    return decompressed;
  }

  /**
   * Calculate data size in bytes
   */
  private calculateDataSize(data: any): number {
    if (data === null || data === undefined) return 0;

    if (typeof data === "string") {
      return data.length * 2; // UTF-16
    }

    if (typeof data === "number") {
      return data % 1 === 0 ? 8 : 16; // int vs float
    }

    if (typeof data === "boolean") {
      return 4;
    }

    // For objects and arrays, serialize and measure
    try {
      const jsonString = JSON.stringify(data);
      return jsonString.length * 2;
    } catch {
      return 8; // Fallback size
    }
  }

  /**
   * Update compression statistics
   */
  private updateCompressionStats(
    originalSize: number,
    compressedSize: number,
    compressionTime: number
  ): void {
    this.stats.totalCompressed++;
    this.stats.compressionRatio =
      (this.stats.compressionRatio * (this.stats.totalCompressed - 1) +
        compressedSize / originalSize) /
      this.stats.totalCompressed;

    this.stats.averageCompressionTime =
      (this.stats.averageCompressionTime * (this.stats.totalCompressed - 1) +
        compressionTime) /
      this.stats.totalCompressed;
  }

  /**
   * Get compression statistics
   */
  getCompressionStats(): CompressionStats {
    return { ...this.stats };
  }

  /**
   * Get compression configuration
   */
  getConfig(): CompressionConfig {
    return { ...this.config };
  }

  /**
   * Update compression configuration
   */
  updateConfig(newConfig: Partial<CompressionConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.logger.info("Compression configuration updated", this.config);
  }

  /**
   * Reset compression statistics
   */
  resetStats(): void {
    this.stats = {
      totalCompressed: 0,
      totalUncompressed: 0,
      compressionRatio: 0,
      averageCompressionTime: 0,
      compressionErrors: 0,
      decompressionErrors: 0,
    };
  }
}
