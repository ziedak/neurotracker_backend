import { RouteSetup } from "@libs/elysia-server";

const GATEWAY_URL = process.env.API_GATEWAY_URL || "http://localhost:3000";

async function fetchFromGateway(
  path: string,
  authHeader: string,
  isText = false
) {
  try {
    const res = await fetch(`${GATEWAY_URL}${path}`, {
      method: "GET",
      headers: { Authorization: authHeader },
    });
    if (!res.ok) throw new Error(`Gateway error: ${res.status}`);
    return isText ? await res.text() : await res.json();
  } catch (error) {
    console.error("Dashboard fetch error:", error);
    return {
      error:
        error instanceof Error
          ? error.message
          : typeof error === "string"
          ? error
          : "Unknown error",
    };
  }
}
// Health check endpoint
export const setupDashboardRoutes: RouteSetup = (app) => {
  app.get("/health", () => ({ status: "ok" }));

  // Example: Fetch features and analytics via API Gateway

  app.get("/api/features/:cartId", async ({ params, request }) =>
    fetchFromGateway(
      `/api/data/v1/features/${params.cartId}`,
      request.headers.get("authorization") || ""
    )
  );

  app.get("/api/analytics/overview", async ({ request }) =>
    fetchFromGateway(
      `/api/data/v1/analytics/overview`,
      request.headers.get("authorization") || ""
    )
  );

  // --- User Management ---
  app.get("/api/users", async ({ request }) => {
    // TODO: Fetch users from backend or DB
    return { users: [] };
  });
  app.post("/api/users", async ({ request }) => {
    // TODO: Create user
    return { status: "created" };
  });
  app.put("/api/users/:id", async ({ params, request }) => {
    // TODO: Update user
    return { status: "updated", userId: params.id };
  });
  app.delete("/api/users/:id", async ({ params }) => {
    // TODO: Delete user
    return { status: "deleted", userId: params.id };
  });

  // --- Store Management ---
  app.get("/api/stores", async ({ request }) => {
    // TODO: Fetch stores
    return { stores: [] };
  });
  app.post("/api/stores", async ({ request }) => {
    // TODO: Create store
    return { status: "created" };
  });
  app.put("/api/stores/:id", async ({ params, request }) => {
    // TODO: Update store
    return { status: "updated", storeId: params.id };
  });
  app.delete("/api/stores/:id", async ({ params }) => {
    // TODO: Delete store
    return { status: "deleted", storeId: params.id };
  });

  // --- Store Management: Active Stores ---
  app.get("/api/stores/active", async ({ request }) =>
    fetchFromGateway(
      "/api/data/v1/stores/active",
      request.headers.get("authorization") || ""
    )
  );

  // --- Real-Time Metrics & Notifications ---
  app.get("/api/metrics/live", async ({ request }) => {
    // TODO: Implement real-time metrics (WebSocket or polling)
    return { metrics: { usersOnline: 0, activeCarts: 0 } };
  });
  app.get("/api/notifications", async ({ request }) => {
    // TODO: Fetch notifications
    return { notifications: [] };
  });
  app.post("/api/notifications", async ({ request }) => {
    // TODO: Create notification
    return { status: "created" };
  });

  // --- Analytics & Reporting ---
  app.get(
    "/api/analytics/:type",
    async ({
      params,
      request,
    }: {
      params: { type: string };
      request: Request;
    }) => {
      const { type } = params;
      let data: unknown = {};
      let error: string | null = null;
      try {
        switch (type) {
          case "conversion":
            data = await fetchFromGateway(
              `/api/data/v1/analytics/conversion`,
              request.headers.get("authorization") || ""
            );
            break;
          case "revenue":
            data = await fetchFromGateway(
              `/api/data/v1/analytics/revenue`,
              request.headers.get("authorization") || ""
            );
            break;
          case "performance":
            data = await fetchFromGateway(
              `/api/data/v1/analytics/performance`,
              request.headers.get("authorization") || ""
            );
            break;
          case "retention":
            data = await fetchFromGateway(
              `/api/data/v1/analytics/retention`,
              request.headers.get("authorization") || ""
            );
            break;
          case "anomaly":
            data = await fetchFromGateway(
              `/api/data/v1/analytics/anomaly`,
              request.headers.get("authorization") || ""
            );
            break;
          default:
            error = "Unsupported analytics type";
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
      return error
        ? { error }
        : { type, data, timestamp: new Date().toISOString() };
    }
  );
  app.post("/api/reports", async ({ request }) => {
    try {
      // Example: generate report using ClickHouse
      const reportData = await (
        await import("@libs/database")
      ).ClickHouseClient.execute(
        "SELECT eventType, count(*) as count FROM user_events GROUP BY eventType"
      );
      // No Report model in Prisma schema; just return the report data
      return { status: "report_generated", report: reportData };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });
  app.get("/api/reports/:id/download", async ({ params, request }) => {
    // TODO: Download report
    return { status: "downloaded", reportId: params.id };
  });

  // --- Quality & Compliance ---
  app.get("/api/quality/alerts", async ({ request }) => {
    // TODO: Fetch data quality alerts
    return { alerts: [] };
  });
  app.post("/api/compliance/gdpr", async ({ request }) => {
    // TODO: Submit GDPR request
    return { status: "gdpr_requested" };
  });
  app.get("/api/compliance/gdpr/status", async ({ request }) => {
    // TODO: Fetch GDPR request status
    return { status: "completed" };
  });

  // --- Monitoring & Settings ---
  app.get("/api/monitoring", async ({ request }) => {
    // TODO: Fetch service metrics/logs
    return { metrics: {}, logs: [] };
  });
  app.get("/api/settings", async ({ request }) => {
    // TODO: Fetch dashboard settings
    return { settings: {} };
  });
  app.put("/api/settings", async ({ request }) => {
    // TODO: Update dashboard settings
    return { status: "updated" };
  });

  // --- API Documentation ---
  app.get("/api/docs", () => {
    // TODO: Serve OpenAPI/Swagger docs
    return { docs: "Dashboard API documentation (stub)" };
  });
  // Reporting endpoint (single definition, uses fetchFromGateway and GATEWAY_URL)
  app.get(
    "/api/reports/:id",
    async ({ params, request }: { params: { id: string }; request: Request }) =>
      fetchFromGateway(
        `/api/data/v1/reports/${params.id}`,
        request.headers.get("authorization") || ""
      )
  );

  app.get(
    "/api/export/:type",
    async ({
      params,
      request,
    }: {
      params: { type: string };
      request: Request;
    }) => {
      if (!["csv", "json"].includes(params.type)) {
        return { error: "Unsupported export type" };
      }
      return fetchFromGateway(
        `/api/data/v1/export/${params.type}`,
        request.headers.get("authorization") || "",
        params.type === "csv"
      );
    }
  );

  app.get("/dashboard/metrics", () => {
    return {
      metrics: {
        users: 0,
        events: 0,
        revenue: 0,
      },
      message: "Dashboard metrics endpoint (stub)",
    };
  });

  // --- Admin API ---
  app.get("/api/admin/overview", async ({ request }) =>
    fetchFromGateway(
      "/api/data/v1/admin/overview",
      request.headers.get("authorization") || ""
    )
  );

  // --- Analytics Dashboard ---
  app.get("/api/analytics/dashboard", async ({ request }) =>
    fetchFromGateway(
      "/api/data/v1/analytics/dashboard",
      request.headers.get("authorization") || ""
    )
  );

  // --- UI Configuration Endpoint ---
  app.get("/api/ui/config", async ({ request }) =>
    fetchFromGateway(
      "/api/data/v1/ui/config",
      request.headers.get("authorization") || ""
    )
  );

  // TODO: Add more endpoints for reporting, export, UI, etc.

  return app;
};
