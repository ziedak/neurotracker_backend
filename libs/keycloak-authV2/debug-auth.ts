/**
 * Debug script to test authentication flow
 */
import { KeycloakClient } from "./src/client/KeycloakClient";
import { config } from "dotenv";
import { resolve } from "path";

// Load test environment
config({ path: resolve(__dirname, ".env.test") });

async function main() {
  console.log("=== Starting Debug ===");
  console.log("ENV vars:", {
    baseUrl: process.env.KEYCLOAK_BASE_URL,
    realm: process.env.KEYCLOAK_REALM,
    clientId: process.env.KEYCLOAK_CLIENT_ID,
    hasSecret: !!process.env.KEYCLOAK_CLIENT_SECRET,
  });

  // Create client
  const client = new KeycloakClient({
    realm: {
      serverUrl: process.env.KEYCLOAK_BASE_URL!,
      realm: process.env.KEYCLOAK_REALM!,
      clientId: process.env.KEYCLOAK_CLIENT_ID!,
      clientSecret: process.env.KEYCLOAK_CLIENT_SECRET!,
      scopes: ["openid", "profile", "email"],
    },
  });

  console.log("\n=== Before Initialize ===");
  console.log(
    "Discovery document:",
    client.getDiscoveryDocument() ? "EXISTS" : "NOT LOADED"
  );

  // Initialize
  console.log("\n=== Calling Initialize ===");
  await client.initialize();

  console.log("\n=== After Initialize ===");
  const doc = client.getDiscoveryDocument();
  console.log("Discovery document:", doc ? "EXISTS" : "STILL NOT LOADED");
  if (doc) {
    console.log("Token endpoint:", doc.token_endpoint);
    console.log("Issuer:", doc.issuer);
  }

  // Try authentication
  console.log("\n=== Attempting Authentication ===");
  try {
    const result = await client.authenticateClientCredentials([
      "openid",
      "profile",
      "email",
    ]);
    console.log("SUCCESS! Got token:");
    console.log("  - Access token length:", result.access_token?.length);
    console.log("  - Expires in:", result.expires_in);
    console.log("  - Has refresh token:", !!result.refresh_token);
  } catch (error) {
    console.error("FAILED:", error);
  }
}

main().catch(console.error);
