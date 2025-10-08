/**
 * Direct test of Keycloak client credentials authentication
 * Run with: tsx test-keycloak-auth.ts
 */

import { createHttpClient } from "@libs/messaging";

async function testAuth() {
  console.log("Testing Keycloak client credentials authentication...\n");

  const httpClient = createHttpClient({
    timeout: 10000,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: "test-client",
    client_secret: "test-secret",
    scope: "email profile",
  });

  try {
    console.log(
      "Request URL:",
      "http://localhost:8080/realms/test-realm/protocol/openid-connect/token"
    );
    console.log("Request body:", params.toString());
    console.log("Request headers:", {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    });
    console.log("\nSending request...\n");

    const response = await httpClient.post<any>(
      "http://localhost:8080/realms/test-realm/protocol/openid-connect/token",
      params.toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
      }
    );

    console.log("✅ SUCCESS!");
    console.log("Status:", response.status, response.statusText);
    console.log("Has access_token:", !!response.data?.access_token);
    console.log("Token type:", response.data?.token_type);
    console.log("Expires in:", response.data?.expires_in);
  } catch (error) {
    console.log("❌ FAILED!");
    console.log("\nError type:", error?.constructor?.name);
    console.log(
      "Error message:",
      error instanceof Error ? error.message : String(error)
    );

    if (error && typeof error === "object") {
      console.log("\nError object keys:", Object.keys(error));
      console.log("\nFull error object:", JSON.stringify(error, null, 2));

      if ("status" in error) console.log("\nHTTP Status:", error.status);
      if ("statusText" in error) console.log("Status Text:", error.statusText);
      if ("data" in error)
        console.log("Response Data:", JSON.stringify(error.data, null, 2));
      if ("message" in error) console.log("Error Message:", error.message);
    }

    if (error instanceof Error && error.stack) {
      console.log("\nStack trace:", error.stack);
    }
  }
}

testAuth().catch(console.error);
