import { createElysiaServer } from "@libs/elysia-server";
import { DEFAULT_SERVER_CONFIG } from "@libs/elysia-server";
import { setupFeatureRoutes } from "./routes";
const request = require("supertest");

describe("Analytics Endpoints", () => {
  let server: any;
  let app: any;

  beforeAll(() => {
    server = createElysiaServer(
      {
        ...DEFAULT_SERVER_CONFIG,
        name: "data-intelligence-service-test",
        port: 0,
        websocket: { enabled: false },
      },
      setupFeatureRoutes
    );
    app = server.build();
  });

  it("GET /v1/analytics/overview returns overview metrics", async () => {
    const res = await request(app.handle).get("/v1/analytics/overview");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("totalEvents");
    expect(res.body).toHaveProperty("totalRevenue");
  });

  it("GET /v1/analytics/conversion returns funnel data", async () => {
    const res = await request(app.handle).get("/v1/analytics/conversion");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /v1/analytics/revenue returns revenue attribution", async () => {
    const res = await request(app.handle).get("/v1/analytics/revenue");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /v1/analytics/performance returns model performance", async () => {
    const res = await request(app.handle).get("/v1/analytics/performance");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
