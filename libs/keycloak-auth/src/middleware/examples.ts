/**
 * Keycloak Auth Middleware Examples
 *
 * Basic examples for integrating Keycloak authentication with Elysia.js
 */

import { Elysia } from "elysia";

/**
 * Basic API Gateway Example (Simplified)
 */
export function createBasicApiGatewayExample() {
  return new Elysia()
    .get("/health", () => ({ status: "ok", service: "api-gateway" }))
    .get("/info", () => ({
      message: "Keycloak auth middleware is configured",
      version: "1.0.0",
      features: ["authentication", "authorization", "websocket"],
    }))
    .listen(3000);
}

/**
 * Basic health check service
 */
export function createHealthCheckService() {
  return new Elysia()
    .get("/", () => ({ message: "Keycloak Auth Library loaded successfully" }))
    .get("/health", () => ({
      status: "healthy",
      timestamp: new Date().toISOString(),
      service: "keycloak-auth-lib",
    }))
    .listen(3001);
}
