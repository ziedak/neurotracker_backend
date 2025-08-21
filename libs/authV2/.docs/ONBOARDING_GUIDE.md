# AuthV2 Enterprise Onboarding Guide

## Welcome to AuthV2 Enterprise Authentication

This guide will walk you through setting up and using the AuthV2 enterprise authentication system in your application. Follow the steps below for a smooth onboarding experience.

## 📋 Prerequisites

Before you begin, ensure you have:

- Node.js 18+ installed
- TypeScript 4.8+ configured
- Access to PostgreSQL database
- Redis instance (for caching)
- Basic understanding of dependency injection

## 🚀 Quick Start (5 minutes)

### Step 1: Install Dependencies

```bash
# Navigate to your project
cd /path/to/your/project

# Install AuthV2 and required dependencies
npm install @libs/authV2 @libs/database @libs/config

# Or with pnpm
pnpm add @libs/authV2 @libs/database @libs/config
```

### Step 2: Basic Configuration

Create a configuration file:

```typescript
// auth.config.ts
import { IAuthenticationServiceConfig } from "@libs/authV2";

export const authConfig: IAuthenticationServiceConfig = {
  validation: {
    strictMode: false, // Start with relaxed validation
    passwordComplexity: true,
  },
  cache: {
    enabled: true,
    authenticationResultTTL: 300,
  },
  audit: {
    enabled: true,
    detailedLogging: false, // Enable later for production
  },
};
```

### Step 3: Initialize Services

```typescript
// app.ts
import { Container } from "@libs/config";
import { AuthenticationServiceV2 } from "@libs/authV2";

const container = Container.getInstance();

// Get authentication service (automatically configured)
const authService = container.get<AuthenticationServiceV2>(
  "AuthenticationServiceV2"
);

// Test authentication
async function testAuth() {
  const result = await authService.authenticate({
    email: "test@example.com",
    password: "testPassword123",
  });

  console.log("Authentication result:", result);
}

testAuth();
```

### Step 4: First Authentication

```typescript
// login.example.ts
async function performLogin() {
  try {
    const result = await authService.authenticate({
      email: "user@yourcompany.com",
      password: "userPassword123",
    });

    if (result.success) {
      console.log("✅ Login successful!");
      console.log("User:", result.user?.email);
      console.log("Session ID:", result.session?.id);
    } else {
      console.log("❌ Login failed:", result.errors);
    }
  } catch (error) {
    console.error("Login error:", error);
  }
}
```

**🎉 Congratulations! You now have basic authentication working.**

## 📚 Learning Path

### Phase 1: Basic Authentication (Day 1)

- [x] ✅ Install and configure AuthV2
- [ ] 🔄 Implement password-based authentication
- [ ] 🔄 Add basic error handling
- [ ] 🔄 Test with your existing users

**Expected time: 2-4 hours**

### Phase 2: Session Management (Day 1-2)

- [ ] 📖 Learn session lifecycle management
- [ ] 🔄 Implement logout functionality
- [ ] 🔄 Add session validation
- [ ] 🔄 Handle session expiration

**Expected time: 3-5 hours**

### Phase 3: Enhanced Security (Day 2-3)

- [ ] 📖 Understand enhanced models
- [ ] 🔄 Implement secure authentication
- [ ] 🔄 Add input validation
- [ ] 🔄 Configure security levels

**Expected time: 4-6 hours**

### Phase 4: Multi-Tenant Features (Day 3-4)

- [ ] 📖 Learn multi-tenancy concepts
- [ ] 🔄 Implement tenant validation
- [ ] 🔄 Add store/organization context
- [ ] 🔄 Test tenant boundaries

**Expected time: 5-8 hours**

### Phase 5: Production Ready (Day 4-5)

- [ ] 📖 Configure monitoring and audit
- [ ] 🔄 Implement comprehensive error handling
- [ ] 🔄 Add rate limiting
- [ ] 🔄 Performance optimization

**Expected time: 4-6 hours**

## 🎯 Guided Tutorials

### Tutorial 1: Basic Authentication Setup

#### Objective

Implement basic email/password authentication in your existing application.

#### Prerequisites

- Existing user database
- Basic Express.js or similar web framework

#### Steps

1. **Install and Configure**

```bash
npm install @libs/authV2
```

2. **Create Auth Route**

```typescript
// routes/auth.ts
import { Router } from "express";
import { AuthenticationServiceV2 } from "@libs/authV2";

const router = Router();
const authService = container.get<AuthenticationServiceV2>(
  "AuthenticationServiceV2"
);

router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await authService.authenticate({ email, password });

    if (result.success) {
      // Store session in request/response
      req.session.userId = result.user?.id;
      req.session.sessionId = result.session?.id;

      res.json({
        success: true,
        user: {
          id: result.user?.id,
          email: result.user?.email,
          name: result.user?.name,
        },
        accessToken: result.accessToken,
      });
    } else {
      res.status(401).json({
        success: false,
        message: "Authentication failed",
        errors: result.errors,
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

export default router;
```

3. **Add Middleware**

```typescript
// middleware/auth.ts
import { AuthenticationServiceV2 } from "@libs/authV2";

export async function authenticateMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const sessionId = req.session?.sessionId;

  if (!sessionId) {
    return res.status(401).json({ message: "No session found" });
  }

  try {
    const context = await authService.getContextBySession(sessionId);

    if (!context) {
      return res.status(401).json({ message: "Invalid session" });
    }

    req.user = context;
    next();
  } catch (error) {
    res.status(500).json({ message: "Authentication error" });
  }
}
```

4. **Test Your Implementation**

```bash
# Test login
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'

# Test protected route
curl -X GET http://localhost:3000/api/protected \
  -H "Cookie: sessionId=your_session_id"
```

### Tutorial 2: Multi-Tenant Implementation

#### Objective

Add multi-tenant authentication for stores or organizations.

#### Prerequisites

- Completed Tutorial 1
- Understanding of your tenant structure (stores, organizations, etc.)

#### Steps

1. **Update User Model**

```typescript
// Ensure your users have tenant associations
interface UserWithTenant {
  id: string;
  email: string;
  storeId?: string; // For store-based tenancy
  organizationId?: string; // For org-based tenancy
}
```

2. **Implement Tenant Authentication**

```typescript
// routes/tenant-auth.ts
router.post("/login/:tenantId", async (req, res) => {
  const { email, password } = req.body;
  const { tenantId } = req.params;

  try {
    // Use tenant-aware authentication
    const result = await authService.authenticateWithTenantContext(
      { email, password },
      tenantId
    );

    if (result.success && result.metadata?.tenantValidated) {
      res.json({
        success: true,
        user: result.user,
        tenantId: tenantId,
        permissions: result.permissions,
      });
    } else {
      res.status(403).json({
        success: false,
        message: "Tenant access denied",
        error: result.metadata?.error,
      });
    }
  } catch (error) {
    res.status(500).json({ message: "Authentication error" });
  }
});
```

3. **Add Tenant Validation Middleware**

```typescript
// middleware/tenant.ts
export function validateTenant(requiredTenantId?: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userContext = req.user; // From auth middleware
    const tenantId = requiredTenantId || req.params.tenantId;

    if (!tenantId) {
      return res.status(400).json({ message: "Tenant ID required" });
    }

    try {
      const hasAccess = await authService.validateTenantContext(
        userContext,
        tenantId
      );

      if (!hasAccess) {
        return res.status(403).json({ message: "Tenant access denied" });
      }

      req.tenantId = tenantId;
      next();
    } catch (error) {
      res.status(500).json({ message: "Tenant validation error" });
    }
  };
}
```

### Tutorial 3: Enhanced Security Implementation

#### Objective

Implement enhanced security features with validation and audit logging.

#### Prerequisites

- Completed Tutorials 1 and 2
- Production or staging environment

#### Steps

1. **Configure Enhanced Security**

```typescript
// config/security.ts
export const enhancedSecurityConfig = {
  validation: {
    strictMode: true,
    passwordComplexity: true,
    deviceValidation: true,
  },
  rateLimit: {
    enabled: true,
    maxAttempts: 5,
    windowMs: 900000, // 15 minutes
    progressivePenalty: true,
  },
  audit: {
    enabled: true,
    detailedLogging: true,
  },
  metrics: {
    enabled: true,
    responseTimeTracking: true,
  },
};
```

2. **Implement Secure Authentication Route**

```typescript
// routes/secure-auth.ts
router.post("/secure-login", async (req, res) => {
  const { email, password, tenantId } = req.body;

  try {
    const result = await authService.authenticateSecure(
      { email, password },
      {
        validateInput: true,
        securityLevel: "enhanced",
        tenantId: tenantId,
      }
    );

    if (result.success) {
      // Log successful authentication
      logger.info("Secure authentication successful", {
        userId: result.user?.id,
        email: result.user?.email,
        tenantId: tenantId,
        securityLevel: result.metadata?.securityLevel,
        timestamp: new Date().toISOString(),
      });

      res.json({
        success: true,
        user: result.user,
        security: {
          level: result.metadata?.securityLevel,
          validated: result.metadata?.inputValidated,
          enhanced: result.metadata?.enhancedSecurity,
        },
      });
    } else {
      // Log failed authentication
      logger.warn("Secure authentication failed", {
        email: email,
        tenantId: tenantId,
        errors: result.errors,
        validationErrors: result.metadata?.validationErrors,
        timestamp: new Date().toISOString(),
      });

      res.status(401).json({
        success: false,
        message: "Authentication failed",
        errors: result.errors,
      });
    }
  } catch (error) {
    logger.error("Secure authentication error", error);
    res.status(500).json({ message: "Authentication service error" });
  }
});
```

## 🔧 Configuration Recipes

### Development Environment

```typescript
// config/development.ts
export const devConfig = {
  validation: {
    strictMode: false, // Relaxed for development
    passwordComplexity: false,
  },
  rateLimit: {
    enabled: false, // Disabled for development
  },
  cache: {
    enabled: true,
    authenticationResultTTL: 60,
  },
  audit: {
    enabled: true,
    detailedLogging: false, // Less verbose
  },
};
```

### Staging Environment

```typescript
// config/staging.ts
export const stagingConfig = {
  validation: {
    strictMode: true,
    passwordComplexity: true,
  },
  rateLimit: {
    enabled: true,
    maxAttempts: 10, // More lenient than production
    windowMs: 600000, // 10 minutes
  },
  cache: {
    enabled: true,
    authenticationResultTTL: 300,
  },
  audit: {
    enabled: true,
    detailedLogging: true, // Full logging for testing
  },
};
```

### Production Environment

```typescript
// config/production.ts
export const productionConfig = {
  validation: {
    strictMode: true,
    passwordComplexity: true,
    deviceValidation: true,
  },
  rateLimit: {
    enabled: true,
    maxAttempts: 3, // Strict rate limiting
    windowMs: 1800000, // 30 minutes
    progressivePenalty: true,
  },
  cache: {
    enabled: true,
    authenticationResultTTL: 300,
    validationResultTTL: 60,
  },
  audit: {
    enabled: true,
    detailedLogging: true,
  },
  metrics: {
    enabled: true,
    responseTimeTracking: true,
  },
  security: {
    sessionTimeout: 3600000, // 1 hour
    tokenRefreshThreshold: 300000,
  },
};
```

## 🚨 Common Issues & Solutions

### Issue 1: "Authentication service not found"

**Problem**: Dependency injection not properly configured.

**Solution**:

```typescript
// Ensure services are properly registered
import { configureAuthServices } from "./config/auth";

const container = Container.getInstance();
configureAuthServices(container);

// Or manually bind if needed
container
  .bind<AuthenticationServiceV2>("AuthenticationServiceV2")
  .to(AuthenticationServiceV2)
  .inSingletonScope();
```

### Issue 2: "Redis connection failed"

**Problem**: Redis cache service cannot connect.

**Solution**:

```typescript
// Check Redis configuration
import { RedisClient } from "@libs/database";

// Test Redis connection
try {
  const redis = new RedisClient(redisConfig);
  await redis.ping();
  console.log("Redis connected successfully");
} catch (error) {
  console.error("Redis connection failed:", error);
}

// Fallback configuration
const cacheConfig = {
  enabled: true,
  fallbackToMemory: true, // Use memory cache if Redis fails
};
```

### Issue 3: "Enhanced user validation failed"

**Problem**: User object doesn't match enhanced model structure.

**Solution**:

```typescript
import { EnhancedTypeGuards, ModelTransformers } from "@libs/authV2";

// Check if user is already enhanced
if (!EnhancedTypeGuards.isEnhancedUser(user)) {
  // Transform basic user to enhanced user
  const enhancedUser = ModelTransformers.transformToEnhancedUser(user);
  console.log("User transformed to enhanced model");
}
```

### Issue 4: "Tenant validation always fails"

**Problem**: User tenant associations not properly configured.

**Solution**:

```typescript
// Ensure user has proper tenant associations
const user = await userService.findById(userId);

// Check tenant associations
if (tenantType === "store") {
  console.log("User store ID:", user.storeId);
} else if (tenantType === "organization") {
  console.log("User org ID:", user.organizationId);
}

// Debug tenant validation
const tenantContext = await authService.validateTenantContext(
  userContext,
  tenantId
);
console.log("Tenant validation result:", tenantContext);
```

## 📞 Support & Resources

### Documentation

- 📚 [Complete Usage Guide](./COMPLETE_USAGE_GUIDE.md)
- 🔧 [API Reference](./api-reference.md)
- 💡 [Phase 4 Usage Examples](./phase4-usage-examples.ts)

### Community

- 💬 Internal Slack: `#auth-support`
- 📧 Email: `auth-team@yourcompany.com`
- 🐛 Issues: GitHub Issues

### Training Sessions

- 🎓 Weekly office hours: Fridays 2-3 PM
- 📹 Recorded tutorials: Company knowledge base
- 🏆 Certification program: Contact training team

## 🎯 Success Checklist

### Basic Implementation ✅

- [ ] Authentication service initialized
- [ ] Basic login/logout working
- [ ] Session management implemented
- [ ] Error handling in place
- [ ] Basic testing complete

### Enhanced Security ✅

- [ ] Input validation enabled
- [ ] Rate limiting configured
- [ ] Audit logging operational
- [ ] Security levels implemented
- [ ] Monitoring dashboards setup

### Multi-Tenant Ready ✅

- [ ] Tenant context validation working
- [ ] Tenant-specific authentication
- [ ] Boundary enforcement tested
- [ ] Multi-tenant middleware deployed
- [ ] Tenant analytics available

### Production Ready ✅

- [ ] Performance optimization complete
- [ ] Comprehensive error handling
- [ ] Health checks implemented
- [ ] Monitoring and alerting setup
- [ ] Documentation complete
- [ ] Team training conducted

## 🚀 Next Steps

Once you've completed the onboarding:

1. **Review Security Settings** - Ensure your configuration matches your security requirements
2. **Performance Testing** - Conduct load testing with your expected user volume
3. **Monitor and Optimize** - Use built-in metrics to optimize performance
4. **Advanced Features** - Explore API keys, JWT tokens, and advanced session management
5. **Custom Extensions** - Consider custom validators, audit handlers, or cache strategies

---

**Welcome to AuthV2! You're now ready to build secure, enterprise-grade authentication systems.** 🎉

For additional support, refer to our comprehensive documentation or reach out to the AuthV2 team.
