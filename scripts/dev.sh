#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Starting Backend Development Environment${NC}"
echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"
echo ""

# Function to handle cleanup
cleanup() {
    echo -e "\n${YELLOW}Stopping all services...${NC}"
    kill $(jobs -p) 2>/dev/null
    wait
    echo -e "${GREEN}All services stopped.${NC}"
    exit 0
}

# Set up trap to catch Ctrl+C
trap cleanup SIGINT

# Start services in background
echo -e "${GREEN}Starting API Gateway on port 3000...${NC}"
cd apps/api-gateway && pnpm dev &

echo -e "${GREEN}Starting Ingestion Service on port 3001...${NC}"
cd ../ingestion && pnpm dev &

echo -e "${GREEN}Starting Prediction Service on port 3002...${NC}"
cd ../prediction && pnpm dev &

# Return to root
cd ../../

echo -e "${BLUE}Services started! Available at:${NC}"
echo -e "  📡 API Gateway:     http://localhost:3000"
echo -e "  📥 Ingestion:       http://localhost:3001"
echo -e "  🔮 Prediction:      http://localhost:3002"
echo -e "  📖 API Docs:        http://localhost:3000/swagger"
echo ""
echo -e "${YELLOW}Waiting for services... Press Ctrl+C to stop${NC}"

# Wait for all background jobs
wait
