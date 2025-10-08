# Quick Start Guide - Integration Tests

## 🚀 Quick Start (5 minutes)

### 1. Start Services

```bash
# Start Docker Compose services
docker-compose -f docker-compose.test.yml up -d

# Wait for services to be ready (~30-60 seconds)
# Keycloak takes the longest to start
```

### 2. Verify Services

```bash
# Check Keycloak
curl http://localhost:8080/realms/master

# Check PostgreSQL
psql postgresql://test:test@localhost:5432/keycloak_test -c "SELECT 1"

# Check Redis (optional)
redis-cli ping
```

### 3. Setup Test Realm in Keycloak

**Option A: Via Keycloak Admin UI**

1. Open http://localhost:8080/admin
2. Login: `admin` / `admin`
3. Create realm: `test-realm`
4. Create client: `test-client`
   - Client authentication: ON
   - Standard flow: ON
   - Direct access grants: ON
5. Get client secret from Credentials tab
6. Update `.env.test` with the secret

**Option B: Via Script (Automated)**

```bash
# Run Keycloak setup script
./scripts/setup-keycloak-test.sh
```

### 4. Configure Environment

```bash
# Copy environment template
cp .env.test.example .env.test

# Edit with your values (if different from defaults)
nano .env.test
```

### 5. Run Tests

```bash
# Install dependencies
pnpm install

# Run migrations
pnpm prisma migrate deploy

# Run all integration tests
pnpm test:integration

# Or use the automated script
chmod +x scripts/run-integration-tests.sh
./scripts/run-integration-tests.sh
```

## 📋 Test Categories

### Run Specific Test Suites

```bash
# Authentication tests only
pnpm test:integration 01-authentication

# User management tests only
pnpm test:integration 02-user-management

# API key tests only
pnpm test:integration 03-api-keys

# Session tests only
pnpm test:integration 04-sessions

# Caching tests only
pnpm test:integration 05-caching

# Health monitoring tests only
pnpm test:integration 06-health-monitoring

# E2E scenario tests only
pnpm test:integration 07-e2e-scenarios
```

## 🧪 Expected Test Results

```
Test Suites: 7 passed, 7 total
Tests:       45+ passed, 45+ total
Snapshots:   0 total
Time:        ~120s

Coverage:
  Statements   : >80%
  Branches     : >75%
  Functions    : >80%
  Lines        : >80%
```

## 🔍 What's Being Tested

### ✅ Authentication (8 tests)

- Password authentication flow
- Token validation and refresh
- Session management
- Logout functionality

### ✅ User Management (12 tests)

- Batch user operations (register, update, delete)
- Role assignment
- User search and filtering
- CRUD operations

### ✅ API Key Management (10 tests)

- Key creation and validation
- Key rotation and revocation
- Metadata updates
- Statistics tracking

### ✅ Session Management (8 tests)

- Session creation and retrieval
- Multiple sessions per user
- Session invalidation
- Session statistics

### ✅ Caching (5 tests)

- Cache effectiveness
- Performance improvements
- Cache invalidation
- TTL behavior

### ✅ Health Monitoring (7 tests)

- System health checks
- Resource statistics
- Connection status
- Performance metrics

### ✅ E2E Scenarios (8 tests)

- Complete user lifecycle
- Concurrent operations
- Error recovery
- Real-world flows

## 🛠️ Troubleshooting

### Services Not Starting

```bash
# Check logs
docker-compose -f docker-compose.test.yml logs

# Restart services
docker-compose -f docker-compose.test.yml restart

# Full reset
docker-compose -f docker-compose.test.yml down -v
docker-compose -f docker-compose.test.yml up -d
```

### Tests Failing

```bash
# Run with verbose output
pnpm test:integration --verbose

# Run specific test
pnpm test:integration 01-authentication --verbose

# Check service health
curl http://localhost:8080/health
psql postgresql://test:test@localhost:5432/keycloak_test -c "SELECT 1"
```

### Cleanup Issues

```bash
# Stop and remove all containers
docker-compose -f docker-compose.test.yml down -v

# Remove test data
docker volume rm keycloak-authv2_postgres_data
docker volume rm keycloak-authv2_redis_data
```

## 📊 Performance Benchmarks

Expected performance (approximate):

- User registration: <500ms
- Authentication: <300ms
- API key validation (cached): <10ms
- API key validation (uncached): <100ms
- Session validation: <50ms
- Batch operations (10 users): <2s

## 🎯 Coverage Report

```bash
# Generate coverage report
pnpm test:integration --coverage

# Open HTML report
open coverage/integration/index.html
```

## 🔄 Continuous Development

### Keep Services Running

```bash
# Keep Docker services running between test runs
KEEP_SERVICES_RUNNING=true ./scripts/run-integration-tests.sh

# Then run tests multiple times
pnpm test:integration
```

### Watch Mode

```bash
# Auto-rerun tests on file changes
pnpm test:integration:watch
```

## 📝 Next Steps

After tests pass:

1. Review coverage report
2. Check logs for warnings
3. Test in production-like environment
4. Deploy to staging
5. Monitor metrics in production

## 🆘 Getting Help

If tests are failing:

1. Check service logs: `docker-compose logs`
2. Verify environment variables in `.env.test`
3. Ensure Keycloak realm is properly configured
4. Check database migrations are applied
5. Review test output for specific errors

---

**Total Duration**: ~2-3 minutes  
**Services Required**: Keycloak, PostgreSQL, Redis (optional)  
**Coverage Goal**: >80%
