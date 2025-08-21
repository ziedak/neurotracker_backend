/**
 * Phase 4 Enhanced Authentication Usage Examples
 * Demonstrates enterprise multi-tenancy and enhanced security features
 */

import { AuthenticationServiceV2 } from "../../../libs/authV2/src/services";
import type { IAuthenticationCredentials } from "../../../libs/authV2/src/contracts/services";

/**
 * Example 1: Multi-tenant authentication with store context
 */
async function authenticateWithStoreContext() {
  const authService = new AuthenticationServiceV2();
  // service dependencies would be injected here

  const credentials: IAuthenticationCredentials = {
    email: "user@example.com",
    password: "securePassword123",
  };

  const storeId = "store_12345";

  // Phase 4: Enhanced authentication with tenant validation
  const result = await authService.authenticateWithTenantContext(
    credentials,
    storeId
  );

  if (result.success) {
    console.log("Authentication successful with tenant validation");
    console.log("User:", result.user?.email);
    console.log("Tenant:", result.metadata?.tenantId);
  }
}

/**
 * Example 2: Secure authentication with runtime validation
 */
async function secureAuthentication() {
  const authService = new AuthenticationServiceV2();
  // service dependencies would be injected here

  const credentials: IAuthenticationCredentials = {
    email: "admin@enterprise.com",
    password: "complexPassword789",
  };

  // Phase 4: Enhanced security with configurable validation
  const result = await authService.authenticateSecure(credentials, {
    validateInput: true,
    securityLevel: "maximum",
    tenantId: "org_67890",
  });

  if (result.success) {
    console.log("Secure authentication successful");
    console.log("Security Level:", result.metadata?.securityLevel);
    console.log("Enhanced Features:", result.metadata?.phase4Features);
  }
}

/**
 * Example 3: Tenant context validation for existing sessions
 */
async function validateExistingSession() {
  const authService = new AuthenticationServiceV2();
  // service dependencies would be injected here

  // Get context from existing session
  const context = await authService.getContextBySession("session_abc123");

  if (context) {
    // Phase 4: Tenant boundary validation
    const isValidTenant = await authService.validateTenantContext(
      context,
      "store_12345"
    );

    if (isValidTenant) {
      console.log("Tenant validation successful");
      console.log("User has access to store");

      // Enhanced user properties available
      const enhancedMetadata = context.metadata?.enhancedSecurity;
      if (enhancedMetadata) {
        console.log(
          "Failed login attempts:",
          enhancedMetadata.failedLoginAttempts
        );
        console.log("MFA enabled:", enhancedMetadata.mfaEnabled);
        console.log("Trusted devices:", enhancedMetadata.trustedDevicesCount);
      }
    }
  }
}

export {
  authenticateWithStoreContext,
  secureAuthentication,
  validateExistingSession,
};
