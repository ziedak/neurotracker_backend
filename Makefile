.PHONY: help dev dev-all dev-api dev-ingestion dev-prediction build clean install

# Default target
help:
	@echo "🚀 Backend Development Commands"
	@echo ""
	@echo "Available commands:"
	@echo "  make dev        - Start all services in development mode"
	@echo "  make dev-api    - Start only API Gateway"
	@echo "  make dev-ingestion - Start only Ingestion service"
	@echo "  make dev-prediction - Start only Prediction service"
	@echo "  make build      - Build all services"
	@echo "  make install    - Install all dependencies"
	@echo "  make clean      - Clean node_modules and build artifacts"
	@echo ""

# Install dependencies
install:
	@echo "📦 Installing dependencies..."
	pnpm install

# Build all services
build:
	@echo "🔨 Building all services..."
	pnpm build

# Start all services in development
dev: dev-all

dev-all:
	@echo "🚀 Starting all services in development mode..."
	pnpm run dev:all

# Start individual services
dev-api:
	@echo "📡 Starting API Gateway..."
	pnpm --filter api-gateway dev

dev-ingestion:
	@echo "📥 Starting Ingestion service..."
	pnpm --filter ingestion dev

dev-prediction:
	@echo "🔮 Starting Prediction service..."
	pnpm --filter prediction dev

# Clean build artifacts and dependencies
clean:
	@echo "🧹 Cleaning build artifacts..."
	find . -name "node_modules" -type d -exec rm -rf {} + 2>/dev/null || true
	find . -name "dist" -type d -exec rm -rf {} + 2>/dev/null || true
	find . -name "*.tsbuildinfo" -delete 2>/dev/null || true
	find src -name "*.js" -o -name "*.d.ts" -o -name "*.map" | xargs rm -f



# Docker development environment
docker-dev:
	@echo "🐳 Starting Docker development environment..."
	docker-compose -f docker-compose.dev.yml up --build

docker-dev-down:
	@echo "🐳 Stopping Docker development environment..."
	docker-compose -f docker-compose.dev.yml down
