import { Elysia, t } from "elysia";
import { Elysia } from "elysia";
import { node } from "@elysiajs/node";
import { UserEvent } from "@libs/models";
import { getEnv } from "@libs/config";

const app = new Elysia({ adapter: node() });

import { RedisClient } from "@shared/database";
import { createJWTPlugin, requireAuth } from "@shared/auth";
// import { Prediction } from '@shared/types';

// ML Model interface
interface MLModel {
  predict(features: Record<string, number>): Promise<Prediction>;
  getVersion(): string;
  isLoaded(): boolean;
}

// Feature schemas
const PredictionRequestSchema = t.Object({
  cartId: t.String({ format: "uuid" }),
  features: t.Optional(t.Record(t.String(), t.Number())),
  modelVersion: t.Optional(t.String()),
});

const BatchPredictionSchema = t.Object({
  requests: t.Array(PredictionRequestSchema, { maxItems: 500 }),
});

const app = new Elysia()
  .use(cors())
  .use(
    swagger({
      documentation: {
        info: {
          title: "AI Engine Service",
          version: "2.0.0",
        },
      },
    })
  )
  .use(
    rateLimit({
      duration: 60000,
      max: 5000, // 5k predictions per minute
    })
  )
  .use(createJWTPlugin());

// Model registry
const models = new Map<string, MLModel>();
let defaultModel: MLModel;

// Initialize models on startup
initializeModels();

// Health check with model status
app.get("/health", async () => {
  const modelStatuses = Array.from(models.entries()).map(
    ([version, model]) => ({
      version,
      loaded: model.isLoaded(),
    })
  );

  return {
    status: "ok",
    models: modelStatuses,
    defaultModel: defaultModel?.getVersion(),
    uptime: process.uptime(),
  };
});

// Single prediction endpoint
app.post(
  "/predict",
  async ({ body, jwt, set }) => {
    const payload = await requireAuth({ jwt, set });

    try {
      const { cartId, features, modelVersion } = body;

      // Check cache first
      const cacheKey = `prediction:${cartId}:${modelVersion || "default"}`;
      const redis = RedisClient.getInstance();
      const cached = await redis.get(cacheKey);

      if (cached) {
        return JSON.parse(cached);
      }

      // Get or compute features
      const computedFeatures = features || (await computeFeatures(cartId));

      // Get model
      const model = modelVersion ? models.get(modelVersion) : defaultModel;
      if (!model) {
        set.status = 400;
        return { error: `Model ${modelVersion || "default"} not available` };
      }

      // Make prediction
      const prediction = await model.predict(computedFeatures);

      // Cache result for 5 minutes
      await redis.setex(cacheKey, 300, JSON.stringify(prediction));

      return prediction;
    } catch (error) {
      set.status = 500;
      return { error: error.message };
    }
  },
  {
    body: PredictionRequestSchema,
    response: {
      200: t.Object({
        cartId: t.String(),
        probability: t.Number({ minimum: 0, maximum: 1 }),
        confidence: t.Number({ minimum: 0, maximum: 1 }),
        recommendedAction: t.String(),
        recommendedDiscount: t.Optional(t.Number()),
        reasoning: t.Array(t.String()),
        modelVersion: t.String(),
        computedAt: t.String(),
      }),
    },
  }
);

// Batch predictions for high throughput
app.post(
  "/predict/batch",
  async ({ body, jwt, set }) => {
    const payload = await requireAuth({ jwt, set });

    try {
      const startTime = Date.now();

      // Process predictions in parallel
      const results = await Promise.allSettled(
        body.requests.map(async (request) => {
          const features =
            request.features || (await computeFeatures(request.cartId));
          const model = request.modelVersion
            ? models.get(request.modelVersion)
            : defaultModel;

          if (!model) {
            throw new Error(
              `Model ${request.modelVersion || "default"} not available`
            );
          }

          return await model.predict(features);
        })
      );

      const successful = results
        .filter((r) => r.status === "fulfilled")
        .map((r) => (r as any).value);

      const failed = results
        .filter((r) => r.status === "rejected")
        .map((r, index) => ({
          cartId: body.requests[index].cartId,
          error: (r as any).reason.message,
        }));

      return {
        predictions: successful,
        errors: failed,
        processed: successful.length,
        failed: failed.length,
        processingTime: Date.now() - startTime,
      };
    } catch (error) {
      set.status = 500;
      return { error: error.message };
    }
  },
  {
    body: BatchPredictionSchema,
  }
);

// Feature computation endpoint
app.post(
  "/features",
  async ({ body, jwt, set }) => {
    const payload = await requireAuth({ jwt, set });

    try {
      const features = await computeFeatures(body.cartId);
      return { cartId: body.cartId, features };
    } catch (error) {
      set.status = 500;
      return { error: error.message };
    }
  },
  {
    body: t.Object({
      cartId: t.String({ format: "uuid" }),
    }),
  }
);

// Model management endpoints
app.get("/models", async ({ jwt, set }) => {
  await requireAuth({ jwt, set });

  const modelList = Array.from(models.entries()).map(([version, model]) => ({
    version,
    loaded: model.isLoaded(),
    isDefault: model === defaultModel,
  }));

  return { models: modelList };
});

app.post("/models/:version/load", async ({ params, jwt, set }) => {
  const payload = await requireAuth({ jwt, set });

  // Only admins can load models
  if (payload.role !== "admin") {
    set.status = 403;
    return { error: "Admin access required" };
  }

  try {
    await loadModel(params.version);
    return { status: "loaded", version: params.version };
  } catch (error) {
    set.status = 500;
    return { error: error.message };
  }
});

// Feature computation function
async function computeFeatures(
  cartId: string
): Promise<Record<string, number>> {
  const redis = RedisClient.getInstance();

  // Get cart data
  const cartData = await redis.hgetall(`cart:${cartId}`);
  if (!cartData) {
    throw new Error(`Cart ${cartId} not found`);
  }

  // Get user history
  const userHistory = await redis.get(`user_history:${cartData.userId}`);
  const history = userHistory ? JSON.parse(userHistory) : {};

  // Compute time-based features
  const abandonedAt = new Date(cartData.abandonedAt || Date.now());
  const timeSinceAbandonment =
    (Date.now() - abandonedAt.getTime()) / (1000 * 60); // minutes

  // Compute cart features
  const cartValue = parseFloat(cartData.totalValue || "0");
  const itemCount = parseInt(cartData.itemCount || "0");
  const averageItemPrice = itemCount > 0 ? cartValue / itemCount : 0;

  // Compute user features
  const previousPurchases = history.purchaseCount || 0;
  const averageOrderValue = history.totalSpent / Math.max(previousPurchases, 1);
  const daysSinceLastPurchase = history.lastPurchase
    ? (Date.now() - new Date(history.lastPurchase).getTime()) /
      (1000 * 60 * 60 * 24)
    : 999;

  return {
    // Time features
    timeSinceAbandonment,
    hourOfDay: abandonedAt.getHours(),
    dayOfWeek: abandonedAt.getDay(),

    // Cart features
    cartValue,
    itemCount,
    averageItemPrice,
    cartValueBucket: Math.floor(cartValue / 50), // $50 buckets

    // User features
    previousPurchases,
    averageOrderValue,
    daysSinceLastPurchase,
    isReturningCustomer: previousPurchases > 0 ? 1 : 0,

    // Behavioral features
    pageViews: parseInt(cartData.pageViews || "0"),
    timeOnSite: parseInt(cartData.timeOnSite || "0"),
    referrerType: getReferrerTypeCode(cartData.referrer),
    deviceType: getDeviceTypeCode(cartData.deviceType),

    // Seasonal features
    isWeekend: [0, 6].includes(abandonedAt.getDay()) ? 1 : 0,
    isHoliday: (await isHolidayPeriod(abandonedAt)) ? 1 : 0,
  };
}

// Simple ML Model implementation (placeholder for real ML model)
class SimpleCartRecoveryModel implements MLModel {
  private version: string;
  private loaded: boolean = false;

  constructor(version: string) {
    this.version = version;
    this.load();
  }

  async load(): Promise<void> {
    // Simulate model loading
    await new Promise((resolve) => setTimeout(resolve, 1000));
    this.loaded = true;
  }

  async predict(features: Record<string, number>): Promise<any> {
    // async predict(features: Record<string, number>): Promise<Prediction> {
    if (!this.loaded) {
      throw new Error("Model not loaded");
    }

    // Simple rule-based prediction (replace with real ML model)
    let probability = 0.1; // Base probability
    const reasoning: string[] = [];

    // Time-based factors
    if (features.timeSinceAbandonment < 30) {
      probability += 0.3;
      reasoning.push("Recent abandonment increases conversion likelihood");
    } else if (features.timeSinceAbandonment > 1440) {
      // 24 hours
      probability -= 0.2;
      reasoning.push("Long time since abandonment reduces likelihood");
    }

    // Cart value factors
    if (features.cartValue > 100) {
      probability += 0.2;
      reasoning.push("High cart value increases motivation");
    }

    if (features.cartValue < 25) {
      probability -= 0.1;
      reasoning.push("Low cart value reduces urgency");
    }

    // User history factors
    if (features.isReturningCustomer === 1) {
      probability += 0.25;
      reasoning.push("Returning customer more likely to convert");
    }

    if (features.previousPurchases > 3) {
      probability += 0.15;
      reasoning.push("Loyal customer with purchase history");
    }

    // Behavioral factors
    if (features.timeOnSite > 300) {
      // 5 minutes
      probability += 0.1;
      reasoning.push("High engagement time indicates interest");
    }

    // Timing factors
    if (
      features.isWeekend === 0 &&
      features.hourOfDay >= 9 &&
      features.hourOfDay <= 17
    ) {
      probability += 0.1;
      reasoning.push("Business hours optimal for engagement");
    }

    // Cap probability between 0 and 1
    probability = Math.max(0, Math.min(1, probability));

    // Determine recommended action
    let recommendedAction = "none";
    let recommendedDiscount = 0;

    if (probability > 0.7) {
      recommendedAction = "reminder";
      reasoning.push("High probability - simple reminder should work");
    } else if (probability > 0.4) {
      recommendedAction = "discount";
      recommendedDiscount = features.cartValue > 100 ? 10 : 15;
      reasoning.push(
        `Medium probability - ${recommendedDiscount}% discount recommended`
      );
    } else if (probability > 0.2) {
      recommendedAction = "urgency";
      reasoning.push("Low-medium probability - urgency message may help");
    }

    return {
      cartId: "computed", // Will be set by caller
      probability,
      confidence: Math.min(0.9, probability + 0.1), // Simple confidence calculation
      recommendedAction,
      recommendedDiscount:
        recommendedDiscount > 0 ? recommendedDiscount : undefined,
      reasoning,
      modelVersion: this.version,
      computedAt: new Date().toISOString(),
    };
  }

  getVersion(): string {
    return this.version;
  }

  isLoaded(): boolean {
    return this.loaded;
  }
}

// Helper functions
function getReferrerTypeCode(referrer?: string): number {
  if (!referrer) return 0;
  if (referrer.includes("google")) return 1;
  if (referrer.includes("facebook")) return 2;
  if (referrer.includes("instagram")) return 3;
  if (referrer.includes("email")) return 4;
  return 5; // Other
}

function getDeviceTypeCode(deviceType?: string): number {
  switch (deviceType?.toLowerCase()) {
    case "mobile":
      return 1;
    case "tablet":
      return 2;
    case "desktop":
      return 3;
    default:
      return 0;
  }
}

async function isHolidayPeriod(date: Date): Promise<boolean> {
  // Simple holiday detection (extend with real holiday API)
  const month = date.getMonth();
  const day = date.getDate();

  // Black Friday week (last week of November)
  if (month === 10 && day >= 23) return true;

  // December holiday season
  if (month === 11) return true;

  // Valentine's Day period
  if (month === 1 && day >= 10 && day <= 16) return true;

  return false;
}

// Model initialization
async function initializeModels() {
  console.log("🤖 Loading ML models...");

  // Load default model
  defaultModel = new SimpleCartRecoveryModel("v1.0");
  models.set("v1.0", defaultModel);

  // Load additional models
  models.set("v1.1-beta", new SimpleCartRecoveryModel("v1.1-beta"));

  console.log("✅ Models loaded successfully");
}

async function loadModel(version: string): Promise<void> {
  if (models.has(version)) {
    throw new Error(`Model ${version} already loaded`);
  }

  const model = new SimpleCartRecoveryModel(version);
  models.set(version, model);

  console.log(`✅ Model ${version} loaded`);
}

// Start server
app.listen(3002, () => {
  console.log("🚀 AI Engine Service running on port 3002");
});

export default app;
