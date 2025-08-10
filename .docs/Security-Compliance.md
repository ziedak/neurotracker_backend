# Security & Compliance Guide

## Overview

This document outlines the comprehensive security architecture and compliance framework for the Cart Recovery Platform. It covers zero-trust security principles, data protection, regulatory compliance (GDPR, SOC 2, PCI DSS), threat modeling, and security operations.

## Security Architecture

### Zero-Trust Principles

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Zero-Trust Architecture                        │
├─────────────────┬───────────────────┬─────────────────────────────────┤
│  Network Layer  │  Identity Layer   │     Application Layer          │
│                 │                   │                                │
│• Service Mesh   │• mTLS             │• JWT/PASETO tokens             │
│• Network Policies│• RBAC            │• Input validation              │
│• Micro-segmentation│ Certificate    │• Output sanitization           │
│• WAF Protection │  Management       │• Secrets management            │
│• DDoS Mitigation│• Identity Proxy   │• Audit logging                 │
└─────────────────┴───────────────────┴─────────────────────────────────┘
```

### Defense in Depth Strategy
1. **Perimeter Security**: WAF, DDoS protection, rate limiting
2. **Network Security**: Service mesh, network policies, TLS everywhere
3. **Identity & Access**: Multi-factor authentication, RBAC, just-in-time access
4. **Application Security**: Input validation, output encoding, secure coding
5. **Data Security**: Encryption at rest/transit, data classification, tokenization
6. **Infrastructure Security**: Container scanning, vulnerability management
7. **Monitoring & Response**: SIEM, threat detection, incident response

## Identity & Access Management

### Authentication Strategy
```typescript
// auth/authentication.service.ts
export class AuthenticationService {
  // Multi-factor authentication implementation
  async authenticateUser(credentials: LoginCredentials): Promise<AuthResult> {
    // Step 1: Validate primary credentials
    const user = await this.validateCredentials(credentials.email, credentials.password);
    if (!user) {
      await this.recordFailedAttempt(credentials.email, credentials.ip);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Step 2: Check account status and security flags
    await this.checkAccountSecurity(user, credentials.ip);

    // Step 3: Require MFA for sensitive operations
    if (this.requiresMFA(user, credentials)) {
      return {
        status: 'mfa_required',
        token: await this.generateMFAToken(user.id),
        methods: await this.getAvailableMFAMethods(user.id)
      };
    }

    // Step 4: Generate secure session
    const session = await this.createSecureSession(user, credentials);
    
    // Step 5: Record successful authentication
    await this.auditService.logAuthentication({
      userId: user.id,
      ip: credentials.ip,
      userAgent: credentials.userAgent,
      success: true,
      mfaUsed: false
    });

    return {
      status: 'authenticated',
      token: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt
    };
  }

  // Device fingerprinting for anomaly detection
  private async generateDeviceFingerprint(request: AuthRequest): Promise<string> {
    const fingerprint = createHash('sha256')
      .update(request.userAgent || '')
      .update(request.acceptLanguage || '')
      .update(request.acceptEncoding || '')
      .update(request.ip || '')
      .digest('hex');

    return fingerprint.substring(0, 32);
  }

  // Risk-based authentication
  private requiresMFA(user: User, credentials: LoginCredentials): boolean {
    // Always require MFA for admin users
    if (user.roles.includes('admin')) return true;

    // Require MFA for new devices
    if (!this.isKnownDevice(user.id, credentials.deviceFingerprint)) return true;

    // Require MFA for suspicious locations
    if (this.isSuspiciousLocation(user.id, credentials.ip)) return true;

    // Require MFA for sensitive stores
    if (user.store?.securityLevel === 'high') return true;

    return false;
  }
}
```

### Authorization Framework (RBAC)
```typescript
// auth/rbac.service.ts
export enum Permission {
  // Resource permissions
  READ_EVENTS = 'events:read',
  WRITE_EVENTS = 'events:write',
  DELETE_EVENTS = 'events:delete',
  
  // Analytics permissions
  VIEW_ANALYTICS = 'analytics:view',
  EXPORT_DATA = 'analytics:export',
  
  // User management
  MANAGE_USERS = 'users:manage',
  VIEW_USERS = 'users:view',
  
  // System administration
  ADMIN_DASHBOARD = 'admin:dashboard',
  SYSTEM_CONFIG = 'admin:config',
  SECURITY_LOGS = 'admin:security',
  
  // Store management
  MANAGE_STORE = 'store:manage',
  VIEW_STORE_STATS = 'store:stats',
  
  // API access
  API_READ = 'api:read',
  API_WRITE = 'api:write',
  API_ADMIN = 'api:admin'
}

export interface Role {
  id: string;
  name: string;
  permissions: Permission[];
  restrictions?: RoleRestriction[];
  maxSessions?: number;
  sessionTimeout?: number;
}

export interface RoleRestriction {
  type: 'ip_whitelist' | 'time_based' | 'store_scoped';
  values: string[];
}

@Injectable()
export class RBACService {
  private roles: Record<string, Role> = {
    'super_admin': {
      id: 'super_admin',
      name: 'Super Administrator',
      permissions: Object.values(Permission),
      maxSessions: 2,
      sessionTimeout: 4 * 60 * 60 // 4 hours
    },
    
    'store_admin': {
      id: 'store_admin',
      name: 'Store Administrator',
      permissions: [
        Permission.READ_EVENTS,
        Permission.WRITE_EVENTS,
        Permission.VIEW_ANALYTICS,
        Permission.EXPORT_DATA,
        Permission.MANAGE_USERS,
        Permission.VIEW_USERS,
        Permission.MANAGE_STORE,
        Permission.VIEW_STORE_STATS,
        Permission.API_READ,
        Permission.API_WRITE
      ],
      restrictions: [
        {
          type: 'store_scoped',
          values: [] // Will be populated with user's store ID
        }
      ],
      maxSessions: 3,
      sessionTimeout: 8 * 60 * 60 // 8 hours
    },
    
    'analyst': {
      id: 'analyst',
      name: 'Data Analyst',
      permissions: [
        Permission.READ_EVENTS,
        Permission.VIEW_ANALYTICS,
        Permission.EXPORT_DATA,
        Permission.VIEW_STORE_STATS,
        Permission.API_READ
      ],
      sessionTimeout: 12 * 60 * 60 // 12 hours
    },
    
    'api_user': {
      id: 'api_user',
      name: 'API User',
      permissions: [
        Permission.READ_EVENTS,
        Permission.WRITE_EVENTS,
        Permission.API_READ,
        Permission.API_WRITE
      ],
      restrictions: [
        {
          type: 'store_scoped',
          values: []
        }
      ]
    }
  };

  async hasPermission(
    userId: string, 
    permission: Permission, 
    context?: SecurityContext
  ): Promise<boolean> {
    const user = await this.userService.findById(userId);
    if (!user || !user.isActive) return false;

    // Check if user has the required permission
    const userPermissions = await this.getUserPermissions(user);
    if (!userPermissions.includes(permission)) return false;

    // Apply role restrictions
    return await this.checkRoleRestrictions(user, context);
  }

  private async checkRoleRestrictions(
    user: User, 
    context?: SecurityContext
  ): Promise<boolean> {
    const role = this.roles[user.primaryRole];
    if (!role.restrictions) return true;

    for (const restriction of role.restrictions) {
      switch (restriction.type) {
        case 'ip_whitelist':
          if (!restriction.values.includes(context?.ip || '')) {
            return false;
          }
          break;
        
        case 'time_based':
          const currentHour = new Date().getHours();
          const allowedHours = restriction.values.map(h => parseInt(h));
          if (!allowedHours.includes(currentHour)) {
            return false;
          }
          break;
          
        case 'store_scoped':
          if (context?.storeId && context.storeId !== user.storeId) {
            return false;
          }
          break;
      }
    }

    return true;
  }
}
```

## Data Protection & Encryption

### Encryption at Rest
```typescript
// encryption/data-encryption.service.ts
export class DataEncryptionService {
  private encryptionKeys: Map<string, Buffer> = new Map();

  constructor() {
    // Load encryption keys from HashiCorp Vault
    this.initializeEncryptionKeys();
  }

  // Field-level encryption for sensitive data
  async encryptSensitiveField(data: string, keyAlias: string): Promise<EncryptedField> {
    const key = this.encryptionKeys.get(keyAlias);
    if (!key) {
      throw new Error(`Encryption key not found: ${keyAlias}`);
    }

    const iv = randomBytes(16);
    const cipher = createCipher('aes-256-gcm', key);
    cipher.setIV(iv);

    const encrypted = Buffer.concat([
      cipher.update(data, 'utf8'),
      cipher.final()
    ]);

    const authTag = cipher.getAuthTag();

    return {
      encrypted: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      keyAlias,
      algorithm: 'aes-256-gcm'
    };
  }

  async decryptSensitiveField(encryptedField: EncryptedField): Promise<string> {
    const key = this.encryptionKeys.get(encryptedField.keyAlias);
    if (!key) {
      throw new Error(`Decryption key not found: ${encryptedField.keyAlias}`);
    }

    const decipher = createDecipher('aes-256-gcm', key);
    decipher.setIV(Buffer.from(encryptedField.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(encryptedField.authTag, 'base64'));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedField.encrypted, 'base64')),
      decipher.final()
    ]);

    return decrypted.toString('utf8');
  }

  // Database-level transparent encryption
  async configureTransparentDataEncryption(): Promise<void> {
    // PostgreSQL TDE configuration
    await this.database.query(`
      -- Enable transparent data encryption
      ALTER SYSTEM SET ssl = on;
      ALTER SYSTEM SET ssl_cert_file = '/var/lib/postgresql/server.crt';
      ALTER SYSTEM SET ssl_key_file = '/var/lib/postgresql/server.key';
      
      -- Configure encrypted tablespace
      CREATE TABLESPACE encrypted_data 
      LOCATION '/var/lib/postgresql/encrypted' 
      WITH (encryption_key_id = 'master-key-1');
    `);
  }
}
```

### Tokenization for PCI Compliance
```typescript
// tokenization/tokenization.service.ts
export class TokenizationService {
  private tokenVault: Map<string, TokenData> = new Map();

  // Tokenize sensitive payment data
  async tokenizePANData(cardData: CardData): Promise<TokenizedCard> {
    // Generate cryptographically secure token
    const token = this.generateSecureToken();
    
    // Store mapping in secure vault (encrypted)
    const encryptedData = await this.encryptionService.encryptSensitiveField(
      JSON.stringify(cardData),
      'card-encryption-key'
    );

    await this.storeTokenMapping(token, encryptedData);

    // Return tokenized version
    return {
      token,
      last4: cardData.number.slice(-4),
      brand: this.detectCardBrand(cardData.number),
      expiryMonth: cardData.expiryMonth,
      expiryYear: cardData.expiryYear,
      // Never store or return actual PAN
    };
  }

  async detokenize(token: string): Promise<CardData> {
    if (!this.isValidToken(token)) {
      throw new SecurityException('Invalid token format');
    }

    const encryptedData = await this.getTokenMapping(token);
    if (!encryptedData) {
      throw new NotFoundException('Token not found');
    }

    const decryptedData = await this.encryptionService.decryptSensitiveField(encryptedData);
    return JSON.parse(decryptedData);
  }

  private generateSecureToken(): string {
    // Generate format-preserving token for card numbers
    const tokenBytes = randomBytes(8);
    return `tok_${tokenBytes.toString('hex')}`;
  }

  // PCI DSS requirement: Secure token storage
  private async storeTokenMapping(token: string, encryptedData: EncryptedField): Promise<void> {
    // Store in HSM or secure key vault
    await this.vault.store(`token:${token}`, encryptedData, {
      ttl: 365 * 24 * 60 * 60, // 1 year
      accessPolicy: 'tokenization-policy'
    });
  }
}
```

## Input Validation & Output Encoding

### Comprehensive Input Validation
```typescript
// security/input-validation.service.ts
export class InputValidationService {
  
  // SQL injection prevention
  validateSQLInput(input: string): string {
    if (typeof input !== 'string') {
      throw new ValidationException('Input must be a string');
    }

    // Reject dangerous SQL patterns
    const sqlInjectionPatterns = [
      /('|(\\')|(;|\\x3b)|(union|select|insert|delete|update|drop|create|alter))/i,
      /(script|javascript|vbscript)/i,
      /(\*|%|\+|<|>|=|\|)/,
      /(exec|execute|sp_|xp_)/i
    ];

    for (const pattern of sqlInjectionPatterns) {
      if (pattern.test(input)) {
        throw new SecurityException(`Potentially malicious input detected: ${input.substring(0, 50)}`);
      }
    }

    return input.trim();
  }

  // XSS prevention
  sanitizeHTMLInput(input: string): string {
    return input
      .replace(/[<>\"'&]/g, (match) => {
        const htmlEntities: Record<string, string> = {
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#x27;',
          '&': '&amp;'
        };
        return htmlEntities[match];
      });
  }

  // Command injection prevention
  validateCommandInput(input: string): string {
    const commandInjectionPatterns = [
      /[;&|`$(){}[\]\\]/,
      /(rm|del|format|shutdown|reboot)/i,
      /(\.\.|\/)/,
      /(cmd|powershell|bash|sh)/i
    ];

    for (const pattern of commandInjectionPatterns) {
      if (pattern.test(input)) {
        throw new SecurityException(`Command injection attempt detected: ${input.substring(0, 50)}`);
      }
    }

    return input;
  }

  // Data validation schemas using Zod
  createValidationSchemas() {
    return {
      cartEvent: z.object({
        eventId: z.string().uuid(),
        storeId: z.string().uuid(),
        userId: z.string().uuid().optional(),
        sessionId: z.string().min(1).max(100),
        eventType: z.enum(['cart_created', 'item_added', 'item_removed', 'cart_abandoned']),
        timestamp: z.date(),
        data: z.record(z.any()).refine(this.validateEventData),
        metadata: z.object({
          ip: z.string().ip(),
          userAgent: z.string().max(500),
          source: z.enum(['web', 'mobile', 'api'])
        })
      }),

      userRegistration: z.object({
        email: z.string().email().max(255),
        password: z.string().min(12).max(128).refine(this.validatePasswordStrength),
        name: z.string().min(1).max(100).refine(this.sanitizeHTMLInput),
        storeId: z.string().uuid(),
        role: z.enum(['admin', 'manager', 'analyst', 'user'])
      })
    };
  }

  private validatePasswordStrength(password: string): boolean {
    // Require strong passwords
    const requirements = [
      /[a-z]/, // lowercase
      /[A-Z]/, // uppercase  
      /[0-9]/, // numbers
      /[^a-zA-Z0-9]/, // special characters
      /.{12,}/ // minimum 12 characters
    ];

    return requirements.every(req => req.test(password));
  }
}
```

### Rate Limiting & DDoS Protection
```typescript
// security/rate-limiting.service.ts
export class RateLimitingService {
  private limiters: Map<string, RateLimiter> = new Map();

  // Multi-tier rate limiting
  async checkRateLimit(identifier: string, tier: RateLimitTier): Promise<RateLimitResult> {
    const config = this.getRateLimitConfig(tier);
    const limiter = this.getLimiter(identifier, config);

    try {
      await limiter.consume(identifier, 1);
      
      return {
        allowed: true,
        remaining: limiter.remainingHits,
        resetTime: new Date(Date.now() + limiter.msBeforeNext),
        tier
      };
    } catch (rejRes) {
      // Log rate limit violation
      await this.securityLogger.logRateLimitViolation({
        identifier,
        tier,
        attempts: rejRes.remainingPoints,
        msBeforeNext: rejRes.msBeforeNext
      });

      return {
        allowed: false,
        remaining: 0,
        resetTime: new Date(Date.now() + rejRes.msBeforeNext),
        tier
      };
    }
  }

  // Rate limits configured for each Elysia service
  private getRateLimitConfig(tier: RateLimitTier): RateLimitConfig {
    const configs: Record<RateLimitTier, RateLimitConfig> = {
      'auth': { points: 5, duration: 900 }, // JWT auth via @libs/auth
      'api_gateway_read': { points: 1000, duration: 60 }, // API Gateway reads
      'api_gateway_write': { points: 100, duration: 60 }, // API Gateway writes
      'ingestion_events': { points: 10000, duration: 60 }, // Ingestion service
      'ingestion_websocket': { points: 5000, duration: 60 }, // WebSocket events
      'prediction_requests': { points: 500, duration: 60 }, // Prediction service
      'ai_engine_requests': { points: 100, duration: 60 }, // AI Engine
      'batch_upload': { points: 10, duration: 3600 }, // Batch operations
      'admin': { points: 200, duration: 60 } // Admin operations
    };

    return configs[tier];
  }

  // Adaptive rate limiting based on threat intelligence
  async getAdaptiveLimit(identifier: string, baseConfig: RateLimitConfig): Promise<RateLimitConfig> {
    const threatScore = await this.threatIntelligence.getThreatScore(identifier);
    
    if (threatScore > 0.8) {
      // High threat - reduce limits significantly
      return {
        points: Math.floor(baseConfig.points * 0.1),
        duration: baseConfig.duration * 2
      };
    } else if (threatScore > 0.5) {
      // Medium threat - moderate reduction
      return {
        points: Math.floor(baseConfig.points * 0.5),
        duration: baseConfig.duration
      };
    }

    return baseConfig;
  }
}
```

## Compliance Framework

### GDPR Compliance
```typescript
// compliance/gdpr.service.ts
export class GDPRService {
  
  // Right to be forgotten implementation
  async processForgetRequest(userId: string, requestId: string): Promise<ForgetResult> {
    try {
      // Step 1: Validate request and user consent
      const user = await this.userService.findById(userId);
      if (!user) {
        throw new NotFoundException('User not found');
      }

      // Step 2: Create audit trail
      await this.auditService.logGDPRRequest({
        userId,
        requestId,
        type: 'forget',
        timestamp: new Date(),
        ip: this.requestContext.ip,
        userAgent: this.requestContext.userAgent
      });

      // Step 3: Anonymize or delete personal data across all systems
      const deleteOperations = await Promise.allSettled([
        this.deleteUserFromPrimaryDB(userId),
        this.deleteUserFromAnalyticsDB(userId),
        this.deleteUserFromLogs(userId),
        this.deleteUserFromCache(userId),
        this.notifyDownstreamServices(userId, 'forget'),
        this.deleteBackupData(userId)
      ]);

      // Step 4: Verify deletion completeness
      const verificationResult = await this.verifyDeletionCompleteness(userId);

      // Step 5: Record completion
      await this.auditService.logGDPRCompletion({
        userId,
        requestId,
        completedAt: new Date(),
        operationsCompleted: deleteOperations.length,
        operationsFailed: deleteOperations.filter(op => op.status === 'rejected').length,
        verificationPassed: verificationResult.passed
      });

      return {
        requestId,
        status: verificationResult.passed ? 'completed' : 'partially_completed',
        completedAt: new Date(),
        operationsExecuted: deleteOperations.length,
        dataRemaining: verificationResult.remainingData
      };
    } catch (error) {
      await this.auditService.logGDPRError({
        userId,
        requestId,
        error: error.message,
        timestamp: new Date()
      });
      throw error;
    }
  }

  // Data portability - export user data
  async exportUserData(userId: string): Promise<UserDataExport> {
    const user = await this.userService.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Collect all user data from various sources
    const [
      profileData,
      eventData,
      analyticsData,
      preferencesData,
      auditData
    ] = await Promise.all([
      this.getUserProfileData(userId),
      this.getUserEventData(userId),
      this.getUserAnalyticsData(userId),
      this.getUserPreferencesData(userId),
      this.getUserAuditData(userId)
    ]);

    return {
      exportId: randomUUID(),
      userId,
      exportedAt: new Date(),
      format: 'json',
      data: {
        profile: profileData,
        events: eventData,
        analytics: analyticsData,
        preferences: preferencesData,
        auditTrail: auditData
      },
      dataClassification: await this.classifyUserData(userId),
      retentionPolicies: await this.getRetentionPolicies(userId)
    };
  }

  // Consent management
  async updateConsent(userId: string, consent: ConsentUpdate): Promise<void> {
    const currentConsent = await this.getConsentRecord(userId);
    
    const updatedConsent = {
      ...currentConsent,
      ...consent,
      updatedAt: new Date(),
      ipAddress: this.requestContext.ip,
      userAgent: this.requestContext.userAgent
    };

    // Store consent with full audit trail
    await this.storeConsentRecord(userId, updatedConsent);

    // Notify downstream services of consent changes
    await this.notifyConsentChanges(userId, consent);

    // Log consent change for compliance
    await this.auditService.logConsentChange({
      userId,
      previousConsent: currentConsent,
      newConsent: updatedConsent,
      changedFields: this.getChangedFields(currentConsent, consent)
    });
  }

  private async notifyDownstreamServices(userId: string, action: 'forget' | 'export'): Promise<void> {
    const notifications = [
      this.eventPipelineService.handleGDPRRequest(userId, action),
      this.aiEngineService.handleGDPRRequest(userId, action),
      this.interventionEngineService.handleGDPRRequest(userId, action),
      this.dataPlatformService.handleGDPRRequest(userId, action)
    ];

    await Promise.allSettled(notifications);
  }
}
```

### SOC 2 Compliance
```typescript
// compliance/soc2.service.ts
export class SOC2ComplianceService {
  
  // Security controls monitoring
  async monitorSecurityControls(): Promise<ControlStatus[]> {
    const controls = [
      await this.checkAccessControls(),
      await this.checkEncryptionControls(),
      await this.checkMonitoringControls(),
      await this.checkBackupControls(),
      await this.checkIncidentResponseControls()
    ];

    return controls;
  }

  private async checkAccessControls(): Promise<ControlStatus> {
    const checks = [
      await this.verifyMFAEnforcement(),
      await this.verifyPasswordPolicies(),
      await this.verifySessionManagement(),
      await this.verifyRoleBasedAccess(),
      await this.verifyPrivilegedAccessReview()
    ];

    return {
      controlId: 'CC6.1',
      name: 'Access Controls',
      status: checks.every(c => c.compliant) ? 'compliant' : 'non_compliant',
      checks,
      lastAssessed: new Date()
    };
  }

  private async checkEncryptionControls(): Promise<ControlStatus> {
    const checks = [
      await this.verifyDataInTransitEncryption(),
      await this.verifyDataAtRestEncryption(),
      await this.verifyKeyManagement(),
      await this.verifyCertificateManagement()
    ];

    return {
      controlId: 'CC6.7',
      name: 'Data Protection',
      status: checks.every(c => c.compliant) ? 'compliant' : 'non_compliant',
      checks,
      lastAssessed: new Date()
    };
  }

  // Audit log generation for SOC 2
  async generateAuditLog(startDate: Date, endDate: Date): Promise<SOC2AuditLog> {
    const auditEvents = await this.auditService.getEventsInRange(startDate, endDate);
    
    return {
      reportPeriod: { start: startDate, end: endDate },
      totalEvents: auditEvents.length,
      eventsByCategory: this.categorizeAuditEvents(auditEvents),
      securityEvents: auditEvents.filter(e => e.category === 'security'),
      accessEvents: auditEvents.filter(e => e.category === 'access'),
      dataEvents: auditEvents.filter(e => e.category === 'data'),
      systemEvents: auditEvents.filter(e => e.category === 'system'),
      compliance: await this.assessComplianceStatus(auditEvents)
    };
  }

  // Change management controls
  async trackSystemChanges(change: SystemChange): Promise<void> {
    // Record all system changes with approval workflow
    await this.changeManagementService.recordChange({
      changeId: randomUUID(),
      type: change.type,
      description: change.description,
      requestor: change.requestor,
      approver: change.approver,
      implementationDate: change.scheduledDate,
      riskAssessment: await this.assessChangeRisk(change),
      rollbackPlan: change.rollbackPlan,
      testingResults: change.testResults,
      businessJustification: change.justification
    });
  }
}
```

### PCI DSS Compliance
```typescript
// compliance/pci-dss.service.ts
export class PCIDSSService {
  
  // PCI DSS requirement monitoring
  async assessPCICompliance(): Promise<PCIAssessment> {
    const requirements = await Promise.all([
      this.assessRequirement1(), // Secure network architecture
      this.assessRequirement2(), // Change default passwords
      this.assessRequirement3(), // Protect stored cardholder data
      this.assessRequirement4(), // Encrypt data transmission
      this.assessRequirement5(), // Protect against malware
      this.assessRequirement6(), // Secure systems and applications
      this.assessRequirement7(), // Restrict access by business need
      this.assessRequirement8(), // Identify and authenticate access
      this.assessRequirement9(), // Restrict physical access
      this.assessRequirement10(), // Track and monitor network access
      this.assessRequirement11(), // Test security systems
      this.assessRequirement12()  // Maintain information security policy
    ]);

    return {
      assessmentDate: new Date(),
      overallStatus: requirements.every(r => r.compliant) ? 'compliant' : 'non_compliant',
      requirements,
      nextAssessment: this.calculateNextAssessmentDate(),
      certificationLevel: this.determineCertificationLevel(),
      remediationItems: requirements.filter(r => !r.compliant)
    };
  }

  // Cardholder data discovery and classification
  async discoverCardholderData(): Promise<DataInventory> {
    const locations = await Promise.all([
      this.scanDatabases(),
      this.scanFileSystems(),
      this.scanLogFiles(),
      this.scanBackups(),
      this.scanNetworkTraffic()
    ]);

    return {
      discoveryDate: new Date(),
      locations: locations.flat(),
      riskLevel: this.calculateDataRisk(locations.flat()),
      recommendations: await this.generateSecurityRecommendations(locations.flat())
    };
  }

  private async assessRequirement3(): Promise<RequirementAssessment> {
    // Protect stored cardholder data
    const checks = [
      await this.checkDataInventory(),
      await this.checkEncryptionStandards(),
      await this.checkKeyManagement(),
      await this.checkDataRetention(),
      await this.checkSecureDisposal()
    ];

    return {
      requirementId: '3',
      name: 'Protect stored cardholder data',
      compliant: checks.every(c => c.passed),
      checks,
      evidence: await this.collectComplianceEvidence('requirement_3'),
      lastAssessed: new Date()
    };
  }

  // Vulnerability scanning (Req 11.2)
  async performVulnerabilityScanning(): Promise<VulnerabilityScanResult> {
    const scanResults = await Promise.all([
      this.scanWebApplications(),
      this.scanNetworkInfrastructure(),
      this.scanDatabases(),
      this.scanOperatingSystems()
    ]);

    const allVulnerabilities = scanResults.flat();
    const criticalVulns = allVulnerabilities.filter(v => v.severity === 'critical');
    const highVulns = allVulnerabilities.filter(v => v.severity === 'high');

    return {
      scanDate: new Date(),
      totalVulnerabilities: allVulnerabilities.length,
      criticalVulnerabilities: criticalVulns.length,
      highVulnerabilities: highVulns.length,
      vulnerabilities: allVulnerabilities,
      complianceStatus: criticalVulns.length === 0 ? 'compliant' : 'non_compliant',
      remediationPlan: await this.createRemediationPlan(allVulnerabilities)
    };
  }
}
```

## Threat Detection & Response

### Security Information and Event Management (SIEM)
```typescript
// security/siem.service.ts
export class SIEMService {
  
  // Real-time threat detection
  async analyzeLogs(logEntry: LogEntry): Promise<ThreatAnalysis> {
    const threatIndicators = await Promise.all([
      this.detectSQLInjectionAttempts(logEntry),
      this.detectBruteForceAttacks(logEntry),
      this.detectAnomalousLogin(logEntry),
      this.detectDataExfiltration(logEntry),
      this.detectPrivilegeEscalation(logEntry),
      this.detectMaliciousFileUpload(logEntry)
    ]);

    const highestThreatLevel = Math.max(...threatIndicators.map(t => t.riskScore));
    
    if (highestThreatLevel > 0.8) {
      await this.triggerSecurityIncident({
        severity: 'high',
        indicators: threatIndicators.filter(t => t.riskScore > 0.5),
        logEntry,
        detectedAt: new Date()
      });
    }

    return {
      riskScore: highestThreatLevel,
      threats: threatIndicators,
      actionRequired: highestThreatLevel > 0.5,
      recommendedActions: this.getRecommendedActions(threatIndicators)
    };
  }

  // Machine learning-based anomaly detection
  async detectAnomalies(userBehavior: UserBehavior): Promise<AnomalyDetection> {
    const baseline = await this.getUserBaseline(userBehavior.userId);
    
    const anomalyScores = {
      loginTime: this.calculateTimeAnomalyScore(userBehavior.loginTime, baseline.typicalLoginTimes),
      location: this.calculateLocationAnomalyScore(userBehavior.location, baseline.typicalLocations),
      deviceFingerprint: this.calculateDeviceAnomalyScore(userBehavior.device, baseline.knownDevices),
      accessPatterns: this.calculateAccessPatternScore(userBehavior.accessPattern, baseline.typicalAccess),
      dataVolume: this.calculateVolumeAnomalyScore(userBehavior.dataAccessed, baseline.typicalVolume)
    };

    const overallScore = Object.values(anomalyScores).reduce((sum, score) => sum + score, 0) / 5;
    
    return {
      overallAnomalyScore: overallScore,
      anomalyScores,
      isAnomalous: overallScore > 0.7,
      recommendedAction: this.getAnomalyAction(overallScore),
      confidence: this.calculateConfidenceScore(anomalyScores)
    };
  }

  // Automated incident response
  async respondToIncident(incident: SecurityIncident): Promise<IncidentResponse> {
    const response: IncidentResponse = {
      incidentId: incident.id,
      startTime: new Date(),
      actions: []
    };

    // Step 1: Immediate containment
    if (incident.severity === 'critical') {
      await this.blockMaliciousIP(incident.sourceIP);
      response.actions.push({
        type: 'ip_block',
        timestamp: new Date(),
        details: `Blocked IP: ${incident.sourceIP}`
      });
    }

    // Step 2: Account security
    if (incident.type === 'compromised_account') {
      await this.suspendUserAccount(incident.userId);
      await this.invalidateUserSessions(incident.userId);
      response.actions.push({
        type: 'account_suspension',
        timestamp: new Date(),
        details: `Suspended user: ${incident.userId}`
      });
    }

    // Step 3: Data protection
    if (incident.involves_data_access) {
      await this.enableEnhancedMonitoring(incident.userId);
      await this.notifyDataProtectionOfficer(incident);
      response.actions.push({
        type: 'enhanced_monitoring',
        timestamp: new Date(),
        details: 'Enabled enhanced monitoring for affected resources'
      });
    }

    // Step 4: Evidence collection
    await this.collectForensicEvidence(incident);
    response.actions.push({
      type: 'evidence_collection',
      timestamp: new Date(),
      details: 'Forensic evidence collected and preserved'
    });

    // Step 5: Notification
    await this.notifySecurityTeam(incident, response);
    if (incident.requires_external_notification) {
      await this.notifyRegulatoryBodies(incident);
    }

    response.endTime = new Date();
    response.status = 'contained';

    return response;
  }
}
```

## Security Monitoring & Alerting

### Security Metrics & KPIs
```typescript
// monitoring/security-metrics.service.ts
export class SecurityMetricsService {
  
  async getSecurityDashboard(): Promise<SecurityDashboard> {
    const [
      threatMetrics,
      authenticationMetrics,
      vulnerabilityMetrics,
      complianceMetrics,
      incidentMetrics
    ] = await Promise.all([
      this.getThreatMetrics(),
      this.getAuthenticationMetrics(), 
      this.getVulnerabilityMetrics(),
      this.getComplianceMetrics(),
      this.getIncidentMetrics()
    ]);

    return {
      overallSecurityScore: this.calculateSecurityScore({
        threatMetrics,
        authenticationMetrics,
        vulnerabilityMetrics,
        complianceMetrics,
        incidentMetrics
      }),
      threatLevel: this.assessCurrentThreatLevel(),
      metrics: {
        threats: threatMetrics,
        authentication: authenticationMetrics,
        vulnerabilities: vulnerabilityMetrics,
        compliance: complianceMetrics,
        incidents: incidentMetrics
      },
      recommendations: await this.getSecurityRecommendations(),
      lastUpdated: new Date()
    };
  }

  private async getThreatMetrics(): Promise<ThreatMetrics> {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    return {
      threatsDetected24h: await this.countThreats(last24h, now),
      threatsBlocked24h: await this.countBlockedThreats(last24h, now),
      maliciousIPs24h: await this.countMaliciousIPs(last24h, now),
      suspiciousActivities24h: await this.countSuspiciousActivities(last24h, now),
      threatTrend7d: await this.getThreatTrend(last7d, now),
      topThreatTypes: await this.getTopThreatTypes(last24h, now),
      threatsByGeo: await this.getThreatsByGeography(last24h, now)
    };
  }

  private async getAuthenticationMetrics(): Promise<AuthenticationMetrics> {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    return {
      totalLoginAttempts24h: await this.countLoginAttempts(last24h, now),
      successfulLogins24h: await this.countSuccessfulLogins(last24h, now),
      failedLogins24h: await this.countFailedLogins(last24h, now),
      mfaUtilization: await this.getMFAUtilizationRate(),
      passwordPolicyCompliance: await this.getPasswordPolicyCompliance(),
      suspiciousLogins24h: await this.countSuspiciousLogins(last24h, now),
      accountLockouts24h: await this.countAccountLockouts(last24h, now),
      sessionAnomalies24h: await this.countSessionAnomalies(last24h, now)
    };
  }
}
```

### Security Automation
```yaml
# security/security-automation.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: security-automation-rules
data:
  rules.yaml: |
    # Automated response rules
    rules:
      - name: "Block Malicious IP"
        trigger:
          type: "threat_detected"
          severity: "high"
          threat_type: "brute_force"
        conditions:
          - failed_attempts > 10
          - time_window < "5m"
        actions:
          - type: "ip_block"
            duration: "1h"
          - type: "alert"
            channel: "security-team"
            
      - name: "Suspend Compromised Account"
        trigger:
          type: "anomaly_detected"
          anomaly_score: > 0.9
        conditions:
          - login_from_new_country: true
          - multiple_devices_simultaneous: true
        actions:
          - type: "account_suspension"
            duration: "24h"
          - type: "force_password_reset"
          - type: "notify_user"
            channel: "email"
            
      - name: "Enhanced Monitoring"
        trigger:
          type: "privilege_escalation"
        actions:
          - type: "enable_audit_logging"
            target: "user_account"
          - type: "monitor_file_access"
            duration: "7d"
          - type: "alert"
            severity: "critical"
```

This comprehensive security and compliance framework provides multiple layers of protection while ensuring regulatory compliance and enabling rapid threat detection and response capabilities for the Cart Recovery Platform.