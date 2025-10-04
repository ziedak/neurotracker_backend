# Key Management

Cryptographic key lifecycle management for the authentication system, ensuring secure key generation, storage, rotation, and destruction.

## Key Types

### Authentication Keys

#### JWT Signing Keys

```typescript
interface JWTKeyPair {
  id: string;
  algorithm: "RS256" | "ES256";
  publicKey: string;
  privateKey: string; // Encrypted at rest
  createdAt: Date;
  expiresAt: Date;
  status: "active" | "rotated" | "compromised";
}

class JWTKeyManager {
  async generateKeyPair(): Promise<JWTKeyPair> {
    // Generate RSA key pair
    const { publicKey, privateKey } = await crypto.generateKeyPair("rsa", {
      modulusLength: 2048,
      publicExponent: 0x10001,
    });

    // Encrypt private key
    const encryptedPrivate = await this.encryptPrivateKey(privateKey);

    const keyPair: JWTKeyPair = {
      id: crypto.randomUUID(),
      algorithm: "RS256",
      publicKey: publicKey.export({ type: "spki", format: "pem" }),
      privateKey: encryptedPrivate,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
      status: "active",
    };

    await this.storeKeyPair(keyPair);
    return keyPair;
  }

  async rotateKeys(): Promise<void> {
    // Generate new key pair
    const newKeys = await this.generateKeyPair();

    // Update active key
    await this.setActiveKey(newKeys.id);

    // Keep old keys for verification window
    await this.scheduleKeyCleanup(this.currentKeyId, 30 * 24 * 60 * 60 * 1000); // 30 days
  }
}
```

#### API Key Encryption

```typescript
class APIKeyEncryptor {
  async encryptApiKey(apiKey: string): Promise<EncryptedAPIKey> {
    const salt = crypto.randomBytes(32);
    const key = await this.deriveKey(this.masterKey, salt);

    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher("aes-256-gcm", key);

    let encrypted = cipher.update(apiKey, "utf8", "hex");
    encrypted += cipher.final("hex");

    return {
      encrypted,
      salt: salt.toString("hex"),
      iv: iv.toString("hex"),
      tag: cipher.getAuthTag().toString("hex"),
    };
  }

  async decryptApiKey(encrypted: EncryptedAPIKey): Promise<string> {
    const key = await this.deriveKey(
      this.masterKey,
      Buffer.from(encrypted.salt, "hex")
    );
    const decipher = crypto.createDecipher("aes-256-gcm", key);

    decipher.setAuthTag(Buffer.from(encrypted.tag, "hex"));
    decipher.setAAD(Buffer.from(encrypted.iv, "hex"));

    let decrypted = decipher.update(encrypted.encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  }
}
```

### Data Encryption Keys

#### Database Encryption

```typescript
interface DataEncryptionKey {
  id: string;
  key: string; // Encrypted with master key
  algorithm: "AES-256-GCM";
  createdAt: Date;
  rotatedAt?: Date;
  status: "active" | "deprecated";
}

class DataKeyManager {
  async createDataKey(): Promise<DataEncryptionKey> {
    // Generate random 256-bit key
    const rawKey = crypto.randomBytes(32);

    // Encrypt with master key
    const encryptedKey = await this.encryptWithMasterKey(rawKey);

    const dataKey: DataEncryptionKey = {
      id: crypto.randomUUID(),
      key: encryptedKey,
      algorithm: "AES-256-GCM",
      createdAt: new Date(),
      status: "active",
    };

    await this.storeDataKey(dataKey);
    return dataKey;
  }

  async encryptData(data: string, keyId: string): Promise<EncryptedData> {
    const key = await this.getDecryptedKey(keyId);
    const iv = crypto.randomBytes(16);

    const cipher = crypto.createCipher("aes-256-gcm", key);
    let encrypted = cipher.update(data, "utf8", "hex");
    encrypted += cipher.final("hex");

    return {
      data: encrypted,
      iv: iv.toString("hex"),
      tag: cipher.getAuthTag().toString("hex"),
      keyId,
    };
  }
}
```

## Key Storage

### Hardware Security Module (HSM)

```typescript
class HSMKeyStore {
  async storeKey(keyId: string, key: string): Promise<void> {
    // Store in HSM
    await this.hsm.storeKey(keyId, key, {
      extractable: false, // Cannot extract key
      sensitive: true, // Sensitive key material
      token: true, // Persistent storage
    });
  }

  async getKey(keyId: string): Promise<string> {
    // Retrieve from HSM for signing/decryption
    return await this.hsm.getKey(keyId);
  }

  async destroyKey(keyId: string): Promise<void> {
    // Secure key destruction
    await this.hsm.destroyKey(keyId);
  }
}
```

### Cloud Key Management Service

```typescript
class CloudKMS {
  async storeKey(keyId: string, key: string): Promise<void> {
    await this.kms.encryptAndStore(keyId, key, {
      keyRing: "auth-keys",
      keyVersion: "latest",
      algorithm: "GOOGLE_SYMMETRIC_ENCRYPTION",
    });
  }

  async getKey(keyId: string): Promise<string> {
    return await this.kms.decrypt(keyId);
  }

  async rotateKey(keyId: string): Promise<string> {
    return await this.kms.rotateKey(keyId);
  }
}
```

## Key Rotation

### Automated Rotation

```typescript
interface RotationPolicy {
  keyType: string;
  interval: number; // days
  overlap: number; // days to keep old key
  automated: boolean;
}

class KeyRotationManager {
  private policies: RotationPolicy[] = [
    { keyType: "jwt", interval: 90, overlap: 30, automated: true },
    { keyType: "data", interval: 365, overlap: 7, automated: true },
    { keyType: "api", interval: 180, overlap: 14, automated: false },
  ];

  async rotateKeys(): Promise<RotationResult> {
    const results = [];

    for (const policy of this.policies) {
      if (policy.automated && this.shouldRotate(policy)) {
        const result = await this.performRotation(policy);
        results.push(result);
      }
    }

    return {
      rotated: results.length,
      failed: results.filter((r) => !r.success).length,
      details: results,
    };
  }

  private async performRotation(
    policy: RotationPolicy
  ): Promise<RotationResult> {
    try {
      // Generate new key
      const newKey = await this.keyGenerator.generate(policy.keyType);

      // Store new key
      await this.keyStore.store(newKey);

      // Update active key
      await this.setActiveKey(newKey.id, policy.keyType);

      // Schedule old key cleanup
      await this.scheduleCleanup(policy);

      return { keyType: policy.keyType, success: true };
    } catch (error) {
      await this.alert.rotationFailed(policy, error);
      return { keyType: policy.keyType, success: false, error };
    }
  }
}
```

### Manual Rotation Triggers

```typescript
class ManualRotation {
  async rotateOnCompromise(keyId: string, reason: string): Promise<void> {
    // Mark key as compromised
    await this.keyStore.markCompromised(keyId, reason);

    // Generate emergency key
    const emergencyKey = await this.keyGenerator.generateEmergency();

    // Immediate activation
    await this.setActiveKey(emergencyKey.id);

    // Revoke old key immediately
    await this.keyStore.revoke(keyId);

    // Alert security team
    await this.alert.keyCompromise(keyId, reason);
  }

  async rotateForCompliance(): Promise<void> {
    // PCI DSS requirement: annual key rotation
    const pciKeys = await this.keyStore.getKeysByCompliance("pci-dss");

    for (const key of pciKeys) {
      await this.rotateKey(key.id, "compliance");
    }
  }
}
```

## Key Lifecycle

### Key States

```typescript
enum KeyState {
  GENERATING = "generating",
  ACTIVE = "active",
  ROTATING = "rotating",
  DEPRECATED = "deprecated",
  COMPROMISED = "compromised",
  DESTROYED = "destroyed",
}

interface KeyMetadata {
  id: string;
  state: KeyState;
  createdAt: Date;
  activatedAt?: Date;
  rotatedAt?: Date;
  compromisedAt?: Date;
  destroyedAt?: Date;
  rotationReason?: string;
  compromiseReason?: string;
}
```

### Lifecycle Management

```typescript
class KeyLifecycleManager {
  async transitionKey(
    keyId: string,
    newState: KeyState,
    reason?: string
  ): Promise<void> {
    const current = await this.getKeyMetadata(keyId);

    // Validate transition
    if (!this.isValidTransition(current.state, newState)) {
      throw new Error(
        `Invalid state transition: ${current.state} → ${newState}`
      );
    }

    // Update metadata
    const update = {
      state: newState,
      [`${newState}At`]: new Date(),
    };

    if (reason) {
      update[`${newState}Reason`] = reason;
    }

    await this.updateKeyMetadata(keyId, update);

    // Execute state-specific actions
    await this.executeStateActions(keyId, newState);
  }

  private async executeStateActions(
    keyId: string,
    state: KeyState
  ): Promise<void> {
    switch (state) {
      case KeyState.ACTIVE:
        await this.activateKey(keyId);
        break;
      case KeyState.DEPRECATED:
        await this.deprecateKey(keyId);
        break;
      case KeyState.COMPROMISED:
        await this.handleCompromisedKey(keyId);
        break;
      case KeyState.DESTROYED:
        await this.destroyKey(keyId);
        break;
    }
  }
}
```

## Key Backup and Recovery

### Secure Backup

```typescript
class KeyBackupManager {
  async backupKeys(): Promise<BackupResult> {
    // Encrypt key material
    const keys = await this.keyStore.getAllKeys();
    const encrypted = await this.encryptKeyMaterial(keys);

    // Split into shares (Shamir's secret sharing)
    const shares = await this.splitIntoShares(encrypted, 3, 5); // 3 of 5 shares

    // Distribute to secure locations
    await this.distributeShares(shares);

    return {
      backupId: crypto.randomUUID(),
      createdAt: new Date(),
      shares: shares.length,
      threshold: 3,
    };
  }

  async recoverKeys(backupId: string, shares: string[]): Promise<void> {
    // Reconstruct key material
    const reconstructed = await this.reconstructFromShares(shares);

    // Decrypt keys
    const keys = await this.decryptKeyMaterial(reconstructed);

    // Restore to key store
    await this.keyStore.restoreKeys(keys);
  }
}
```

## Key Monitoring and Auditing

### Key Usage Monitoring

```typescript
class KeyMonitoring {
  async monitorKeyUsage(): Promise<KeyUsageReport> {
    const keys = await this.keyStore.getAllKeys();
    const usage = [];

    for (const key of keys) {
      const keyUsage = await this.collectKeyUsage(key.id);
      usage.push(keyUsage);

      // Alert on unusual usage
      if (this.isUnusualUsage(keyUsage)) {
        await this.alert.unusualKeyUsage(key.id, keyUsage);
      }
    }

    return {
      keys: usage,
      generatedAt: new Date(),
      period: "24h",
    };
  }

  private async collectKeyUsage(keyId: string): Promise<KeyUsage> {
    return {
      keyId,
      operations: await this.metrics.getKeyOperations(keyId),
      errors: await this.metrics.getKeyErrors(keyId),
      lastUsed: await this.metrics.getLastKeyUsage(keyId),
      usageRate: await this.metrics.getKeyUsageRate(keyId),
    };
  }
}
```

### Key Audit Logging

```typescript
class KeyAuditor {
  async logKeyEvent(event: KeyEvent): Promise<void> {
    await this.audit.log({
      event: "key_management",
      keyId: event.keyId,
      action: event.action,
      userId: event.userId,
      ip: event.ip,
      details: event.details,
      timestamp: new Date(),
    });
  }

  async auditKeyRotation(keyId: string): Promise<RotationAudit> {
    const history = await this.audit.getKeyHistory(keyId);
    const compliance = this.checkRotationCompliance(history);

    return {
      keyId,
      rotations: history.filter((h) => h.action === "rotate"),
      compliance: compliance,
      lastRotation: history.findLast((h) => h.action === "rotate")?.timestamp,
    };
  }
}
```

## Compliance and Standards

### FIPS 140-2 Compliance

```typescript
class FIPSCompliance {
  async validateFIPSCompliance(): Promise<FIPSValidation> {
    const validations = await Promise.all([
      this.validateKeyGeneration(),
      this.validateKeyStorage(),
      this.validateCryptographicOperations(),
      this.validateKeyDestruction(),
    ]);

    return {
      compliant: validations.every((v) => v.passed),
      validations,
      standard: "FIPS 140-2 Level 3",
      validatedAt: new Date(),
    };
  }

  private async validateKeyGeneration(): Promise<ValidationResult> {
    // Test key generation with FIPS-approved algorithms
    const testKey = await this.keyGenerator.generate("test");

    return {
      test: "key_generation",
      passed: this.isFIPSApproved(testKey.algorithm),
      details: `Generated ${testKey.algorithm} key`,
    };
  }
}
```

### Key Management Standards

- **NIST SP 800-57:** Key management guidelines
- **ISO 27001:** Information security key management
- **PCI DSS:** Key management for cardholder data
- **FIPS 140-2:** Cryptographic module validation
