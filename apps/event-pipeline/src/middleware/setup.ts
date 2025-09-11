/**
 * Setup middleware for Event Pipeline service
 * Uses shared middleware library with service-specific configuration
 */

// Get all middleware for event pipeline
export const eventPipelineMiddleware = servicePresets.eventPipeline({
  // Override default configurations if needed
  auth: {
    // Event pipeline requires authentication for ingestion
    allowAnonymous: false,
    requiredPermissions: ["event_ingest"],
    bypassRoutes: ["/health", "/metrics"],
  },
  rateLimit: {
    // Higher limits for event ingestion
    maxRequests: 2000,
    windowMs: 60000,
    keyStrategy: "user",
    skipFailedRequests: true, // Don't count failed event processing
  },
  validation: {
    // Strict validation for event data
    engine: "zod",
    strictMode: true,
    sanitizeInputs: false, // Preserve event data integrity
    maxRequestSize: 5 * 1024 * 1024, // 5MB for batch events
    validateBody: true,
  },
});

// Alternative: Quick setup for development
export const developmentMiddleware = quickSetup.development("eventPipeline");

// Alternative: Security-focused setup for production
export const productionMiddleware = quickSetup.secure("eventPipeline");

// Export individual middleware for fine-grained control
export const { auth, rateLimit, validation } = eventPipelineMiddleware;
