# Backend Development Guide

This guide shows you how to run all microservices in development mode.

## 🚀 Quick Start

### Option 1: Run All Services (Recommended)

```bash
# Run all services in parallel
pnpm run dev:all

# Or simply:
pnpm dev
```

### Option 2: Individual Services

```bash
# Run only API Gateway (port 3000)
pnpm run dev:api

# Run only Ingestion Service (port 3001)
pnpm run dev:ingestion

# Run only Prediction Service (port 3002)
pnpm run dev:prediction
```

### Option 3: Using Make Commands

```bash
# Run all services
make dev

# Run individual services
make dev-api
make dev-ingestion
make dev-prediction

# Build all services
make build

# Install dependencies
make install
```

### Option 4: Using the Development Script

```bash
# Run the development script
./scripts/dev.sh
```

## 📍 Service Endpoints

When all services are running, they will be available at:

| Service          | URL                           | Description                            |
| ---------------- | ----------------------------- | -------------------------------------- |
| **API Gateway**  | http://localhost:3000         | Main entry point and API documentation |
| **Ingestion**    | http://localhost:3001         | Event ingestion service                |
| **Prediction**   | http://localhost:3002         | AI prediction service                  |
| **Swagger Docs** | http://localhost:3000/swagger | API documentation                      |

## 🔧 Development Workflow

1. **Start all services:**

   ```bash
   pnpm dev:all
   ```

2. **Services will auto-reload** when you make changes to the source code

3. **Stop all services:** Press `Ctrl+C` in the terminal

## 📋 Available Commands

```bash
# Development
pnpm dev                # Start all services
pnpm dev:all            # Start all services
pnpm dev:api            # Start API Gateway only
pnpm dev:ingestion      # Start Ingestion service only
pnpm dev:prediction     # Start Prediction service only

# Building
pnpm build              # Build all services
pnpm build:watch        # Build and watch for changes

# Testing
pnpm test               # Run tests
pnpm test:watch         # Run tests in watch mode
```

## 🐳 Docker Development (Optional)

If you prefer using Docker:

```bash
# Start all services with Redis using Docker Compose
docker-compose -f docker-compose.dev.yml up --build

# Stop Docker services
docker-compose -f docker-compose.dev.yml down
```

## 📦 Dependencies

Each service will automatically install its dependencies when started. If you need to manually install:

```bash
# Install all dependencies
pnpm install

# Or use make
make install
```

## 🔍 Troubleshooting

### Port Already in Use

If you get "port already in use" errors:

```bash
# Kill processes on specific ports
lsof -ti:3000 | xargs kill -9  # API Gateway
lsof -ti:3001 | xargs kill -9  # Ingestion
lsof -ti:3002 | xargs kill -9  # Prediction
```

### Redis Connection Errors

The Redis connection errors you see are normal in development if Redis is not running. The services will continue to work without Redis, but some features (like rate limiting and logging) may be reduced.

To start Redis locally:

```bash
# Install and start Redis (Ubuntu/Debian)
sudo apt install redis-server
sudo systemctl start redis-server

# Or using Docker
docker run -d -p 6379:6379 redis:7-alpine
```

## 🏗️ Project Structure

```
backend/
├── apps/
│   ├── api-gateway/     # Main API Gateway (port 3000)
│   ├── ingestion/       # Event Ingestion (port 3001)
│   └── prediction/      # AI Prediction (port 3002)
├── libs/
│   ├── auth/           # Authentication library
│   ├── database/       # Database connections
│   ├── monitoring/     # Logging and metrics
│   └── utils/          # Shared utilities
└── scripts/
    └── dev.sh          # Development script
```

## 📝 Notes

- All services support hot reloading during development
- TypeScript compilation happens automatically
- Environment variables are loaded from `.env` files
- Services communicate via HTTP APIs
- The API Gateway acts as the main entry point and service registry
