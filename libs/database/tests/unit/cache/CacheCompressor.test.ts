import {
  compress,
  decompress,
  calculateDataSize,
} from "../../../src/cache/utils/CacheCompressor";

describe("CacheCompressor", () => {
  describe("calculateDataSize", () => {
    it("should calculate size of strings correctly", () => {
      expect(calculateDataSize("hello")).toBe(10); // 5 chars * 2 bytes (UTF-16)
      expect(calculateDataSize("")).toBe(0);
      expect(calculateDataSize("🚀")).toBe(4); // 2 bytes for emoji
    });

    it("should calculate size of numbers correctly", () => {
      expect(calculateDataSize(42)).toBe(8); // integer
      expect(calculateDataSize(3.14)).toBe(16); // float
      expect(calculateDataSize(0)).toBe(8);
    });

    it("should calculate size of booleans correctly", () => {
      expect(calculateDataSize(true)).toBe(4);
      expect(calculateDataSize(false)).toBe(4);
    });

    it("should calculate size of objects correctly", () => {
      const obj = { name: "test", value: 123 };
      const size = calculateDataSize(obj);
      expect(size).toBeGreaterThan(0);
      // JSON string length * 2
      expect(size).toBe(JSON.stringify(obj).length * 2);
    });

    it("should calculate size of arrays correctly", () => {
      const arr = [1, 2, 3, "test"];
      const size = calculateDataSize(arr);
      expect(size).toBeGreaterThan(0);
    });

    it("should handle null and undefined", () => {
      expect(calculateDataSize(null)).toBe(0);
      expect(calculateDataSize(undefined)).toBe(0);
    });

    it("should handle complex nested objects", () => {
      const complex = {
        users: [
          { id: 1, name: "Alice", profile: { age: 30, city: "NYC" } },
          { id: 2, name: "Bob", profile: { age: 25, city: "LA" } },
        ],
        metadata: {
          version: "1.0",
          timestamp: Date.now(),
          settings: { theme: "dark", notifications: true },
        },
      };

      const size = calculateDataSize(complex);
      expect(size).toBeGreaterThan(100); // Should be substantial
    });
  });

  describe("compress and decompress", () => {
    it("should compress and decompress data correctly", async () => {
      const originalData = {
        message: "This is a test message for compression",
        numbers: [1, 2, 3, 4, 5],
        nested: {
          key: "value",
          array: ["a", "b", "c"],
        },
      };

      const config = {
        algorithm: "gzip" as const,
        level: 6,
        thresholdBytes: 0, // Force compression
        enableCompression: true,
        fallbackOnError: false,
      };

      const compressed = await compress(originalData, config);

      expect(compressed.compressed).toBe(true);
      expect(compressed.algorithm).toBe("gzip");
      expect(compressed.compressedSize).toBeLessThan(compressed.originalSize);
      expect(compressed.compressionTime).toBeGreaterThan(0);

      const decompressed = await decompress(compressed.data, {
        algorithm: "gzip",
        fallbackOnError: false,
      });

      expect(decompressed.data).toEqual(originalData);
      expect(decompressed.decompressionTime).toBeGreaterThan(0);
    });

    it("should skip compression for small data", async () => {
      const smallData = { key: "value" };

      const config = {
        algorithm: "gzip" as const,
        level: 6,
        thresholdBytes: 1024, // Large threshold
        enableCompression: true,
        fallbackOnError: true,
      };

      const result = await compress(smallData, config);

      expect(result.compressed).toBe(false);
      expect(result.algorithm).toBe("none");
      expect(result.compressedSize).toBe(result.originalSize);
    });

    it("should handle compression errors gracefully", async () => {
      const config = {
        algorithm: "gzip" as const,
        level: 6,
        thresholdBytes: 0,
        enableCompression: true,
        fallbackOnError: true, // Enable fallback
      };

      // Mock a problematic object that might cause compression issues
      const problematicData: Record<string, unknown> = {
        circular: {},
      };
      (problematicData.circular as Record<string, unknown>).self =
        problematicData;

      const result = await compress(problematicData, config);

      // Should fallback to uncompressed
      expect(result.compressed).toBe(false);
      expect(result.algorithm).toBe("none");
    });

    it("should handle decompression errors gracefully", async () => {
      const config = {
        algorithm: "gzip" as const,
        fallbackOnError: true,
      };

      // Corrupted compressed data
      const corruptedData = "not-valid-gzip-data";

      const result = await decompress(corruptedData, config);

      // Should return original data as fallback
      expect(result.data).toBe(corruptedData);
    });

    it("should throw errors when fallback is disabled", async () => {
      const config = {
        algorithm: "gzip" as const,
        level: 6,
        thresholdBytes: 0,
        enableCompression: true,
        fallbackOnError: false, // Disable fallback
      };

      // Create an object that will cause JSON.stringify to fail
      const badData: Record<string, unknown> = {};
      badData.circular = badData;

      await expect(compress(badData, config)).rejects.toThrow();
    });

    it("should support different compression algorithms", async () => {
      const testData = "x".repeat(2000); // Large enough for compression
      const algorithms = ["gzip", "deflate"] as const;

      for (const algorithm of algorithms) {
        const config = {
          algorithm,
          level: 6,
          thresholdBytes: 0,
          enableCompression: true,
          fallbackOnError: false,
        };

        const compressed = await compress(testData, config);
        expect(compressed.compressed).toBe(true);
        expect(compressed.algorithm).toBe(algorithm);

        const decompressed = await decompress(compressed.data, {
          algorithm,
          fallbackOnError: false,
        });

        expect(decompressed.data).toBe(testData);
        expect(decompressed.algorithm).toBe(algorithm);
      }
    });

    it("should handle edge cases", async () => {
      // Empty object
      const emptyObj = {};
      const config = {
        algorithm: "gzip" as const,
        level: 6,
        thresholdBytes: 0,
        enableCompression: true,
        fallbackOnError: true,
      };

      const compressed = await compress(emptyObj, config);
      const decompressed = await decompress(compressed.data, {
        algorithm: "gzip",
        fallbackOnError: true,
      });

      expect(decompressed.data).toEqual(emptyObj);

      // Empty string
      const emptyString = "";
      const compressedString = await compress(emptyString, config);
      const decompressedString = await decompress(compressedString.data, {
        algorithm: "gzip",
        fallbackOnError: true,
      });

      expect(decompressedString.data).toBe(emptyString);

      // Null values
      const nullData = { key: null, nested: { value: null } };
      const compressedNull = await compress(nullData, config);
      const decompressedNull = await decompress(compressedNull.data, {
        algorithm: "gzip",
        fallbackOnError: true,
      });

      expect(decompressedNull.data).toEqual(nullData);
    });

    it("should handle large data efficiently", async () => {
      const largeData = {
        data: "x".repeat(10000), // 10KB of data
        metadata: {
          size: "large",
          type: "test",
          timestamp: Date.now(),
        },
      };

      const config = {
        algorithm: "gzip" as const,
        level: 6,
        thresholdBytes: 1024,
        enableCompression: true,
        fallbackOnError: false,
      };

      const startTime = Date.now();
      const compressed = await compress(largeData, config);
      const compressionTime = Date.now() - startTime;

      expect(compressed.compressed).toBe(true);
      expect(compressed.compressedSize).toBeLessThan(compressed.originalSize);
      expect(compressionTime).toBeLessThan(1000); // Should be fast

      const decompressStartTime = Date.now();
      const decompressed = await decompress(compressed.data, {
        algorithm: "gzip",
        fallbackOnError: false,
      });
      const decompressionTime = Date.now() - decompressStartTime;

      expect(decompressed.data).toEqual(largeData);
      expect(decompressionTime).toBeLessThan(1000); // Should be fast
    });

    it("should maintain data integrity through compress/decompress cycles", async () => {
      const complexData = {
        string: "Hello World",
        number: 42,
        boolean: true,
        null: null,
        undefined, // Will be lost in JSON
        array: [1, "two", { three: 3 }],
        object: {
          nested: {
            deep: {
              value: "nested deep value",
              array: [1, 2, { complex: "object" }],
            },
          },
        },
        date: new Date().toISOString(),
        regex: "/test/i", // Will become string
        buffer: Buffer.from("binary data").toString("base64"),
      };

      const config = {
        algorithm: "gzip" as const,
        level: 6,
        thresholdBytes: 0,
        enableCompression: true,
        fallbackOnError: false,
      };

      // Multiple compression/decompression cycles
      let data = complexData;
      for (let i = 0; i < 3; i++) {
        const compressed = await compress(data, config);
        expect(compressed.compressed).toBe(true);

        const decompressed = await decompress(compressed.data, {
          algorithm: "gzip",
          fallbackOnError: false,
        });

        // After first cycle, undefined becomes missing
        if (i === 0) {
          const { data: decompressedData } = decompressed;
          const expected = { ...complexData };
          expected.undefined = undefined; // Keep undefined for comparison
          expect(decompressedData).toEqual(expected);
          data = decompressedData as typeof complexData;
        } else {
          const { data: decompressedData } = decompressed;
          expect(decompressedData).toEqual(data);
        }
      }
    });
  });
});
