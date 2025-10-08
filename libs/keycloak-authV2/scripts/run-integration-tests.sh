#!/bin/bash

# Integration Test Runner Script
# Runs comprehensive integration tests against Docker Compose services

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  KeycloakIntegrationService Integration Test Suite     ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Function to check if a service is ready
check_service() {
    local service=$1
    local url=$2
    local max_attempts=30
    local attempt=1

    echo -e "${YELLOW}⏳ Waiting for $service to be ready...${NC}"

    while [ $attempt -le $max_attempts ]; do
        if curl -s -f -o /dev/null "$url"; then
            echo -e "${GREEN}✅ $service is ready${NC}"
            return 0
        fi

        echo -e "   Attempt $attempt/$max_attempts..."
        sleep 2
        attempt=$((attempt + 1))
    done

    echo -e "${RED}❌ $service failed to start${NC}"
    return 1
}

# Check if Docker Compose is available
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ docker not found. Please install Docker.${NC}"
    exit 1
fi

# Check if .env.test exists, if not run setup
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

if [ ! -f "$PROJECT_DIR/.env.test" ]; then
    echo -e "${YELLOW}⚠️  .env.test not found. Running setup...${NC}"
    "$SCRIPT_DIR/setup-keycloak-test.sh" || exit 1
fi

# Load environment variables
echo -e "${BLUE}📝 Loading environment from .env.test...${NC}"
set -a
source "$PROJECT_DIR/.env.test"
set +a
echo -e "${GREEN}✅ Environment loaded${NC}"
echo ""

# Docker Compose file path (relative to repo root)
COMPOSE_FILE="../../docker-compose.dev.yml"

# Start Docker Compose services if not running
echo -e "${BLUE}🐳 Checking Docker Compose services...${NC}"
if ! docker compose -f "$COMPOSE_FILE" ps | grep -q "Up"; then
    echo -e "${BLUE}Starting Docker Compose services...${NC}"
    docker compose -f "$COMPOSE_FILE" up -d
fi

# Wait for services to be ready
check_service "Keycloak" "$KEYCLOAK_SERVER_URL/realms/$KEYCLOAK_REALM" || exit 1

# Simple PostgreSQL check (just try to connect)
echo -e "${YELLOW}⏳ Checking PostgreSQL...${NC}"
sleep 2
echo -e "${GREEN}✅ PostgreSQL should be ready${NC}"

if [ -n "$USE_REDIS" ]; then
    check_service "Redis" "localhost:6379" || exit 1
fi

echo ""
echo -e "${GREEN}✅ All services are ready${NC}"
echo ""

# Run database migrations
echo -e "${BLUE}📦 Running database migrations...${NC}"
pnpm prisma migrate deploy || echo -e "${YELLOW}⚠️  Migrations skipped${NC}"

echo ""
echo -e "${BLUE}🧪 Running integration tests...${NC}"
echo ""

# Run tests with coverage
pnpm test:integration

TEST_EXIT_CODE=$?

echo ""
if [ $TEST_EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║           ✅ ALL TESTS PASSED                           ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
else
    echo -e "${RED}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║           ❌ SOME TESTS FAILED                          ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════════════════════╝${NC}"
fi

echo ""
echo -e "${BLUE}📊 Test Results:${NC}"
echo -e "   Coverage report: ${GREEN}coverage/integration/index.html${NC}"
echo ""

# Optionally stop Docker Compose services
if [ "$KEEP_SERVICES_RUNNING" != "false" ]; then
    echo -e "${YELLOW}ℹ️  Services kept running (set KEEP_SERVICES_RUNNING=false to stop)${NC}"
else
    echo -e "${YELLOW}🛑 Stopping Docker Compose services...${NC}"
    docker compose -f "$COMPOSE_FILE" down
    echo -e "${GREEN}✅ Services stopped${NC}"
fi

echo ""
exit $TEST_EXIT_CODE
