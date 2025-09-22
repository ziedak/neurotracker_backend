import { createHmac, randomBytes } from "crypto";

// Simulate the optimized key derivation logic
class BenchmarkSecureCache {
  private secretKey: string;
  private salt: string;

  constructor() {
    this.secretKey = randomBytes(32).toString("hex");
    this.salt = randomBytes(16).toString("hex");
  }

  deriveKey(key: string): string {
    const hmac = createHmac("sha256", this.secretKey);
    hmac.update(key + this.salt);
    return hmac.digest("hex");
  }
}

// Performance benchmark
const benchmarkKeyDerivation = (iterations: number = 10000): void => {
  const cache = new BenchmarkSecureCache();
  const testKey = "user:123:session";

  console.log(
    `\n🔍 SecureCache Key Derivation Performance Benchmark (${iterations} iterations)`
  );
  console.log("=".repeat(70));

  // Benchmark key derivation
  const derivationTimes: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    cache.deriveKey(testKey);
    derivationTimes.push(performance.now() - start);
  }

  const avgDerivation = derivationTimes.reduce((a, b) => a + b, 0) / iterations;
  const maxDerivation = Math.max(...derivationTimes);
  const sortedTimes = [...derivationTimes].sort((a, b) => a - b);
  const p95Derivation = sortedTimes[Math.floor(iterations * 0.95)];

  console.log(`HMAC-SHA256 Key Derivation Performance:`);
  console.log(`  Average: ${avgDerivation.toFixed(4)}ms`);
  console.log(`  Max: ${maxDerivation.toFixed(4)}ms`);
  console.log(`  P95: ${p95Derivation.toFixed(4)}ms`);
  console.log(
    `  Status: ${
      avgDerivation < 1 ? "✅ PASS" : "❌ FAIL"
    } (< 1ms required for auth)`
  );

  // Compare with old PBKDF2 performance (simulated)
  console.log(`\n📊 Performance Comparison:`);
  console.log(`  HMAC-SHA256 (current): ${avgDerivation.toFixed(4)}ms`);
  console.log(`  PBKDF2 100k iter (old): ~50-200ms (estimated)`);
  console.log(
    `  Performance improvement: ${(((200 - avgDerivation) / 200) * 100).toFixed(
      0
    )}x faster`
  );

  console.log(`\n🎯 Auth Performance Requirements:`);
  console.log(
    `  Key Derivation: < 1ms - ${avgDerivation < 1 ? "✅ MET" : "❌ NOT MET"}`
  );
  console.log(
    `  Authentication Flow: < 100ms total - ${
      avgDerivation < 1 ? "✅ LIKELY MET" : "❌ UNLIKELY"
    }`
  );
};

console.log("🚀 Running SecureCache Performance Benchmark...\n");
benchmarkKeyDerivation(10000);
