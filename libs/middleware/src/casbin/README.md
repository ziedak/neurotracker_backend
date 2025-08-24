# Casbin Authorization Middleware

Production-grade Casbin middleware for role-based and permission-based authorization, integrated with Lucia auth and existing database schema.

## Features

- ✅ **Database Integration**: Works with existing Prisma schema (Role, RolePermission models)
- ✅ **Lucia Auth Compatible**: Seamless integration with modern Lucia authentication
- ✅ **Redis Caching**: High-performance caching with configurable TTL
- ✅ **Role Hierarchy**: Support for role inheritance and nested permissions
- ✅ **Multi-tenancy**: Tenant-aware authorization with context isolation
- ✅ **Production Ready**: Comprehensive logging, metrics, and error handling
- ✅ **Type Safe**: Full TypeScript support with strict typing
- ✅ **Configurable**: Multiple presets and extensive configuration options

## Quick Start

### Basic Setup

\`\`\`typescript
import { createCasbinMiddleware } from '@libs/middleware';
import { PrismaClient } from '@libs/database';

const prisma = new PrismaClient();
const redis = null; // Your Redis client

const casbinAuth = createCasbinMiddleware({
name: 'CasbinAuth',
skipPaths: ['/health', '/metrics'],
authorization: {
requireAuthentication: true,
defaultRole: 'user',
adminRole: 'admin',
}
}, prisma, redis);

// Use with your framework
app.use(casbinAuth.middleware());
\`\`\`

### Production Setup

\`\`\`typescript
import { casbinPresets } from '@libs/middleware';

const casbinAuth = casbinPresets.production(prisma, redis, {
skipPaths: ['/health', '/metrics'],
performance: {
maxConcurrentChecks: 10000,
slowQueryThreshold: 50,
}
});
\`\`\`

## Configuration

### Environment-Specific Presets

#### Development

- Relaxed policies (allow on error)
- Disabled caching for development
- Extensive logging and debugging
- Anonymous access allowed

\`\`\`typescript
const devAuth = casbinPresets.development(prisma);
\`\`\`

#### Production

- Strict security policies
- Redis caching enabled
- Performance optimizations
- Comprehensive metrics

\`\`\`typescript
const prodAuth = casbinPresets.production(prisma, redis);
\`\`\`

#### API Services

- Long-term caching (10 minutes)
- Optimized for high-volume requests
- Service-to-service authentication
- Reduced logging overhead

\`\`\`typescript
const apiAuth = casbinPresets.api(prisma);
\`\`\`

### Custom Configuration

\`\`\`typescript
const customConfig: Partial<CasbinConfig> = {
// Policy settings
policies: {
autoLoad: true,
watchForChanges: true,
defaultEffect: 'deny',
strictMode: true,
},

// Authorization behavior
authorization: {
requireAuthentication: true,
defaultRole: 'user',
adminRole: 'admin',
superAdminBypass: true,
},

// Caching configuration
cache: {
enabled: true,
ttl: 300, // 5 minutes
maxSize: 10000,
keyPrefix: 'casbin:',
invalidationStrategy: 'hybrid',
},

// Performance settings
performance: {
enableMetrics: true,
enableTracing: true,
slowQueryThreshold: 100,
maxConcurrentChecks: 1000,
},

// Error handling
fallback: {
onError: 'deny',
onDatabaseUnavailable: 'cache_only',
retryAttempts: 3,
retryDelay: 1000,
},
};
\`\`\`

## Authentication Integration

### Lucia Session Integration

The middleware automatically extracts user context from:

- Bearer tokens (Lucia sessions)
- Session cookies
- API keys

\`\`\`typescript
// Automatic extraction from Authorization header
Authorization: Bearer <lucia_session_token>

// Or from cookies
Cookie: lucia-session=<session_id>

// Or from API keys
Authorization: ApiKey <api_key>
\`\`\`

### User Context Structure

\`\`\`typescript
interface UserContext {
id: string;
email?: string;
username?: string;
roles: string[];
permissions: string[];
storeId?: string; // Multi-tenancy
organizationId?: string;
sessionId?: string;
apiKeyId?: string;
}
\`\`\`

## Database Schema Integration

The middleware works with your existing Prisma schema:

\`\`\`prisma
model Role {
id String @id @default(cuid())
name String @unique
displayName String
description String?
isActive Boolean @default(true)

// Role hierarchy
parentRoleId String?
parentRole Role? @relation("RoleHierarchy", fields: [parentRoleId], references: [id])
childRoles Role[] @relation("RoleHierarchy")

users User[]
permissions RolePermission[]
}

model RolePermission {
id String @id @default(cuid())
roleId String
resource String
action String

role Role @relation(fields: [roleId], references: [id])

@@unique([roleId, resource, action])
}

model User {
roleId String?
role Role? @relation(fields: [roleId], references: [id])
}
\`\`\`

## Role and Permission Management

### Creating Roles

\`\`\`typescript
// Create roles in your database
await prisma.role.createMany({
data: [
{
name: 'admin',
displayName: 'Administrator',
description: 'Full system access',
level: 1,
isActive: true,
},
{
name: 'user',
displayName: 'Regular User',
 description: 'Standard user access',
level: 5,
isActive: true,
},
],
});
\`\`\`

### Creating Permissions

\`\`\`typescript
const adminRole = await prisma.role.findUnique({ where: { name: 'admin' } });
const userRole = await prisma.role.findUnique({ where: { name: 'user' } });

await prisma.rolePermission.createMany({
data: [
// Admin gets everything
{ roleId: adminRole.id, resource: '_', action: '_', name: 'admin:all' },

    // Users get specific permissions
    { roleId: userRole.id, resource: 'users', action: 'get', name: 'users:read' },
    { roleId: userRole.id, resource: 'carts', action: '*', name: 'carts:all' },
    { roleId: userRole.id, resource: 'orders', action: 'post', name: 'orders:create' },

],
});
\`\`\`

## Usage Patterns

### Role-Based Authorization

\`\`\`typescript
import { createRoleBasedCasbinMiddleware } from '@libs/middleware';

// Require specific roles
const adminOnly = createRoleBasedCasbinMiddleware(['admin'], prisma);
const userOrAnalyst = createRoleBasedCasbinMiddleware(['user', 'analyst'], prisma);

app
.use('/admin', adminOnly.middleware())
.use('/analytics', userOrAnalyst.middleware())
\`\`\`

### Permission-Based Authorization

\`\`\`typescript
import { createPermissionBasedCasbinMiddleware } from '@libs/middleware';

// Require specific permissions
const dataExport = createPermissionBasedCasbinMiddleware(['data:export'], prisma);
const orderManagement = createPermissionBasedCasbinMiddleware(['orders:read', 'orders:write'], prisma);

app
.use('/export', dataExport.middleware())
.use('/orders', orderManagement.middleware())
\`\`\`

### Resource-Action Authorization

The middleware automatically maps HTTP methods to actions:

- GET → 'get' action
- POST → 'post' action
- PUT → 'put' action
- PATCH → 'patch' action
- DELETE → 'delete' action

Resources are extracted from URL paths:

- \`/api/v1/users/123\` → resource: 'users', action: 'get'
- \`/api/v1/products\` → resource: 'products', action: 'post'

## Multi-Tenancy

\`\`\`typescript
// Configure tenant-aware authorization
const tenantConfig: Partial<CasbinConfig> = {
model: {
requestDefinition: '[request_definition]\nr = sub, obj, act, tenant',
policyDefinition: '[policy_definition]\np = sub, obj, act, eft, tenant',
matchers: '[matchers]\nm = g(r.sub, p.sub) && g2(r.sub, p.tenant, r.tenant) && keyMatch(r.obj, p.obj) && regexMatch(r.act, p.act)',
},
};

// User context includes tenant info
const userContext: UserContext = {
id: 'user123',
roles: ['user'],
permissions: ['orders:read'],
storeId: 'store456', // Tenant identifier
};
\`\`\`

## Monitoring and Metrics

### Built-in Metrics

\`\`\`typescript
const metrics = casbinAuth.getMetrics();
console.log({
authorizationChecks: metrics.authorizationChecks,
authorizationDenials: metrics.authorizationDenials,
cacheHitRate: metrics.cacheHits / (metrics.cacheHits + metrics.cacheMisses),
averageResponseTime: metrics.averageResponseTime,
errorRate: metrics.errorRate,
});
\`\`\`

### Performance Monitoring

- Slow query detection (configurable threshold)
- Concurrent check limiting
- Cache efficiency tracking
- Response time monitoring

## Error Handling

### Fallback Strategies

\`\`\`typescript
{
fallback: {
onError: 'deny', // 'allow' | 'deny' | 'throw'
onDatabaseUnavailable: 'cache_only', // 'allow' | 'deny' | 'cache_only'
retryAttempts: 3,
retryDelay: 1000,
}
}
\`\`\`

### Error Response Format

\`\`\`json
{
"error": "Forbidden",
"message": "Access denied by policy",
"timestamp": "2024-01-01T00:00:00.000Z"
}
\`\`\`

## Best Practices

### 1. Use Appropriate Presets

- **Development**: Use \`casbinPresets.development()\` for local development
- **Production**: Use \`casbinPresets.production()\` for production environments
- **APIs**: Use \`casbinPresets.api()\` for service-to-service communication

### 2. Configure Caching

- Enable Redis caching in production
- Set appropriate TTL based on your security requirements
- Use longer TTLs for stable permissions, shorter for dynamic ones

### 3. Monitor Performance

- Set up metrics collection
- Monitor slow queries and adjust thresholds
- Track cache hit rates and optimize accordingly

### 4. Security Considerations

- Always use \`strictMode: true\` in production
- Set \`defaultEffect: 'deny'\` for security-first approach
- Regularly audit roles and permissions
- Use role hierarchy to minimize permission duplication

### 5. Testing

- Test authorization logic thoroughly
- Use development preset for testing
- Verify cache behavior in staging environments

## API Reference

See the [TypeScript definitions](./types.ts) for complete API documentation.

## Examples

Check out the [examples file](./examples.ts) for comprehensive usage examples including:

- Basic setup
- Production configuration
- Lucia auth integration
- Role and permission management
- Multi-tenancy setup
- Database policy initialization

## Troubleshooting

### Common Issues

1. **"Casbin enforcer not available"**

   - Ensure database connection is established
   - Check that roles and permissions exist in database

2. **"Maximum concurrent authorization checks exceeded"**

   - Increase \`maxConcurrentChecks\` limit
   - Optimize database queries
   - Enable caching to reduce load

3. **High cache miss rate**

   - Increase cache TTL
   - Check cache key patterns
   - Verify Redis connection

4. **Slow authorization checks**
   - Enable database query optimization
   - Add appropriate database indexes
   - Use caching for frequently checked permissions
