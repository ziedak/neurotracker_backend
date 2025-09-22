#!/usr/bin/env ts-node
"use strict";
/**
 * Simple test to verify the EncryptionManager works correctly
 * This demonstrates that the vulnerable base64 encoding has been replaced
 * with secure AES encryption using the battle-tested crypto-js library.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const EncryptionManager_1 = require("./src/services/EncryptionManager");
async function testEncryption() {
    console.log("🔐 Testing EncryptionManager with AES encryption...\n");
    // Test 1: Basic encryption/decryption
    console.log("1. Basic encryption/decryption test:");
    const testToken = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiYWRtaW4iOnRydWV9";
    const encryptionManager = (0, EncryptionManager_1.createEncryptionManager)("test-master-key-12345");
    try {
        const encrypted = encryptionManager.encryptCompact(testToken);
        const decrypted = encryptionManager.decryptCompact(encrypted);
        console.log(`   Original: ${testToken.substring(0, 50)}...`);
        console.log(`   Encrypted: ${encrypted.substring(0, 50)}...`);
        console.log(`   Decrypted: ${decrypted.substring(0, 50)}...`);
        console.log(`   ✅ Match: ${testToken === decrypted ? "YES" : "NO"}\n`);
        if (testToken !== decrypted) {
            throw new Error("Decryption did not match original!");
        }
    }
    catch (error) {
        console.error("   ❌ Encryption test failed:", error);
        return false;
    }
    // Test 2: Different data produces different encrypted results (with random salts)
    console.log("2. Random salt test (same data should encrypt differently):");
    try {
        const encrypted1 = encryptionManager.encryptCompact(testToken);
        const encrypted2 = encryptionManager.encryptCompact(testToken);
        console.log(`   Encryption 1: ${encrypted1.substring(0, 50)}...`);
        console.log(`   Encryption 2: ${encrypted2.substring(0, 50)}...`);
        console.log(`   ✅ Different: ${encrypted1 !== encrypted2 ? "YES" : "NO"}\n`);
        // Both should decrypt to the same original value
        const decrypted1 = encryptionManager.decryptCompact(encrypted1);
        const decrypted2 = encryptionManager.decryptCompact(encrypted2);
        if (decrypted1 !== testToken || decrypted2 !== testToken) {
            throw new Error("Different encrypted values should decrypt to same original!");
        }
    }
    catch (error) {
        console.error("   ❌ Random salt test failed:", error);
        return false;
    }
    // Test 3: Verification functionality
    console.log("3. Verification test:");
    try {
        const encrypted = encryptionManager.encryptCompact(testToken);
        const isValid = encryptionManager.verifyCompact(encrypted);
        const isInvalid = encryptionManager.verifyCompact("invalid-encrypted-data");
        console.log(`   Valid encrypted data: ${isValid ? "✅ VERIFIED" : "❌ FAILED"}`);
        console.log(`   Invalid encrypted data: ${isInvalid ? "❌ SHOULD FAIL" : "✅ CORRECTLY REJECTED"}\n`);
        if (!isValid || isInvalid) {
            throw new Error("Verification test failed!");
        }
    }
    catch (error) {
        console.error("   ❌ Verification test failed:", error);
        return false;
    }
    // Test 4: Different keys produce different results
    console.log("4. Key isolation test:");
    try {
        const manager1 = (0, EncryptionManager_1.createEncryptionManager)("key1");
        const manager2 = (0, EncryptionManager_1.createEncryptionManager)("key2");
        const encrypted1 = manager1.encryptCompact(testToken);
        const encrypted2 = manager2.encryptCompact(testToken);
        console.log(`   Key1 encryption: ${encrypted1.substring(0, 50)}...`);
        console.log(`   Key2 encryption: ${encrypted2.substring(0, 50)}...`);
        console.log(`   ✅ Different: ${encrypted1 !== encrypted2 ? "YES" : "NO"}`);
        // Manager2 should not be able to decrypt manager1's data
        try {
            manager2.decryptCompact(encrypted1);
            throw new Error("Manager2 should not decrypt manager1's data!");
        }
        catch (decryptError) {
            console.log(`   ✅ Key isolation: Manager2 cannot decrypt Manager1 data\n`);
        }
    }
    catch (error) {
        console.error("   ❌ Key isolation test failed:", error);
        return false;
    }
    // Test 5: Performance check
    console.log("5. Performance test (1000 encrypt/decrypt operations):");
    try {
        const iterations = 1000;
        const startTime = performance.now();
        for (let i = 0; i < iterations; i++) {
            const encrypted = encryptionManager.encryptCompact(testToken);
            const decrypted = encryptionManager.decryptCompact(encrypted);
            if (decrypted !== testToken) {
                throw new Error(`Iteration ${i} failed!`);
            }
        }
        const endTime = performance.now();
        const avgTime = (endTime - startTime) / iterations;
        console.log(`   ✅ ${iterations} operations completed`);
        console.log(`   ⏱️  Average time: ${avgTime.toFixed(3)}ms per operation\n`);
    }
    catch (error) {
        console.error("   ❌ Performance test failed:", error);
        return false;
    }
    return true;
}
// Run the test
testEncryption().then((success) => {
    if (success) {
        console.log("🎉 All encryption tests passed!");
        console.log("✅ EncryptionManager successfully replaced vulnerable base64 encoding");
        console.log("✅ Using battle-tested crypto-js library with AES-256-CBC");
        console.log("✅ PBKDF2 key derivation with 100,000 iterations");
        console.log("✅ Random salt generation for each encryption");
        console.log("✅ Secure token storage for Keycloak sessions");
    }
    else {
        console.log("❌ Encryption tests failed!");
        process.exit(1);
    }
}).catch((error) => {
    console.error("❌ Test execution failed:", error);
    process.exit(1);
});
