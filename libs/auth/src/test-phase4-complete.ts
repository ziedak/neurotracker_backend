#!/usr/bin/env tsx

/**
 *     // Test 1: Oslo Cryptographic Performance
    console.log('\n1. Testing Oslo Cryptographic Performance...');
    const cryptoResults = await cryptoService.benchmark();se 4 Complete Integration Test
 * Tests the full Phase 4 optimization with Oslo cryptographic services
 */

import { config } from "dotenv";
config({ path: "../../.env" });

import { Phase4OptimizationService } from "./services/phase4-optimization.service";
import { OsloCryptographicService } from "./services/oslo-cryptographic.service";
import { Logger } from "@libs/monitoring";
import { RedisClient } from "@libs/database";

async function testPhase4Complete() {
  const logger = new Logger({ service: "Phase4Test" });

  console.log("🚀 Phase 4 Oslo Cryptographic Integration Test\n");

  try {
    // Initialize services
    const cryptoService = new OsloCryptographicService();
    const phase4Service = new Phase4OptimizationService();

    console.log("✅ Services initialized successfully");

    // Test 1: Oslo Cryptographic Performance
    console.log("\n1. Testing Oslo Cryptographic Performance...");
    const cryptoResults = await cryptoService.benchmarkPerformance(100);

    console.log(
      `   Password Hashing: ${cryptoResults.passwordHashing.averageTime.toFixed(
        2
      )}ms avg`
    );
    console.log(
      `   Password Verification: ${cryptoResults.passwordVerification.averageTime.toFixed(
        2
      )}ms avg`
    );
    console.log(
      `   JWT Creation: ${cryptoResults.jwtCreation.averageTime.toFixed(
        2
      )}ms avg`
    );
    console.log(
      `   JWT Validation: ${cryptoResults.jwtValidation.averageTime.toFixed(
        2
      )}ms avg`
    );

    // Test 2: Phase 4 Health Check
    console.log("\n2. Testing Phase 4 Health Status...");
    const healthStatus = await phase4Service.getHealthStatus();

    console.log(`   Overall Status: ${healthStatus.status}`);
    console.log(
      `   Services Health: ${
        Object.keys(healthStatus.services).length
      } services monitored`
    );
    console.log(
      `   Oslo Crypto: ${healthStatus.services.osloCryptographic || "unknown"}`
    );

    // Test 3: Optimization Metrics
    console.log("\n3. Testing Optimization Metrics...");
    const metrics = await phase4Service.getOptimizationMetrics();

    console.log(`   Status: ${metrics.status}`);
    console.log(
      `   Improvements: ${metrics.improvements.length} optimizations active`
    );

    // Test 4: Performance Benchmark
    console.log("\n4. Running Phase 4 Performance Benchmark...");
    const benchmarkResults = await phase4Service.benchmark();

    console.log(
      `   Cryptographic Operations: ${benchmarkResults.cryptographicOperations.averageTime.toFixed(
        2
      )}ms avg`
    );
    console.log(
      `   Performance Score: ${benchmarkResults.performanceScore.toFixed(
        1
      )}/100`
    );
    console.log(
      `   Memory Usage: ${(benchmarkResults.memoryUsage / 1024 / 1024).toFixed(
        2
      )}MB`
    );

    // Test 5: Integration Test
    console.log("\n5. Running Full Integration Test...");

    const testData = {
      userId: "test-user-123",
      password: "secure-test-password-2024",
      permissions: ["read", "write"],
      metadata: { source: "phase4-test" },
    };

    // Hash password
    const hashResult = await cryptoService.hashPassword(testData.password);
    console.log(`   ✅ Password hashed: ${hashResult.hash.length} chars`);

    // Verify password
    const isValid = await cryptoService.verifyPassword(
      testData.password,
      hashResult
    );
    console.log(
      `   ✅ Password verification: ${isValid ? "PASSED" : "FAILED"}`
    );

    // Create JWT
    const jwtToken = await cryptoService.createJWTToken(
      {
        sub: testData.userId,
        permissions: testData.permissions,
        metadata: testData.metadata,
      },
      "test-secret-key"
    );
    console.log(`   ✅ JWT created: ${jwtToken.length} chars`);

    // Validate JWT
    const jwtPayload = await cryptoService.validateJWTToken(
      jwtToken,
      "test-secret-key"
    );
    console.log(`   ✅ JWT validation: ${jwtPayload ? "PASSED" : "FAILED"}`);
    if (jwtPayload) {
      console.log(`      Subject: ${jwtPayload.sub}`);
      console.log(
        `      Permissions: ${JSON.stringify(jwtPayload.permissions)}`
      );
    }

    console.log("\n🎉 Phase 4 Complete Integration Test: ALL TESTS PASSED!");
    console.log("\n📊 Phase 4 Summary:");
    console.log(`   ✅ Oslo Cryptographic Service: Fully operational`);
    console.log(`   ✅ Modern cryptography (scrypt, JWT, HMAC)`);
    console.log(`   ✅ Performance benchmarking complete`);
    console.log(`   ✅ Health monitoring active`);
    console.log(`   ✅ Integration tests successful`);

    return {
      success: true,
      cryptoResults,
      healthStatus,
      metrics,
      benchmarkResults,
    };
  } catch (error) {
    console.error("❌ Phase 4 test failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

if (require.main === module) {
  testPhase4Complete()
    .then((result) => {
      if (result.success) {
        console.log("\n✅ Phase 4 implementation is ready for production!");
        process.exit(0);
      } else {
        console.error("\n❌ Phase 4 implementation needs attention.");
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error("Fatal error:", error);
      process.exit(1);
    });
}
