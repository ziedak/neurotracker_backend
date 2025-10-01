/**
 * Keycloak Client Module Exports
 * Comprehensive Keycloak integration with resilience patterns
 */

// Core client functionality
export {
  KeycloakClient,
  type IKeycloakClient,
  type KeycloakRealmConfig,
  type KeycloakClientOptions,
  type KeycloakDiscoveryDocument,
  type KeycloakTokenResponse,
  type KeycloakUserInfo,
  type KeycloakIntrospectionResponse,
  type CodeExchangeResult,
  type DirectGrantAuthResult,
  type AuthenticationFlow,
} from "./KeycloakClient";

// Factory for multiple client management
export {
  KeycloakClientFactory,
  createKeycloakClientFactory,
  createEnvironmentConfig,
  type KeycloakMultiClientConfig,
  type ClientType,
  type KeycloakEnvironmentConfig,
} from "./KeycloakClientFactory";

// Resilient client with graceful degradation
export {
  ResilientKeycloakClient,
  createResilientKeycloakClient,
  type FallbackConfig,
} from "./KeycloakClientExtensions";
