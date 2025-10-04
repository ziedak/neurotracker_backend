# Security Controls

Implemented security controls and countermeasures that protect against identified threats.

## Access Control

### Authentication Controls

#### Multi-Factor Authentication (MFA)

```typescript
interface MFAConfig {
  required: boolean;
  methods: MFAMethod[];
  gracePeriod: number; // minutes
  maxAttempts: number;
}

const mfaConfig: MFAConfig = {
  required: true,
  methods: ["totp", "sms", "push"],
  gracePeriod: 7 * 24 * 60, // 7 days
  maxAttempts: 3,
};
```

**Features:**

- TOTP (Time-based One-Time Password)
- SMS verification
- Push notifications
- Hardware security keys (WebAuthn)
- Backup codes

#### Account Lockout

```typescript
interface LockoutConfig {
  maxAttempts: number;
  lockoutDuration: number; // minutes
  progressiveDelay: boolean;
  resetAfter: number; // minutes
}

const lockoutConfig: LockoutConfig = {
  maxAttempts: 5,
  lockoutDuration: 30,
  progressiveDelay: true,
  resetAfter: 60,
};
```

**Progressive Delay:**

- 1st failure: No delay
- 2nd failure: 5 seconds
- 3rd failure: 15 seconds
- 4th failure: 45 seconds
- 5th failure: Account lockout

### Authorization Controls

#### Role-Based Access Control (RBAC)

```typescript
interface RoleDefinition {
  name: string;
  permissions: string[];
  inherits?: string[]; // Parent roles
  constraints?: RoleConstraint[];
}

const adminRole: RoleDefinition = {
  name: "admin",
  permissions: ["*"],
  constraints: [
    {
      type: "time",
      value: "09:00-17:00",
    },
  ],
};
```

#### Attribute-Based Access Control (ABAC)

```typescript
interface ABACPolicy {
  name: string;
  conditions: PolicyCondition[];
  effect: "allow" | "deny";
}

const dataAccessPolicy: ABACPolicy = {
  name: "data_access",
  conditions: [
    {
      attribute: "resource.owner",
      operator: "equals",
      value: "user.id",
    },
    {
      attribute: "time.hour",
      operator: "between",
      value: [9, 17],
    },
  ],
  effect: "allow",
};
```

## Input Validation

### Schema Validation

```typescript
import { z } from "zod";

const loginSchema = z.object({
  username: z.string().min(3).max(50).email(),
  password: z
    .string()
    .min(8)
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/),
  rememberMe: z.boolean().optional(),
});

const userSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  role: z.enum(["user", "admin", "moderator"]),
});
```

### Sanitization

```typescript
function sanitizeInput(input: string): string {
  return input
    .replace(/[<>]/g, "") // Remove potential HTML tags
    .replace(/javascript:/gi, "") // Remove JS protocol
    .replace(/on\w+=/gi, "") // Remove event handlers
    .trim();
}
```

## Cryptography

### Token Security

```typescript
interface TokenSecurity {
  algorithm: "RS256" | "ES256";
  keyRotation: number; // hours
  maxAge: number; // seconds
  issuer: string;
  audience: string[];
}

const tokenSecurity: TokenSecurity = {
  algorithm: "RS256",
  keyRotation: 24 * 7, // Weekly rotation
  maxAge: 15 * 60, // 15 minutes
  issuer: "auth-service",
  audience: ["api-gateway", "user-service"],
};
```

### Data Encryption

```typescript
interface EncryptionConfig {
  algorithm: "AES-256-GCM";
  keySize: 256;
  keyRotation: number; // days
  masterKey: string;
}

class DataEncryptor {
  async encrypt(data: string): Promise<EncryptedData> {
    const key = await this.getCurrentKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher("aes-256-gcm", key);

    let encrypted = cipher.update(data, "utf8", "hex");
    encrypted += cipher.final("hex");

    return {
      data: encrypted,
      iv: iv.toString("hex"),
      tag: cipher.getAuthTag().toString("hex"),
      keyId: this.currentKeyId,
    };
  }
}
```

## Network Security

### Rate Limiting

```typescript
interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  strategy: "fixed" | "sliding" | "token-bucket";
  blockDuration?: number;
}

const apiRateLimit: RateLimitConfig = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 100,
  strategy: "sliding",
  blockDuration: 60 * 1000, // 1 minute block
};
```

### CORS Configuration

```typescript
const corsConfig = {
  origin: (origin: string) => {
    const allowedOrigins = [
      "https://app.example.com",
      "https://admin.example.com",
    ];
    return allowedOrigins.includes(origin);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Authorization", "Content-Type"],
  maxAge: 86400, // 24 hours
};
```

## Session Security

### Session Configuration

```typescript
interface SessionConfig {
  name: string;
  secret: string;
  resave: boolean;
  saveUninitialized: boolean;
  cookie: {
    secure: boolean;
    httpOnly: boolean;
    maxAge: number;
    sameSite: "strict" | "lax";
  };
  rolling: boolean;
  ttl: number;
}

const sessionConfig: SessionConfig = {
  name: "sessionId",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: "strict",
  },
  rolling: true,
  ttl: 24 * 60 * 60, // 24 hours
};
```

### Session Management

```typescript
class SessionManager {
  async createSession(userId: string, data: any): Promise<string> {
    const sessionId = crypto.randomUUID();
    const session = {
      id: sessionId,
      userId,
      data,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    };

    await this.store.set(`session:${sessionId}`, session, {
      ttl: 24 * 60 * 60,
    });

    return sessionId;
  }

  async destroySession(sessionId: string): Promise<void> {
    await this.store.del(`session:${sessionId}`);
  }
}
```

## Audit Logging

### Audit Event Structure

```typescript
interface AuditEvent {
  id: string;
  timestamp: Date;
  eventType: string;
  userId?: string;
  sessionId?: string;
  ip: string;
  userAgent: string;
  resource?: string;
  action: string;
  result: "success" | "failure";
  details?: any;
  severity: "low" | "medium" | "high" | "critical";
}

class AuditLogger {
  async logEvent(event: AuditEvent): Promise<void> {
    // Structured logging with integrity protection
    const logEntry = {
      ...event,
      hash: this.generateHash(event),
    };

    await this.storage.append(logEntry);
  }
}
```

## Monitoring & Alerting

### Security Monitoring

```typescript
interface SecurityMonitor {
  thresholds: {
    failedLoginsPerMinute: number;
    suspiciousIPsThreshold: number;
    tokenTheftIndicators: string[];
  };

  async monitor(): Promise<void> {
    const metrics = await this.collectMetrics();

    if (metrics.failedLogins > this.thresholds.failedLoginsPerMinute) {
      await this.alert('High failed login rate detected');
    }

    if (metrics.suspiciousIPs > this.thresholds.suspiciousIPsThreshold) {
      await this.alert('Suspicious IP activity detected');
    }
  }
}
```

### Automated Response

```typescript
class AutomatedResponse {
  async handleThreat(threat: DetectedThreat): Promise<void> {
    switch (threat.type) {
      case "brute_force":
        await this.blockIP(threat.ip, 3600); // 1 hour
        break;
      case "token_theft":
        await this.revokeUserTokens(threat.userId);
        break;
      case "suspicious_activity":
        await this.requireMFA(threat.userId);
        break;
    }
  }
}
```

## Compliance Controls

### Data Protection

```typescript
class DataProtection {
  async anonymizeData(data: any): Promise<any> {
    // GDPR compliance - data anonymization
    return {
      ...data,
      email: this.hashEmail(data.email),
      ip: this.maskIP(data.ip),
      personalData: undefined, // Remove PII
    };
  }

  async handleDataSubjectRequest(userId: string): Promise<DataSubjectResponse> {
    // GDPR - right to access/modify/delete
    const userData = await this.getUserData(userId);
    const auditTrail = await this.getAuditTrail(userId);

    return {
      data: userData,
      audit: auditTrail,
      processedAt: new Date(),
    };
  }
}
```

## Security Headers

### HTTP Security Headers

```typescript
const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Content-Security-Policy": "default-src 'self'",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), microphone=()",
};
```

## Backup & Recovery

### Secure Backup

```typescript
interface BackupConfig {
  schedule: string; // cron expression
  retention: number; // days
  encryption: boolean;
  integrityCheck: boolean;
}

class BackupManager {
  async createBackup(): Promise<BackupResult> {
    const data = await this.exportData();
    const encrypted = await this.encryptData(data);
    const hash = this.generateIntegrityHash(encrypted);

    await this.storeBackup(encrypted, hash);

    return { success: true, size: encrypted.length, hash };
  }
}
```
