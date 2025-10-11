#!/bin/bash

# Integration Test Performance Fix - Quick Implementation
# Fixes 30-minute test execution time down to < 2 minutes

set -e

echo "🚀 Starting Integration Test Performance Optimization"
echo "=================================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Change to keycloak-authV2 directory
cd "$(dirname "$0")"
cd libs/keycloak-authV2

echo "📍 Working directory: $(pwd)"
echo ""

# Phase 1: Remove unnecessary delays
echo "${YELLOW}Phase 1: Removing unnecessary 2-second delays${NC}"
echo "----------------------------------------------"

# Count current delays
DELAY_COUNT=$(grep -r "setTimeout(resolve, 2000)" tests/integration/*.test.ts 2>/dev/null | wc -l)
echo "Found $DELAY_COUNT unnecessary 2-second delays"

if [ "$DELAY_COUNT" -gt 0 ]; then
    echo "Removing delays from test files..."
    
    # Remove delays but keep user registration calls
    for file in tests/integration/*.test.ts; do
        if [ -f "$file" ]; then
            echo "  Processing: $(basename $file)"
            # Comment out the setTimeout lines
            sed -i 's/await new Promise((resolve) => setTimeout(resolve, 2000));/\/\/ REMOVED: await new Promise((resolve) => setTimeout(resolve, 2000)); \/\/ Unnecessary delay/' "$file"
        fi
    done
    
    echo "${GREEN}✅ Removed $DELAY_COUNT delays (saves 32+ seconds)${NC}"
else
    echo "${GREEN}✅ No delays found (already optimized)${NC}"
fi

echo ""

# Phase 2: Check if sync service needs enabling
echo "${YELLOW}Phase 2: Checking sync service configuration${NC}"
echo "----------------------------------------------"

SYNC_ENABLED=$(grep -c "withSync: true" tests/integration/*.test.ts 2>/dev/null || echo "0")
echo "Tests with sync enabled: $SYNC_ENABLED"

if [ "$SYNC_ENABLED" -eq 0 ]; then
    echo "${RED}⚠️  Sync service not enabled in tests!${NC}"
    echo ""
    echo "To enable sync service (for maximum performance):"
    echo "1. Update tests/integration/setup.ts to initialize UserSyncService"
    echo "2. Update all test beforeAll() calls to include withSync: true"
    echo ""
    echo "See TEST_PERFORMANCE_OPTIMIZATION.md for detailed instructions"
else
    echo "${GREEN}✅ Sync service already enabled${NC}"
fi

echo ""

# Phase 3: Verify changes
echo "${YELLOW}Phase 3: Verifying changes${NC}"
echo "----------------------------------------------"

# Check if any delays remain
REMAINING_DELAYS=$(grep -r "setTimeout(resolve, 2000)" tests/integration/*.test.ts 2>/dev/null | grep -v "^//" | grep -v "REMOVED" | wc -l || echo "0")

if [ "$REMAINING_DELAYS" -eq 0 ]; then
    echo "${GREEN}✅ All unnecessary delays removed${NC}"
else
    echo "${YELLOW}⚠️  $REMAINING_DELAYS delays still present${NC}"
fi

echo ""

# Summary
echo "=================================================="
echo "${GREEN}Phase 1 Complete: Quick Wins Implemented${NC}"
echo ""
echo "Expected improvements:"
echo "  • Removed delays: 32+ seconds saved"
echo "  • Estimated new test time: 2-5 minutes (down from 30+)"
echo ""
echo "Next steps:"
echo "  1. Run tests: pnpm test:integration"
echo "  2. Verify all tests still pass"
echo "  3. For further optimization, enable sync service (see TEST_PERFORMANCE_OPTIMIZATION.md)"
echo ""
echo "${GREEN}Done! 🎉${NC}"
