/**
 * PKCE (Proof Key for Code Exchange) Tests
 * Tests for RFC 7636 implementation and integration with Keycloak client factory
 */

import {
  generateCodeVerifier,
  generateCodeChallenge,
  generatePKCEPair,
  validateCodeVerifier,
  validateCodeChallenge,
  verifyPKCE,
  PKCEManager,
} from "../../src/utils/pkce";

describe("PKCE Utilities", () => {
  describe("Code Verifier Generation", () => {
    it("should generate valid code verifiers", () => {
      const verifier = generateCodeVerifier();

      expect(verifier).toBeDefined();
      expect(typeof verifier).toBe("string");
      expect(verifier.length).toBe(128); // default length
      expect(validateCodeVerifier(verifier)).toBe(true);
    });

    it("should generate code verifiers with custom length", () => {
      const shortVerifier = generateCodeVerifier(43);
      const longVerifier = generateCodeVerifier(100);

      expect(shortVerifier.length).toBe(43);
      expect(longVerifier.length).toBe(100);
      expect(validateCodeVerifier(shortVerifier)).toBe(true);
      expect(validateCodeVerifier(longVerifier)).toBe(true);
    });

    it("should throw error for invalid lengths", () => {
      expect(() => generateCodeVerifier(42)).toThrow();
      expect(() => generateCodeVerifier(129)).toThrow();
    });

    it("should generate unique verifiers", () => {
      const verifier1 = generateCodeVerifier();
      const verifier2 = generateCodeVerifier();

      expect(verifier1).not.toBe(verifier2);
    });
  });

  describe("Code Challenge Generation", () => {
    it("should generate valid code challenges", () => {
      const verifier = generateCodeVerifier();
      const challenge = generateCodeChallenge(verifier);

      expect(challenge).toBeDefined();
      expect(typeof challenge).toBe("string");
      expect(challenge.length).toBe(43); // S256 hash is always 43 characters
      expect(validateCodeChallenge(challenge)).toBe(true);
    });

    it("should generate consistent challenges for same verifier", () => {
      const verifier = "test-verifier-12345678901234567890123456789012345";
      const challenge1 = generateCodeChallenge(verifier);
      const challenge2 = generateCodeChallenge(verifier);

      expect(challenge1).toBe(challenge2);
    });

    it("should generate different challenges for different verifiers", () => {
      const verifier1 = generateCodeVerifier();
      const verifier2 = generateCodeVerifier();
      const challenge1 = generateCodeChallenge(verifier1);
      const challenge2 = generateCodeChallenge(verifier2);

      expect(challenge1).not.toBe(challenge2);
    });
  });

  describe("PKCE Pair Generation", () => {
    it("should generate valid PKCE pairs", () => {
      const { codeVerifier, codeChallenge } = generatePKCEPair();

      expect(validateCodeVerifier(codeVerifier)).toBe(true);
      expect(validateCodeChallenge(codeChallenge)).toBe(true);
      expect(verifyPKCE(codeVerifier, codeChallenge)).toBe(true);
    });

    it("should generate pairs with custom verifier length", () => {
      const { codeVerifier, codeChallenge } = generatePKCEPair(50);

      expect(codeVerifier.length).toBe(50);
      expect(codeChallenge.length).toBe(43);
      expect(verifyPKCE(codeVerifier, codeChallenge)).toBe(true);
    });
  });

  describe("PKCE Validation", () => {
    it("should validate correct code verifiers", () => {
      const validVerifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
      expect(validateCodeVerifier(validVerifier)).toBe(true);
    });

    it("should reject invalid code verifiers", () => {
      expect(validateCodeVerifier("too-short")).toBe(false);
      expect(validateCodeVerifier("a".repeat(129))).toBe(false);
      expect(validateCodeVerifier("invalid@characters#")).toBe(false);
      expect(validateCodeVerifier("")).toBe(false);
    });

    it("should validate correct code challenges", () => {
      const validChallenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
      expect(validateCodeChallenge(validChallenge)).toBe(true);
    });

    it("should reject invalid code challenges", () => {
      expect(validateCodeChallenge("too-short")).toBe(false);
      expect(validateCodeChallenge("a".repeat(44))).toBe(false);
      expect(validateCodeChallenge("invalid@characters#")).toBe(false);
      expect(validateCodeChallenge("")).toBe(false);
    });

    it("should verify valid PKCE pairs", () => {
      const { codeVerifier, codeChallenge } = generatePKCEPair();
      expect(verifyPKCE(codeVerifier, codeChallenge)).toBe(true);
    });

    it("should reject invalid PKCE pairs", () => {
      const { codeVerifier } = generatePKCEPair();
      const { codeChallenge } = generatePKCEPair();

      expect(verifyPKCE(codeVerifier, codeChallenge)).toBe(false);
    });
  });

  describe("PKCEManager", () => {
    let manager: PKCEManager;

    beforeEach(() => {
      manager = new PKCEManager();
    });

    it("should generate and store PKCE pairs", () => {
      const state = "test-state-123";
      const result = manager.generateAndStore(state);

      expect(result.codeVerifier).toBeDefined();
      expect(result.codeChallenge).toBeDefined();
      expect(validateCodeVerifier(result.codeVerifier)).toBe(true);
      expect(validateCodeChallenge(result.codeChallenge)).toBe(true);
    });

    it("should retrieve and remove stored verifiers", () => {
      const state = "test-state-456";
      const { codeVerifier } = manager.generateAndStore(state);

      const retrieved = manager.retrieveAndRemove(state);
      expect(retrieved).toBe(codeVerifier);

      // Should be removed after retrieval
      const retrievedAgain = manager.retrieveAndRemove(state);
      expect(retrievedAgain).toBeUndefined();
    });

    it("should return undefined for non-existent states", () => {
      const result = manager.retrieveAndRemove("non-existent-state");
      expect(result).toBeUndefined();
    });

    it("should track active challenges count", () => {
      expect(manager.getActiveChallengesCount()).toBe(0);

      manager.generateAndStore("state1");
      manager.generateAndStore("state2");
      expect(manager.getActiveChallengesCount()).toBe(2);

      manager.retrieveAndRemove("state1");
      expect(manager.getActiveChallengesCount()).toBe(1);
    });

    it("should cleanup challenges when limit exceeded", () => {
      // Add many challenges
      for (let i = 0; i < 150; i++) {
        manager.generateAndStore(`state-${i}`);
      }

      expect(manager.getActiveChallengesCount()).toBeGreaterThan(100);

      // Trigger cleanup
      manager.cleanup(0);

      expect(manager.getActiveChallengesCount()).toBe(0);
    });
  });

  describe("Integration Tests", () => {
    it("should work with the complete PKCE flow", () => {
      const manager = new PKCEManager();
      const state = "integration-test-state";

      // Step 1: Generate PKCE parameters for authorization
      const { codeVerifier, codeChallenge } = manager.generateAndStore(state);

      // Step 2: Simulate authorization flow (would send challenge to auth server)
      expect(codeChallenge).toBeDefined();

      // Step 3: Retrieve verifier for token exchange
      const retrievedVerifier = manager.retrieveAndRemove(state);
      expect(retrievedVerifier).toBe(codeVerifier);

      // Step 4: Verify PKCE pair integrity
      expect(verifyPKCE(retrievedVerifier!, codeChallenge)).toBe(true);
    });

    it("should handle multiple concurrent states", () => {
      const manager = new PKCEManager();
      const states = ["state1", "state2", "state3"];
      const pairs: Record<
        string,
        { codeVerifier: string; codeChallenge: string }
      > = {};

      // Generate multiple PKCE pairs
      for (const state of states) {
        pairs[state] = manager.generateAndStore(state);
      }

      // Retrieve in different order
      const retrieved2 = manager.retrieveAndRemove("state2");
      const retrieved1 = manager.retrieveAndRemove("state1");
      const retrieved3 = manager.retrieveAndRemove("state3");

      expect(retrieved1).toBe(pairs["state1"]?.codeVerifier);
      expect(retrieved2).toBe(pairs["state2"]?.codeVerifier);
      expect(retrieved3).toBe(pairs["state3"]?.codeVerifier);
    });
  });

  describe("Security Tests", () => {
    it("should generate cryptographically secure verifiers", () => {
      const verifiers = new Set();

      // Generate many verifiers to check for patterns
      for (let i = 0; i < 1000; i++) {
        const verifier = generateCodeVerifier();
        expect(verifiers.has(verifier)).toBe(false);
        verifiers.add(verifier);
      }

      expect(verifiers.size).toBe(1000);
    });

    it("should use only allowed characters in verifiers", () => {
      for (let i = 0; i < 100; i++) {
        const verifier = generateCodeVerifier();
        const allowedPattern = /^[A-Za-z0-9\-\._~]+$/;
        expect(allowedPattern.test(verifier)).toBe(true);
      }
    });

    it("should generate base64url-encoded challenges without padding", () => {
      for (let i = 0; i < 100; i++) {
        const verifier = generateCodeVerifier();
        const challenge = generateCodeChallenge(verifier);

        // Should not contain base64 padding
        expect(challenge.includes("=")).toBe(false);

        // Should use base64url characters
        const base64urlPattern = /^[A-Za-z0-9\-_]+$/;
        expect(base64urlPattern.test(challenge)).toBe(true);
      }
    });
  });
});
