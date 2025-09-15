# Copilot Instructions for Neurotracker Backend

## Architecture Overview

This is a **microservices monorepo** using PNPM workspaces with shared libraries pattern:

- **Apps**: 6 microservices (api-gateway, ai-engine, data-intelligence, event-pipeline, dashboard, intervention-engine)
- **Libs**: Shared libraries (@libs/auth, @libs/database, @libs/elysia-server, @libs/monitoring, etc.)
- **Framework**: Elysia.js for HTTP servers, TypeScript throughout
- **Databases**: PostgreSQL (primary), ClickHouse (analytics), Redis (cache/sessions)
- **Authentication**: Multi-modal (JWT tokens, API keys, session-based)

## Development Workflow

### Starting Services

```bash
# All services (recommended)
pnpm dev  # or make dev

# Individual services
pnpm --filter api-gateway dev
pnpm --filter ai-engine dev
```

Services run on dedicated ports:

- API Gateway: :3000 (main entry + Swagger docs at /swagger)
- Event Pipeline: :3001
- AI Engine: :3002

### Build System

```bash
pnpm build          # Build all with TypeScript compiler
pnpm build:watch    # Watch mode for development
```

### Testing Patterns

Use comprehensive mocking approach:

```typescript
// Standard Jest setup in each lib
jest.mock("@libs/monitoring", () => ({
  createLogger: jest.fn(() => ({ info: jest.fn(), error: jest.fn() }))
}));

// Mock workspace dependencies using moduleNameMapper
moduleNameMapper: {
  "^@libs/(.*)$": "<rootDir>/../$1/src/index.ts"
}
```

## Core Patterns

### 1. Middleware Architecture

The `@libs/elysia-server` provides production-grade middleware:

```typescript
// Standard middleware pattern
import { createAuthMiddleware, commonConfigs } from "@libs/middleware";

const authMiddleware = createAuthMiddleware({
  ...commonConfigs.auth.aiEngine,
  requiredPermissions: ["predict", "batch_predict"],
});

app.use(authMiddleware);
```

**Key Middleware Types:**

- **Authentication**: JWT + API Key + Anonymous modes
- **Rate Limiting**: Redis-backed with multiple strategies (IP, API key, user-based)
- **Logging**: Structured request/response with sanitization
- **Error Handling**: Centralized with metrics integration

### 2. Authentication Patterns

Multi-modal authentication system:

```typescript
// API Key format: x-api-key header
headers: { "x-api-key": "your-api-key" }

// JWT format: Authorization Bearer
headers: { "Authorization": "Bearer jwt.token.here" }

// Permission-based access control
requiredPermissions: ['predict', 'batch_predict', 'user_management']
```

**Service-Specific Auth Configs:**

- `commonConfigs.auth.apiGateway` - Allows anonymous
- `commonConfigs.auth.aiEngine` - Requires prediction permissions
- `commonConfigs.auth.dataIntelligence` - Requires user role

### 3. Database Layer

**Prisma Schema Features:**

- Multi-database support (PostgreSQL primary, ClickHouse analytics)
- RBAC with Role-Permission model
- API Key management with scopes/permissions
- Audit logging and soft deletes
- Enterprise features (webhooks, reports, reconciliation)

```typescript
// Repository pattern usage
const userRepo = new UserRepository(prisma);
const apiKey = await apiKeyService.validateApiKey(key);
```

### 4. Shared Library Pattern

Libraries export unified interfaces:

```typescript
// @libs/elysia-server exports
export { createAdvancedElysiaServer, AdvancedElysiaServerBuilder };
export { createAuthMiddleware, servicePresets };
export * from "./middleware"; // All middleware types
```

**Import Pattern:**

```typescript
import { createLogger } from "@libs/utils";
import { AuthMiddleware } from "@libs/auth";
import { DatabaseService } from "@libs/database";
```

## Service Communication

Services communicate via HTTP APIs with the API Gateway as main orchestrator:

- Internal service URLs via environment variables
- Rate limiting and authentication at service boundaries
- WebSocket support for real-time features

## Testing Guidelines

### Mock Structure

Each library has comprehensive test mocks in `tests/mocks/`:

```typescript
// Standard pattern for creating test utilities
export const createMockMetricsCollector = (): IMetricsCollector => ({
  recordCounter: jest.fn(),
  recordTimer: jest.fn(),
  recordGauge: jest.fn(),
});

// Use global test utils for consistency
global.testUtils = {
  createMockUser: (overrides = {}) => ({ id: "test", ...overrides }),
};
```

### Configuration

- Jest timeout: 10000ms (for database tests)
- Coverage collection from `src/**/*.{ts,tsx}`
- Mock workspace dependencies via `moduleNameMapper`
- Setup files: `tests/setup.ts` in each library

## Environment & Deployment

### Docker Development

```bash
docker-compose -f docker-compose.dev.yml up
```

Includes: PostgreSQL, ClickHouse, Redis, Keycloak, DBGate admin

### Key Environment Variables

```bash
DATABASE_URL=postgresql://...
REDIS_URL=redis://localhost:6379
EVENT_PIPELINE_URL=http://event-pipeline:3001
AI_ENGINE_URL=http://ai-engine:3002
```

## Important Conventions

1. **Error Handling**: Use structured error classes (AuthError, PermissionError)
2. **Logging**: Structured JSON logging with request IDs and user context
3. **Metrics**: Record timing, counters, and gauges for all operations
4. **Configuration**: Environment-based with sensible defaults
5. **Permissions**: Use string arrays for granular access control
6. **API Keys**: Hash storage, usage tracking, expiration support

## Common Gotchas

- **Workspace Dependencies**: Always use `@libs/` imports, not relative paths
- **Authentication**: Check `bypassRoutes` for health/metrics endpoints
- **Testing**: Mock `@libs/monitoring` and `@libs/utils` in test setup
- **PNPM**: Use `pnpm --filter <service> <command>` for service-specific operations
- **TypeScript**: Build from root to ensure proper dependency resolution

When implementing new features, follow the established middleware patterns, use the shared authentication system, and maintain the monorepo's consistency through proper imports and testing patterns.
