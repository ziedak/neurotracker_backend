import { setupTestEnvironment, cleanupTestEnvironment } from "./setup";
import type { TestEnvironment } from "./setup";

describe("Simple Session Test", () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = await setupTestEnvironment({ withCache: false });
  }, 30000);

  afterAll(async () => {
    await cleanupTestEnvironment(env);
  }, 15000);

  it("should create and retrieve session", async () => {
    // Register user
    const userData = {
      username: `testuser_${Date.now()}`,
      email: `test_${Date.now()}@example.com`,
      password: "SecurePass123!",
      firstName: "Test",
      lastName: "User",
    };

    const registerResult = await env.service.batchRegisterUsers([userData]);
    console.log("Register result:", registerResult);
    expect(registerResult.success).toBe(true);

    const userId = registerResult.results[0]?.data?.id;
    console.log("User ID:", userId);
    expect(userId).toBeDefined();

    // Authenticate
    const authResult = await env.service.authenticateWithPassword(
      userData.username,
      userData.password,
      {
        ipAddress: "127.0.0.1",
        userAgent: "Test",
      }
    );

    console.log("Auth result:", JSON.stringify(authResult, null, 2));
    expect(authResult.success).toBe(true);
    expect(authResult.session).toBeDefined();

    const sessionId = authResult.session?.id;
    console.log("Session ID:", sessionId);
    expect(sessionId).toBeDefined();

    // Get session
    const getResult = await env.service.getSession(sessionId!);
    console.log("Get session result:", JSON.stringify(getResult, null, 2));
    expect(getResult.success).toBe(true);
    expect(getResult.session).toBeDefined();
  }, 60000);
});
