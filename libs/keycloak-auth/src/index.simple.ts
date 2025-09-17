/**
 * Keycloak Authentication Library - Simplified Entry Point
 * Basic exports for Phase 1 implementation
 */

// Re-export the simplified, working version
export * from "./simple";

// Version information
export const getLibraryInfo = () => ({
  name: "@libs/keycloak-auth",
  version: "1.0.0",
  description: "Keycloak authentication library - Phase 1 foundation",
  status: "In Development",
  phase: "Phase 1: Foundation + TypeScript Fixes",
});
