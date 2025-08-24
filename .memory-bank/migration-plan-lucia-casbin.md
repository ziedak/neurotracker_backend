# AuthV2 → Lucia v3 + Casbin Migration Plan

## Executive Summary

Migrate from custom AuthV2 implementation to proven enterprise libraries:

- **Lucia v3**: Battle-tested authentication with TypeScript-first design
- **Casbin**: Enterprise RBAC with 50+ supported authorization models
- **Bottleneck + Redis**: Distributed rate limiting and performance management
- **Timeline**: 4-6 weeks
- **Risk**: Low-Medium (proven libraries, established patterns)

## Phase 1: Foundation Migration (Weeks 1-2)

### Lucia v3 Integration

```typescript
// Replace AuthV2 with Lucia v3
import { lucia } from "lucia";
import { PrismaAdapter } from "@lucia-auth/adapter-prisma";

const auth = lucia({
  adapter: new PrismaAdapter(prisma.session, prisma.user),
  sessionCookie: {
    attributes: {
      secure: process.env.NODE_ENV === "production",
    },
  },
  getUserAttributes: (attributes) => {
    return {
      username: attributes.username,
      email: attributes.email,
      emailVerified: attributes.emailVerified,
    };
  },
});
```

### Database Schema Updates

```sql
-- Lucia v3 requires specific schema structure
ALTER TABLE users ADD COLUMN IF NOT EXISTS lucia_id VARCHAR(15) UNIQUE;
ALTER TABLE sessions RENAME TO user_sessions;
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;
```

### Migration Tasks

- [ ] Install Lucia v3 dependencies
- [ ] Update Prisma schema for Lucia compatibility
- [ ] Migrate user authentication endpoints
- [ ] Update session management logic
- [ ] Preserve existing password hashing (Argon2id)
- [ ] Test authentication flows

## Phase 2: RBAC Migration (Weeks 2-3)

### Casbin Integration

```typescript
// Replace custom RBAC with Casbin
import { newEnforcer } from "casbin";
import { PrismaAdapter } from "casbin-prisma-adapter";

const rbacEnforcer = await newEnforcer(
  "rbac_with_domains_model.conf",
  new PrismaAdapter(prisma)
);

// Define policies
await rbacEnforcer.addPolicy("admin", "user", "read");
await rbacEnforcer.addPolicy("admin", "user", "write");
await rbacEnforcer.addRoleForUser("john", "admin", "tenant1");
```

### Permission Model Configuration

```ini
# rbac_with_domains_model.conf
[request_definition]
r = sub, dom, obj, act

[policy_definition]
p = sub, dom, obj, act

[role_definition]
g = _, _, _

[policy_effect]
e = some(where (p.eft == allow))

[matchers]
m = g(r.sub, p.sub, r.dom) && r.dom == p.dom && r.obj == p.obj && r.act == p.act
```

### Migration Tasks

- [ ] Design Casbin permission model
- [ ] Migrate existing roles and permissions
- [ ] Update authorization middleware
- [ ] Implement domain-based permissions (multi-tenancy)
- [ ] Test permission enforcement

## Phase 3: Rate Limiting Migration (Weeks 3-4)

### Leverage Existing @libs/middleware Rate Limiting ✅

```typescript
// Your existing enterprise-grade rate limiting (KEEP THIS!)
import { RateLimitMiddleware } from "@libs/middleware";

// Authentication rate limiter using your existing system
const authRateLimit = RateLimitMiddleware.create("strict", {
  maxRequests: 10,
  windowMs: 60000, // 1 minute
  keyStrategy: "user", // or "ip"
  message: "Too many authentication attempts",
});

// API rate limiter with your flexible configuration
const apiRateLimit = RateLimitMiddleware.create("api", {
  maxRequests: 1000,
  windowMs: 60000,
  keyStrategy: "apiKey",
  skipSuccessfulRequests: true,
});
```

### Elysia.js Integration (Your Current Pattern)

```typescript
// Your existing Elysia integration pattern
app.use(
  authRateLimit.elysia({
    keyStrategy: "user",
    maxRequests: 5,
    windowMs: 900000, // 15 minutes for auth attempts
  })
);

// WebSocket rate limiting (already implemented!)
import { WebSocketRateLimitMiddleware } from "@libs/middleware";
const wsRateLimit = new WebSocketRateLimitMiddleware(config, logger);
```

### Migration Tasks (Simplified!)

- [x] ~~Install rate limiting dependencies~~ **ALREADY DONE**
- [x] ~~Configure Redis connection~~ **ALREADY WORKING**
- [x] ~~Implement distributed rate limiting~~ **ALREADY IMPLEMENTED**
- [ ] Integrate existing RateLimitMiddleware with Lucia v3 auth flows
- [ ] Configure rate limiting policies for different auth endpoints
- [ ] Test rate limiting effectiveness with new auth system

## Phase 4: Integration & Testing (Weeks 4-6)

### Service Integration

```typescript
// Unified authentication service
export class LuciaAuthService {
  constructor(
    private lucia: Lucia,
    private casbin: Enforcer,
    private rateLimiter: RateLimitService
  ) {}

  async authenticate(credentials: LoginCredentials): Promise<AuthResult> {
    // Rate limiting
    await this.rateLimiter.checkLimit(credentials.ip, "auth");

    // Authentication with Lucia
    const session = await this.lucia.createSession(userId, {});

    // Authorization check with Casbin
    const allowed = await this.casbin.enforce(
      session.userId,
      "default",
      "user",
      "read"
    );

    return { session, permissions: allowed ? ["user:read"] : [] };
  }
}
```

### Testing Strategy

```typescript
// Integration test example
describe("Lucia + Casbin Integration", () => {
  it("should authenticate and authorize user correctly", async () => {
    const user = await createTestUser();
    await casbin.addRoleForUser(user.id, "admin", "tenant1");

    const result = await authService.authenticate({
      email: user.email,
      password: "test123",
      ip: "127.0.0.1",
    });

    expect(result.session).toBeDefined();
    expect(result.permissions).toContain("user:read");
  });
});
```

### Migration Tasks

- [ ] Create unified authentication service
- [ ] Implement middleware integration
- [ ] Write comprehensive integration tests
- [ ] Performance testing and optimization
- [ ] Security audit and penetration testing
- [ ] Documentation and deployment guides

## Migration Benefits

### Technical Benefits

- **Reduced Maintenance**: 80% less custom authentication code to maintain
- **Battle-Tested Security**: Libraries used by thousands of production apps
- **Community Support**: Active communities, regular security updates
- **TypeScript Native**: Full type safety throughout the stack
- **Performance**: Optimized for high-throughput scenarios

### Business Benefits

- **Faster Development**: Focus on business logic, not auth infrastructure
- **Lower Risk**: Proven libraries with established security practices
- **Scalability**: Built-in support for distributed systems
- **Compliance**: Easier to achieve SOC2/GDPR compliance
- **Team Velocity**: Easier for new developers to understand and contribute

## Risk Mitigation

### Technical Risks

- **Database Migration**: Careful schema migration with rollback plans
- **Session Migration**: Graceful transition of existing user sessions
- **Permission Migration**: Preserve existing role assignments
- **API Compatibility**: Maintain backward compatibility during transition

### Mitigation Strategies

- [ ] Feature flags for gradual rollout
- [ ] Parallel testing environments
- [ ] Comprehensive backup and rollback procedures
- [ ] Staged deployment (dev → staging → production)
- [ ] User communication plan for any breaking changes

## Success Metrics

### Technical Metrics

- **Authentication Response Time**: < 100ms (currently 200ms+)
- **Rate Limiting Accuracy**: 99.9% correct enforcement
- **Session Management**: Zero session inconsistencies
- **Error Rate**: < 0.1% authentication failures

### Operational Metrics

- **Development Velocity**: 50% reduction in auth-related development time
- **Bug Rate**: 70% reduction in authentication-related issues
- **Maintenance Overhead**: 80% reduction in custom code maintenance
- **Security Incidents**: Zero authentication-related security issues

## Timeline Summary

| Week | Focus                    | Deliverables                  |
| ---- | ------------------------ | ----------------------------- |
| 1-2  | Lucia v3 Integration     | User auth, session management |
| 2-3  | Casbin RBAC              | Role-based permissions        |
| 3-4  | Bottleneck Rate Limiting | Distributed rate limiting     |
| 4-6  | Integration & Testing    | Production-ready system       |

## Conclusion

Migration to Lucia v3 + Casbin represents a strategic shift from custom authentication infrastructure to proven enterprise libraries. This approach:

1. **Reduces Technical Debt**: Eliminates 80% of custom authentication code
2. **Improves Security Posture**: Leverages battle-tested libraries
3. **Increases Development Velocity**: Teams focus on business logic
4. **Enhances Operational Reliability**: Built-in distributed systems support

**Recommendation**: Proceed with migration plan, focusing on gradual rollout and comprehensive testing.
