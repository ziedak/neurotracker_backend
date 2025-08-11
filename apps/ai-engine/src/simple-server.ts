/**
 * Simplified AI Engine Server
 * High-performance, minimal dependencies
 */

import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { createSimpleRoutes } from "./simple-routes";

const PORT = process.env.AI_ENGINE_PORT ? parseInt(process.env.AI_ENGINE_PORT) : 3003;

function createServer() {
  const app = new Elysia()
    .use(cors())
    .get("/", () => ({
      service: "ai-engine",
      version: "2.0.0-optimized",
      status: "running",
      endpoints: [
        "GET /health",
        "POST /predict", 
        "POST /predict/batch",
        "POST /features",
        "GET /stats",
        "DELETE /cache"
      ]
    }));

  // Add routes
  createSimpleRoutes(app);

  return app;
}

// Start server
async function startServer() {
  try {
    const app = createServer();
    
    app.listen(PORT);
    
    console.log(`🚀 AI Engine (Optimized) running on port ${PORT}`);
    console.log(`📊 Memory usage: ${JSON.stringify(process.memoryUsage(), null, 2)}`);
    
    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('🛑 Shutting down gracefully...');
      process.exit(0);
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Start if this file is run directly
if (require.main === module) {
  startServer();
}

export { createServer, startServer };
