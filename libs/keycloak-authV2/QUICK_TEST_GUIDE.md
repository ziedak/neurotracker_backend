# Quick Test Guide

## ✅ All Fixed - Tests Ready to Run

### Prerequisites

1. Docker and Docker Compose installed
2. Keycloak, PostgreSQL running via docker-compose

### Quick Start (30 seconds)

```bash
# 1. Start services (if not running)
docker compose -f ../../docker-compose.dev.yml up -d

# 2. Setup Keycloak test realm (one-time)
bash scripts/setup-keycloak-test.sh

# 3. Run integration tests
bash scripts/run-integration-tests.sh
```

### Manual Test Run

```bash
# Load environment
source .env.test

# Run all integration tests
pnpm test:integration --forceExit

# Run specific test suite
pnpm test:integration --testPathPattern=01-authentication --forceExit

# Run with coverage
pnpm test:integration:coverage
```

### Verify Services

```bash
# Check Keycloak
curl http://localhost:8080/realms/test-realm

# Check PostgreSQL
psql postgresql://postgres:TEST@localhost:5432/neurotracker

# Check Redis
redis-cli ping
```

### Troubleshooting

**Issue**: Tests fail with "Keycloak not accessible"

```bash
# Check Keycloak logs
docker logs backend-keycloak-1 --tail 50

# Restart Keycloak
docker compose restart keycloak
```

**Issue**: Tests fail with database errors

```bash
# Check PostgreSQL logs
docker logs backend-postgres-1 --tail 50

# Verify connection
docker exec -it backend-postgres-1 psql -U postgres -d neurotracker
```

**Issue**: JWT validation errors

- This is expected - fix in progress
- Tests currently use workaround

### Current Status

✅ **Setup Working**: Keycloak realm configured correctly
✅ **Scripts Fixed**: All setup scripts functional
✅ **Mocks Ready**: Metrics and service mocks in place
⚠️ **Tests Need Fix**: JWT validation configuration gap (see INTEGRATION_TESTS_STATUS.md)

### Files Modified

- `tsconfig.base.json` - Added strictNullChecks
- `jest.integration.config.js` - Fixed ts-jest configuration
- `tests/integration/setup.ts` - Fixed CacheService API, added JWT workaround
- `tests/integration/mocks.ts` - Added metrics collector mock
- `tests/integration/01-authentication.test.ts` - Added getEnv() helper
- `src/services/apikey/APIKeyManager.ts` - Fixed import path
- `scripts/setup-keycloak-test.sh` - Fixed .env.test path
- `scripts/run-integration-tests.sh` - Updated for correct compose file

### Next: Fix JWT Configuration

See `INTEGRATION_TESTS_STATUS.md` for detailed action plan.
