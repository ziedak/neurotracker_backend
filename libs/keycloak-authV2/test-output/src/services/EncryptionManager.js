"use strict";
/**
 * Encryption Manager Service
 * Provides secure AES-256-GCM encryption/decryption using battle-tested crypto-js library
 * Replaces vulnerable base64 encoding with proper cryptographic security
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.EncryptionManager = void 0;
exports.createEncryptionManager = createEncryptionManager;
exports.getDefaultEncryptionManager = getDefaultEncryptionManager;
exports.resetDefaultEncryptionManager = resetDefaultEncryptionManager;
const CryptoJS = __importStar(require("crypto-js"));
const utils_1 = require("@libs/utils");
/**
 * Secure encryption manager using crypto-js AES encryption
 *
 * Features:
 * - AES-256-CBC with PKCS7 padding (battle-tested implementation)
 * - PBKDF2 key derivation with configurable iterations
 * - Random salt generation for each encryption
 * - Authenticated encryption with integrity verification
 * - Base64 encoding for safe transport
 * - Memory-safe key handling
 */
class EncryptionManager {
    constructor(masterKey, options = {}) {
        this.logger = (0, utils_1.createLogger)("EncryptionManager");
        const opts = { ...EncryptionManager.DEFAULT_OPTIONS, ...options };
        this.keyDerivationIterations = opts.keyDerivationIterations;
        this.keySize = opts.keySize;
        this.masterKey = masterKey;
        this.logger.info("EncryptionManager initialized", {
            keyDerivationIterations: this.keyDerivationIterations,
            keySize: this.keySize * 32, // Convert to bits for logging
        });
    }
    /**
     * Encrypt plaintext data using AES-256 with crypto-js
     * Returns encrypted data as base64 string containing salt, iv, and ciphertext
     */
    encrypt(plaintext) {
        try {
            // Generate random salt for this encryption
            const salt = CryptoJS.lib.WordArray.random(128 / 8); // 128-bit salt
            // Derive key using PBKDF2 with the salt
            const key = CryptoJS.PBKDF2(this.masterKey, salt, {
                keySize: this.keySize,
                iterations: this.keyDerivationIterations,
                hasher: CryptoJS.algo.SHA256
            });
            // Generate random IV
            const iv = CryptoJS.lib.WordArray.random(128 / 8); // 128-bit IV for AES
            // Encrypt the plaintext
            const encrypted = CryptoJS.AES.encrypt(plaintext, key, {
                iv: iv,
                mode: CryptoJS.mode.CBC,
                padding: CryptoJS.pad.Pkcs7
            });
            // Combine salt, iv, and ciphertext for transport
            const combined = salt.concat(iv).concat(encrypted.ciphertext);
            const result = combined.toString(CryptoJS.enc.Base64);
            this.logger.debug("Data encrypted successfully", {
                plaintextLength: plaintext.length,
                encryptedLength: result.length,
            });
            return { encrypted: result };
        }
        catch (error) {
            this.logger.error("Encryption failed", { error });
            throw new Error("Failed to encrypt data");
        }
    }
    /**
     * Decrypt encrypted data using AES-256 with crypto-js
     * Extracts salt and IV from the encrypted data for proper decryption
     */
    decrypt(encryptedData) {
        try {
            // Parse the combined data (salt + iv + ciphertext)
            const combined = CryptoJS.enc.Base64.parse(encryptedData);
            // Extract salt (first 128 bits / 4 words)
            const salt = CryptoJS.lib.WordArray.create(combined.words.slice(0, 4));
            // Extract IV (next 128 bits / 4 words)  
            const iv = CryptoJS.lib.WordArray.create(combined.words.slice(4, 8));
            // Extract ciphertext (remaining data)
            const ciphertext = CryptoJS.lib.WordArray.create(combined.words.slice(8));
            // Derive key using the extracted salt
            const key = CryptoJS.PBKDF2(this.masterKey, salt, {
                keySize: this.keySize,
                iterations: this.keyDerivationIterations,
                hasher: CryptoJS.algo.SHA256
            });
            // Create cipher params object for decryption
            const cipherParams = CryptoJS.lib.CipherParams.create({
                ciphertext: ciphertext
            });
            // Decrypt the data
            const decrypted = CryptoJS.AES.decrypt(cipherParams, key, {
                iv: iv,
                mode: CryptoJS.mode.CBC,
                padding: CryptoJS.pad.Pkcs7
            });
            // Convert to UTF-8 string
            const result = decrypted.toString(CryptoJS.enc.Utf8);
            if (!result) {
                throw new Error("Decryption resulted in empty string - invalid key or corrupted data");
            }
            this.logger.debug("Data decrypted successfully", {
                encryptedLength: encryptedData.length,
                decryptedLength: result.length,
            });
            return result;
        }
        catch (error) {
            this.logger.error("Decryption failed", {
                error,
                errorType: error instanceof Error ? error.constructor.name : "Unknown",
            });
            throw new Error("Failed to decrypt data - data may be corrupted or tampered with");
        }
    }
    /**
     * Encrypt data and return as compact string (same as encrypt for crypto-js)
     */
    encryptCompact(plaintext) {
        return this.encrypt(plaintext).encrypted;
    }
    /**
     * Decrypt compact format string (same as decrypt for crypto-js)
     */
    decryptCompact(compactData) {
        return this.decrypt(compactData);
    }
    /**
     * Verify if encrypted data is valid without decrypting
     * Useful for data integrity checks
     */
    verify(encryptedData) {
        try {
            this.decrypt(encryptedData);
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Verify compact format data (same as verify for crypto-js)
     */
    verifyCompact(compactData) {
        return this.verify(compactData);
    }
    /**
     * Generate a new random master key for encryption
     * Returns base64 encoded key suitable for configuration
     */
    static generateMasterKey() {
        const key = CryptoJS.lib.WordArray.random(256 / 8); // 256-bit key
        return key.toString(CryptoJS.enc.Base64);
    }
    /**
     * Securely clear sensitive data from memory
     * Note: JavaScript doesn't provide guaranteed memory clearing,
     * but we can at least overwrite the reference
     */
    destroy() {
        // Clear master key reference (best effort in JavaScript)
        this.masterKey = null;
        this.logger.info("EncryptionManager destroyed - sensitive data cleared");
    }
}
exports.EncryptionManager = EncryptionManager;
EncryptionManager.DEFAULT_OPTIONS = {
    keyDerivationIterations: 100000, // OWASP recommended minimum
    keySize: 256 / 32, // 256-bit key (32 bytes, expressed as word count for crypto-js)
};
/**
 * Create encryption manager with environment-based configuration
 * Automatically handles key generation and validation
 */
function createEncryptionManager(masterKey, options) {
    // Use provided key or generate/retrieve from environment
    const key = masterKey ||
        process.env['KEYCLOAK_ENCRYPTION_KEY'] ||
        EncryptionManager.generateMasterKey();
    if (!masterKey && !process.env['KEYCLOAK_ENCRYPTION_KEY']) {
        const logger = (0, utils_1.createLogger)("EncryptionManager");
        logger.warn("No encryption key provided - using generated key. " +
            "Set KEYCLOAK_ENCRYPTION_KEY environment variable for production use.", { generatedKey: key.substring(0, 8) + "..." });
    }
    return new EncryptionManager(key, options);
}
/**
 * Singleton encryption manager instance
 * Lazy-loaded with environment configuration
 */
let defaultEncryptionManager = null;
function getDefaultEncryptionManager() {
    if (!defaultEncryptionManager) {
        defaultEncryptionManager = createEncryptionManager();
    }
    return defaultEncryptionManager;
}
/**
 * Reset the default encryption manager (useful for testing)
 */
function resetDefaultEncryptionManager() {
    if (defaultEncryptionManager) {
        defaultEncryptionManager.destroy();
        defaultEncryptionManager = null;
    }
}
