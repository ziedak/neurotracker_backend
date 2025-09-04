/**
 * Real Compression Engine Implementation
 * Fixes Issue #1: Missing Real Compression Implementation
 */

import { gzip, gunzip, deflate, inflate } from "node:zlib";
import { promisify } from "node:util";
import { type ILogger } from "@libs/monitoring";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const deflateAsync = promisify(deflate);
const inflateAsync = promisify(inflate);

export interface CompressionResult {
  data: Buffer | string;
  compressed: boolean;
  originalSize: number;
  compressedSize: number;
  compressionTime: number;
  algorithm: string;
  compressionRatio: number;
}

/**
 * Production-grade compression engine
 */
export class CompressionEngine {
  constructor(private readonly logger: ILogger) {}

  /**
   * Compress data using gzip
   */
  async compressGzip(
    data: string,
    level: number = 6
  ): Promise<CompressionResult> {
    const startTime = performance.now();
    const originalBuffer = Buffer.from(data, "utf8");
    const originalSize = originalBuffer.length;

    try {
      const compressedBuffer = await gzipAsync(originalBuffer, { level });
      const compressedSize = compressedBuffer.length;
      const compressionTime = performance.now() - startTime;
      const compressionRatio = compressedSize / originalSize;

      return {
        data: compressedBuffer,
        compressed: true,
        originalSize,
        compressedSize,
        compressionTime,
        algorithm: "gzip",
        compressionRatio,
      };
    } catch (error) {
      this.logger.error("Gzip compression failed", error as Error);
      throw new Error(
        `Gzip compression failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Decompress gzip data
   */
  async decompressGzip(compressedData: Buffer): Promise<string> {
    try {
      const decompressedBuffer = await gunzipAsync(compressedData);
      return decompressedBuffer.toString("utf8");
    } catch (error) {
      this.logger.error("Gzip decompression failed", error as Error);
      throw new Error(
        `Gzip decompression failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Compress data using deflate
   */
  async compressDeflate(
    data: string,
    level: number = 6
  ): Promise<CompressionResult> {
    const startTime = performance.now();
    const originalBuffer = Buffer.from(data, "utf8");
    const originalSize = originalBuffer.length;

    try {
      const compressedBuffer = await deflateAsync(originalBuffer, { level });
      const compressedSize = compressedBuffer.length;
      const compressionTime = performance.now() - startTime;
      const compressionRatio = compressedSize / originalSize;

      return {
        data: compressedBuffer,
        compressed: true,
        originalSize,
        compressedSize,
        compressionTime,
        algorithm: "deflate",
        compressionRatio,
      };
    } catch (error) {
      this.logger.error("Deflate compression failed", error as Error);
      throw new Error(
        `Deflate compression failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Decompress deflate data
   */
  async decompressDeflate(compressedData: Buffer): Promise<string> {
    try {
      const decompressedBuffer = await inflateAsync(compressedData);
      return decompressedBuffer.toString("utf8");
    } catch (error) {
      this.logger.error("Deflate decompression failed", error as Error);
      throw new Error(
        `Deflate decompression failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Smart compression - chooses best algorithm based on data characteristics
   */
  async smartCompress(
    data: string,
    options: {
      level?: number;
      forceAlgorithm?: "gzip" | "deflate";
      maxCompressionTime?: number;
    } = {}
  ): Promise<CompressionResult> {
    const { level = 6, forceAlgorithm, maxCompressionTime = 100 } = options;

    if (forceAlgorithm) {
      return forceAlgorithm === "gzip"
        ? await this.compressGzip(data, level)
        : await this.compressDeflate(data, level);
    }

    // Try both algorithms and pick the better one
    const [gzipResult, deflateResult] = await Promise.allSettled([
      this.compressGzip(data, level),
      this.compressDeflate(data, level),
    ]);

    const results: CompressionResult[] = [];

    if (
      gzipResult.status === "fulfilled" &&
      gzipResult.value.compressionTime <= maxCompressionTime
    ) {
      results.push(gzipResult.value);
    }

    if (
      deflateResult.status === "fulfilled" &&
      deflateResult.value.compressionTime <= maxCompressionTime
    ) {
      results.push(deflateResult.value);
    }

    if (results.length === 0) {
      throw new Error(
        "All compression algorithms failed or exceeded time limit"
      );
    }

    // Return the result with better compression ratio
    return results.reduce((best, current) =>
      current.compressionRatio < best.compressionRatio ? current : best
    );
  }

  /**
   * Check if data is worth compressing
   */
  isCompressionWorthwhile(
    data: string,
    thresholdBytes: number = 1024
  ): { shouldCompress: boolean; reason: string; dataSize: number } {
    const dataSize = Buffer.byteLength(data, "utf8");

    if (dataSize < thresholdBytes) {
      return {
        shouldCompress: false,
        reason: `Data size (${dataSize}B) below threshold (${thresholdBytes}B)`,
        dataSize,
      };
    }

    // Check for highly repetitive data (likely to compress well)
    const uniqueChars = new Set(data).size;
    const compressionPotential = 1 - uniqueChars / data.length;

    if (compressionPotential < 0.1) {
      return {
        shouldCompress: false,
        reason: `Low compression potential (${(
          compressionPotential * 100
        ).toFixed(1)}%)`,
        dataSize,
      };
    }

    return {
      shouldCompress: true,
      reason: `Good compression candidate (${(
        compressionPotential * 100
      ).toFixed(1)}% potential)`,
      dataSize,
    };
  }
}
