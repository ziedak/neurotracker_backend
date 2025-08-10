#!/bin/bash

# Microservice generator script
# Usage: ./create-microservice.sh <service-name> <port>

SERVICE_NAME=$1
PORT=${2:-3000}

if [ -z "$SERVICE_NAME" ]; then
    echo "Usage: ./create-microservice.sh <service-name> <port>"
    echo "Example: ./create-microservice.sh ai-engine 3002"
    exit 1
fi

APPS_DIR="apps"
SERVICE_DIR="$APPS_DIR/$SERVICE_NAME"

# Check if service already exists
if [ -d "$SERVICE_DIR" ]; then
    echo "Service '$SERVICE_NAME' already exists!"
    exit 1
fi

echo "Creating microservice: $SERVICE_NAME on port $PORT"

# Create directory structure
mkdir -p "$SERVICE_DIR/src"

# Create package.json
cat > "$SERVICE_DIR/package.json" << EOF
{
  "name": "$SERVICE_NAME",
  "version": "1.0.0",
  "description": "$SERVICE_NAME microservice",
  "main": "index.js",
  "scripts": {
    "dev": "nodemon --watch src --exec tsx src/main.ts",
    "build": "tsc",
    "start": "tsx src/main.ts"
  },
  "dependencies": {
    "@libs/elysia-server": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^24.2.1",
    "nodemon": "^3.1.10",
    "tsx": "^4.20.3",
    "typescript": "^5.9.2"
  }
}
EOF

# Create tsconfig.json
cat > "$SERVICE_DIR/tsconfig.json" << EOF
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules"]
}
EOF

# Create main.ts
cat > "$SERVICE_DIR/src/main.ts" << EOF
import { t } from "elysia";
import { createElysiaServer } from "@libs/elysia-server";

// Create server using the shared library
const { app, server } = createElysiaServer({
  name: "${SERVICE_NAME^} Service",
  port: $PORT,
  version: "1.0.0",
  description: "${SERVICE_NAME^} microservice",
  swagger: {
    enabled: true,
    title: "${SERVICE_NAME^} API",
  },
  rateLimiting: {
    enabled: true,
    requests: 1000,
    windowMs: 60000,
  },
}, (app: any) => {
  return app
    .get("/", () => ({
      service: "${SERVICE_NAME^} Service",
      status: "ready",
      version: "1.0.0",
      endpoints: {
        "GET /": "Service info",
        "GET /health": "Health check",
      },
    }))
    
    .get("/api/status", () => ({
      status: "operational",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    }))
    
    // Add your custom routes here
    .post("/api/example", ({ body }: any) => {
      console.log("Received request:", body);
      
      return {
        message: "Request processed successfully",
        data: body,
        timestamp: new Date().toISOString(),
      };
    }, {
      body: t.Object({
        message: t.String(),
        data: t.Optional(t.Any()),
      }),
    });
}).start();
EOF

# Create Dockerfile
cat > "$SERVICE_DIR/dockerfile" << EOF
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package.json ./
COPY pnpm-lock.yaml ./

# Install dependencies
RUN npm install -g pnpm
RUN pnpm install --frozen-lockfile

# Copy source code
COPY src/ ./src/
COPY tsconfig.json ./

# Build the application
RUN pnpm build

# Expose port
EXPOSE $PORT

# Start the application
CMD ["node", "dist/main.js"]
EOF

echo "✅ Created microservice '$SERVICE_NAME'"
echo "📁 Location: $SERVICE_DIR"
echo "🚀 Port: $PORT"
echo ""
echo "Next steps:"
echo "1. cd $SERVICE_DIR"
echo "2. pnpm install"
echo "3. pnpm dev"
echo ""
echo "🔗 Swagger docs will be available at: http://localhost:$PORT/swagger"
