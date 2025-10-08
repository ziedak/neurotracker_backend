# Integration Tests Guide

## Overview

Comprehensive integration test suite for `KeycloakIntegrationService` that validates all functionality against real Keycloak and PostgreSQL services.

## Test Coverage

### 1. Authentication Tests (`01-authentication.test.ts`)

- ✅ Password authentication flow
- ✅ Wrong password rejection
- ✅ Non-existent user rejection
- ✅ Session validation
- ✅ Token refresh
- ✅ Logout flow

### 2. User Management Tests (`02-user-management.test.ts`)

- ✅ Batch user registration (5 users)
- ✅ Partial batch failures handling
- ✅ Batch user updates
- ✅ Batch role assignment
- ✅ Batch user deletion
- ✅ User CRUD operations
- ✅ User search with filters

### 3. API Key Management Tests (`03-api-keys.test.ts`)

- ✅ API key creation
- ✅ Custom prefix keys
- ✅ API key validation
- ✅ Invalid key rejection
- ✅ Revoked key rejection
- ✅ API key rotation
- ✅ Key listing and retrieval
- ✅ Key metadata updates
- ✅ API key statistics

### 4. Session Management Tests (`04-sessions.test.ts`)

- ✅ Session creation
- ✅ Multiple sessions per user
- ✅ Session retrieval
- ✅ Session listing
- ✅ Session updates
- ✅ Session invalidation
- ✅ Session statistics

### 5. Caching Tests (`05-caching.test.ts`)

- ✅ API key validation caching
- ✅ Cache performance improvement
- ✅ Cache invalidation on revocation
- ✅ Session data caching
- ✅ Cache statistics
- ✅ Cache clearing

### 6. Health Monitoring Tests (`06-health-monitoring.test.ts`)

- ✅ System health checks
- ✅ Resource statistics
- ✅ Integration statistics
- ✅ System information
- ✅ Performance metrics
- ✅ Connection status verification

### 7. E2E Scenarios (`07-e2e-scenarios.test.ts`)

- ✅ Complete user lifecycle
- ✅ Concurrent user operations
- ✅ Concurrent API key validations
- ✅ API key full lifecycle
- ✅ Multiple active sessions
- ✅ Error recovery scenarios

## Prerequisites

### Required Services

- Docker & Docker Compose
- Node.js 18+
- PNPM

### Environment Setup

1. **Start Docker Services**:

```bash
docker-compose -f docker-compose.dev.yml up -d
```

2. **Configure Environment Variables** (`.env.test`):

```bash
# Keycloak Configuration
KEYCLOAK_SERVER_URL=http://localhost:8080
KEYCLOAK_REALM=test-realm
KEYCLOAK_CLIENT_ID=test-client
KEYCLOAK_CLIENT_SECRET=test-secret

# Database Configuration
DATABASE_URL=postgresql://test:test@localhost:5432/keycloak_test

# Redis Configuration (optional)
REDIS_URL=redis://localhost:6379
```

## Running Tests

### Quick Start (Automated)

```bash
# Run all tests with automated setup/teardown
./scripts/run-integration-tests.sh
```

### Manual Execution

```bash
# 1. Start services
docker-compose -f docker-compose.dev.yml up -d

# 2. Wait for services to be ready (~30 seconds)

# 3. Run migrations
pnpm prisma migrate deploy

# 4. Run tests
pnpm test:integration

# 5. Stop services
docker-compose -f docker-compose.dev.yml down
```

### Individual Test Suites

```bash
# Run specific test file
pnpm test:integration 01-authentication

# Run with coverage
pnpm test:integration --coverage

# Run in watch mode
pnpm test:integration --watch

# Run with verbose output
pnpm test:integration --verbose
```

### Keep Services Running

```bash
# Keep Docker services running after tests
KEEP_SERVICES_RUNNING=true ./scripts/run-integration-tests.sh
```

## Test Configuration

### Jest Configuration (`jest.integration.config.js`)

- Test timeout: 60 seconds
- Sequential execution (maxWorkers: 1)
- Source maps enabled
- Coverage reporting

### Service URLs

- **Keycloak**: http://localhost:8080
- **PostgreSQL**: localhost:5432
- **Redis**: localhost:6379 (optional)
- **Keycloak Admin**: http://localhost:8080/admin (admin/admin)

## Expected Results

### Success Output

```
✅ ALL TESTS PASSED

Test Suites: 7 passed, 7 total
Tests:       45+ passed, 45+ total
Time:        ~120s
Coverage:    >80%
```

### Test Metrics

- **Total Tests**: 45+
- **Average Duration**: ~2-3 minutes
- **Code Coverage**: >80%
- **Services Tested**: Keycloak, PostgreSQL, Redis

## Troubleshooting

### Keycloak Not Accessible

```bash
# Check Keycloak logs
docker-compose -f docker-compose.dev.yml logs keycloak

# Restart Keycloak
docker-compose -f docker-compose.dev.yml restart keycloak

# Verify Keycloak is running
curl http://localhost:8080/realms/test-realm
```

### Database Connection Failed

```bash
# Check PostgreSQL logs
docker-compose -f docker-compose.dev.yml logs postgres

# Verify PostgreSQL is running
docker-compose -f docker-compose.dev.yml ps

# Test connection
psql postgresql://test:test@localhost:5432/keycloak_test
```

### Tests Timing Out

- Increase timeout in `jest.integration.config.js`
- Check service resources (CPU/memory)
- Run tests sequentially: `maxWorkers: 1`

### Port Conflicts

```bash
# Check what's using the ports
lsof -i :8080  # Keycloak
lsof -i :5432  # PostgreSQL
lsof -i :6379  # Redis

# Change ports in docker-compose.dev.yml
```

### Cleanup Issues

```bash
# Force remove all test data
docker-compose -f docker-compose.dev.yml down -v

# Remove all Docker resources
docker system prune -a
```

## Coverage Reports

### View HTML Coverage Report

```bash
# Generate and open coverage report
pnpm test:integration --coverage
open coverage/integration/index.html
```

### Coverage Thresholds

- **Statements**: >80%
- **Branches**: >75%
- **Functions**: >80%
- **Lines**: >80%

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Integration Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s

      keycloak:
        image: quay.io/keycloak/keycloak:latest
        env:
          KEYCLOAK_ADMIN: admin
          KEYCLOAK_ADMIN_PASSWORD: admin
        options: >-
          --health-cmd "curl -f http://localhost:8080/health"

    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v3
        with:
          node-version: 18
          cache: "pnpm"

      - run: pnpm install
      - run: pnpm test:integration
```

## Best Practices

### Writing Integration Tests

1. **Isolate test data**: Use unique identifiers for each test
2. **Clean up**: Always cleanup test data in `afterAll`
3. **Wait for async**: Use proper wait mechanisms for Keycloak sync
4. **Test real flows**: Simulate actual user journeys
5. **Check both success and failure**: Test error cases

### Performance

- Run tests sequentially to avoid conflicts
- Use caching to speed up repeated validations
- Keep Docker services running during development

### Debugging

```bash
# Run single test with full output
pnpm test:integration 01-authentication --verbose --no-coverage

# Enable debug logging
DEBUG=* pnpm test:integration

# Keep services running for inspection
KEEP_SERVICES_RUNNING=true ./scripts/run-integration-tests.sh
```

## Test Data Management

### Automatic Cleanup

- Test users are tracked and cleaned up after each test suite
- Sessions are invalidated after tests
- API keys are deleted after tests

### Manual Cleanup

```bash
# Clean up test database
docker-compose -f docker-compose.dev.yml exec postgres \
  psql -U test keycloak_test -c "DELETE FROM users WHERE username LIKE 'testuser_%';"

# Reset Keycloak realm
# Use Keycloak Admin UI at http://localhost:8080/admin
```

## Performance Benchmarks

### Expected Performance

- User registration: <500ms
- Authentication: <300ms
- API key validation (cached): <10ms
- API key validation (uncached): <100ms
- Session validation: <50ms
- Batch operations (10 users): <2s

## Support

### Logs Location

- **Test output**: Terminal/stdout
- **Coverage**: `coverage/integration/`
- **Docker logs**: `docker-compose logs`

### Common Issues

1. **Port conflicts**: Change ports in docker-compose
2. **Slow tests**: Increase timeout or reduce test count
3. **Flaky tests**: Add proper wait mechanisms
4. **Memory issues**: Increase Docker resources

---

**Total Test Count**: 45+ integration tests  
**Test Duration**: ~2-3 minutes  
**Coverage**: >80%  
**Services**: Keycloak, PostgreSQL, Redis (optional)
