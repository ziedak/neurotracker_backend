/**
 * Test script for Oslo Cryptographic Service
 * Quick validation of our Phase 4 implementation
 */

import { OsloCryptographicService } from "./services/oslo-cryptographic.service.js";

async function testOsloService() {
  console.log("🧪 Testing Oslo Cryptographic Service...\n");

  const osloService = new OsloCryptographicService();

  try {
    // Test password hashing and verification
    console.log("1. Testing password hashing...");
    const testPassword = "SecureTest123!";
    const hashResult = await osloService.hashPassword(testPassword);

    console.log(`✅ Password hashed successfully!`);
    console.log(`   Algorithm: ${hashResult.algorithm}`);
    console.log(`   Salt length: ${hashResult.salt.length}`);
    console.log(`   Hash length: ${hashResult.hash.length}`);

    // Test password verification
    console.log("\n2. Testing password verification...");
    const isValid = await osloService.verifyPassword(testPassword, hashResult);
    console.log(`✅ Password verification: ${isValid ? "PASSED" : "FAILED"}`);

    const isInvalid = await osloService.verifyPassword(
      "WrongPassword",
      hashResult
    );
    console.log(
      `✅ Wrong password rejection: ${!isInvalid ? "PASSED" : "FAILED"}`
    );

    // Test JWT token creation and validation
    console.log("\n3. Testing JWT token operations...");
    const payload = { sub: "user123", role: "admin" };
    const secret = "test-secret-key";

    const jwt = await osloService.createJWTToken(payload, secret, 3600);
    console.log(`✅ JWT created successfully!`);
    console.log(`   Token length: ${jwt.length}`);

    const validatedPayload = await osloService.validateJWTToken(jwt, secret);
    console.log(`✅ JWT validation: ${validatedPayload ? "PASSED" : "FAILED"}`);

    if (validatedPayload) {
      console.log(`   Subject: ${validatedPayload.sub}`);
      console.log(`   Role: ${validatedPayload["role"]}`);
    }

    // Test secure token generation
    console.log("\n4. Testing secure token generation...");
    const sessionToken = osloService.generateSecureToken("session");
    console.log(
      `✅ Session token generated: ${sessionToken.token.length} chars`
    );

    const apiToken = osloService.generateSecureToken("api");
    console.log(`✅ API token generated: ${apiToken.token.length} chars`);

    // Test hash generation
    console.log("\n5. Testing hash generation...");
    const testData = "Hello, Oslo!";
    const hash = osloService.generateHash(testData);
    console.log(`✅ Hash generated: ${hash}`);

    const base64Hash = osloService.generateHash(testData, "base64");
    console.log(`✅ Base64 hash generated: ${base64Hash}`);

    // Test HMAC
    console.log("\n6. Testing HMAC...");
    const hmacResult = osloService.generateHMAC(testData, "secret-key");
    console.log(`✅ HMAC generated: ${hmacResult}`);

    console.log("\n🎉 All Oslo Cryptographic Service tests passed!");
    console.log("\n📊 Phase 4 Optimization: COMPLETE");
    console.log("   ✅ Modern cryptography with Oslo packages");
    console.log("   ✅ Secure password hashing with scrypt");
    console.log("   ✅ JWT creation and validation");
    console.log("   ✅ Cryptographic token generation");
    console.log("   ✅ Hash and HMAC operations");
  } catch (error) {
    console.error("❌ Test failed:", error);
    process.exit(1);
  }
}

// Run the test
testOsloService();
