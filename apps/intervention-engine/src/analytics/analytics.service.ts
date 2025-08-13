import { RedisClient } from "@libs/database";
import { Logger } from "@libs/monitoring";
import {
  InterventionMetrics,
  UserJourney,
  ConversionEvent,
} from "../tracking/types";

// DTOs for AB Test Results
export type ABTestVariantDTO = {
  variantId: string;
  name: string;
  users: number;
  conversions: number;
  conversionRate: number;
  revenue: number;
  averageOrderValue: number;
};

export type ABTestResultsDTO = {
  testId: string;
  variants: ABTestVariantDTO[];
  statisticalSignificance: number;
  winner: string | null;
  confidence: number;
};

// Statistical utility class
class ABTestStatistics {
  static calculateStatisticalSignificance(variants: ABTestVariantDTO[]): {
    significance: number;
    winner: string | null;
    confidence: number;
  } {
    if (variants.length < 2) {
      return { significance: 0, winner: null, confidence: 0 };
    }
    const [variantA, variantB] = variants;
    const totalA = variantA.users;
    const successA = variantA.conversions;
    const totalB = variantB.users;
    const successB = variantB.conversions;
    if (totalA < 100 || totalB < 100) {
      return { significance: 0, winner: null, confidence: 0 };
    }
    const pooledRate = (successA + successB) / (totalA + totalB);
    const standardError = Math.sqrt(
      pooledRate * (1 - pooledRate) * (1 / totalA + 1 / totalB)
    );
    const zScore =
      Math.abs((variantA.conversionRate - variantB.conversionRate) / 100) /
      standardError;
    const pValue = 2 * (1 - ABTestStatistics.normalCDF(Math.abs(zScore)));
    const significance = (1 - pValue) * 100;
    const winner =
      variantA.conversionRate > variantB.conversionRate
        ? variantA.variantId
        : variantB.variantId;
    const confidence = significance;
    return { significance, winner, confidence };
  }
  static normalCDF(x: number): number {
    return 0.5 * (1 + ABTestStatistics.erf(x / Math.sqrt(2)));
  }
  static erf(x: number): number {
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;
    const sign = x >= 0 ? 1 : -1;
    x = Math.abs(x);
    const t = 1.0 / (1.0 + p * x);
    const y =
      1.0 -
      ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return sign * y;
  }
}

export interface AnalyticsService {
  calculateConversionRate(
    campaignId: string,
    storeId: string,
    timeframe: { start: Date; end: Date }
  ): Promise<number>;
  calculateROI(
    campaignId: string,
    storeId: string,
    timeframe: { start: Date; end: Date }
  ): Promise<number>;
  getChannelPerformance(
    storeId: string,
    timeframe: { start: Date; end: Date }
  ): Promise<ChannelPerformance[]>;
  getCohortAnalysis(
    storeId: string,
    timeframe: { start: Date; end: Date }
  ): Promise<CohortAnalysis>;
  getFunnelAnalysis(campaignId: string, storeId: string): Promise<FunnelStep[]>;
  getABTestResults(testId: string, storeId: string): Promise<ABTestResults>;
}

export interface ChannelPerformance {
  channel: string;
  impressions: number;
  opens: number;
  clicks: number;
  conversions: number;
  revenue: number;
  conversionRate: number;
  costPerConversion: number;
}

export interface CohortAnalysis {
  cohorts: CohortData[];
  retentionRates: number[][];
  averageOrderValue: number[];
}

export interface CohortData {
  cohortPeriod: string;
  userCount: number;
  totalRevenue: number;
  averageRevenue: number;
}

export interface FunnelStep {
  step: string;
  users: number;
  conversionRate: number;
  dropoffRate: number;
}

export interface ABTestResults {
  testId: string;
  variants: ABTestVariant[];
  statisticalSignificance: number;
  winner: string | null;
  confidence: number;
}

export interface ABTestVariant {
  variantId: string;
  name: string;
  users: number;
  conversions: number;
  conversionRate: number;
  revenue: number;
  averageOrderValue: number;
}

export class RedisAnalyticsService implements AnalyticsService {
  /**
   * Returns cohort analysis for a store and timeframe.
   * Groups users by week of first intervention, calculates retention and average order value.
   */
  async getCohortAnalysis(
    storeId: string,
    timeframe: { start: Date; end: Date }
  ): Promise<CohortAnalysis> {
    return this.handle(async () => {
      // Get all users with first intervention in timeframe
      const startTs = timeframe.start.getTime();
      const endTs = timeframe.end.getTime();
      const userKey = `cohort:store:${storeId}:first_intervention`;
      // Assume: ZSET userKey: member=userId, score=firstInterventionTs
      const userEntries = await this.redis.zrangebyscore(
        userKey,
        startTs,
        endTs,
        "WITHSCORES"
      );
      // Group users by week
      const cohorts: CohortData[] = [];
      const cohortMap: Record<string, string[]> = {};
      for (let i = 0; i < userEntries.length; i += 2) {
        const userId = userEntries[i];
        const ts = parseInt(userEntries[i + 1], 10);
        const week = new Date(ts);
        const yearWeek = `${week.getFullYear()}-W${Math.ceil(
          (week.getDate() + 6) / 7
        )}`;
        if (!cohortMap[yearWeek]) cohortMap[yearWeek] = [];
        cohortMap[yearWeek].push(userId);
      }
      // For each cohort, calculate stats
      for (const period of Object.keys(cohortMap)) {
        const users = cohortMap[period];
        // Total revenue for cohort
        let totalRevenue = 0;
        for (const userId of users) {
          const revenueKey = `user:${userId}:store:${storeId}:revenue`;
          const userRevenue = await this.redis.get(revenueKey);
          totalRevenue += parseFloat(userRevenue || "0");
        }
        cohorts.push({
          cohortPeriod: period,
          userCount: users.length,
          totalRevenue,
          averageRevenue: users.length > 0 ? totalRevenue / users.length : 0,
        });
      }
      // Retention: for each cohort, get % of users active in subsequent weeks
      const retentionRates: number[][] = [];
      const averageOrderValue: number[] = [];
      for (const cohort of cohorts) {
        const rates: number[] = [];
        for (let weekOffset = 0; weekOffset < 4; weekOffset++) {
          let retained = 0;
          for (const userId of cohortMap[cohort.cohortPeriod]) {
            const activeKey = `user:${userId}:store:${storeId}:active_week_${weekOffset}`;
            const isActive = await this.redis.get(activeKey);
            if (isActive === "1") retained++;
          }
          rates.push(
            cohort.userCount > 0 ? (retained / cohort.userCount) * 100 : 0
          );
        }
        retentionRates.push(rates);
        // Average order value for cohort
        let totalOrders = 0;
        let totalOrderValue = 0;
        for (const userId of cohortMap[cohort.cohortPeriod]) {
          const ordersKey = `user:${userId}:store:${storeId}:orders`;
          const orders = await this.redis.lrange(ordersKey, 0, -1);
          for (const order of orders) {
            totalOrders++;
            totalOrderValue += parseFloat(order);
          }
        }
        averageOrderValue.push(
          totalOrders > 0 ? totalOrderValue / totalOrders : 0
        );
      }
      return {
        cohorts,
        retentionRates,
        averageOrderValue,
      };
    }, "get cohort analysis");
  }
  /**
   * Returns funnel analysis for a campaign/store.
   */
  async getFunnelAnalysis(
    campaignId: string,
    storeId: string
  ): Promise<FunnelStep[]> {
    return this.handle(async () => {
      const funnelSteps = [
        "intervention_triggered",
        "intervention_delivered",
        "intervention_opened",
        "intervention_clicked",
        "intervention_converted",
      ];
      const steps: FunnelStep[] = [];
      let previousCount = 0;
      for (let i = 0; i < funnelSteps.length; i++) {
        const stepKey = `funnel:campaign:${campaignId}:store:${storeId}:${funnelSteps[i]}`;
        const count = await this.redis.scard(stepKey);
        const conversionRate =
          i === 0 ? 100 : previousCount > 0 ? (count / previousCount) * 100 : 0;
        const dropoffRate = 100 - conversionRate;
        steps.push({
          step: funnelSteps[i],
          users: count,
          conversionRate,
          dropoffRate,
        });
        previousCount = count;
      }
      return steps;
    }, "get funnel analysis");
  }
  /**
   * Redis client instance
   */
  private redis: any;
  /**
   * Configurable list of supported channels
   */
  private channels: string[];

  constructor(redis: any, private logger: Logger) {
    this.redis = redis || RedisClient.getInstance();
    this.channels = ["email", "sms", "push", "websocket"];
  }

  /**
   * Set supported channels (for extensibility)
   */
  setChannels(channels: string[]) {
    this.channels = channels;
  }

  /**
   * Centralized error handler for analytics methods
   */
  private async handle<T>(fn: () => Promise<T>, context: string): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      this.logger.error(`Failed to ${context}`, error as Error);
      throw error;
    }
  }

  /**
   * DRY: Sum scores in a Redis sorted set using Lua script
   */
  private async sumScores(
    key: string,
    startTs: number,
    endTs: number
  ): Promise<number> {
    const luaScript = `
      local key = KEYS[1]
      local startTime = tonumber(ARGV[1])
      local endTime = tonumber(ARGV[2])
      local members = redis.call('ZRANGEBYSCORE', key, startTime, endTime, 'WITHSCORES')
      local total = 0
      for i = 2, #members, 2 do
        total = total + tonumber(members[i])
      end
      return total
    `;
    const result = await this.redis.eval(luaScript, 1, key, startTs, endTs);
    return typeof result === "number" ? result : 0;
  }

  async calculateConversionRate(
    campaignId: string,
    storeId: string,
    timeframe: { start: Date; end: Date }
  ): Promise<number> {
    return this.handle(async () => {
      const startTs = timeframe.start.getTime();
      const endTs = timeframe.end.getTime();
      const totalKey = `metrics:campaign:${campaignId}:store:${storeId}:total`;
      const conversionsKey = `metrics:campaign:${campaignId}:store:${storeId}:conversions`;
      const pipeline = this.redis.pipeline();
      pipeline.zcount(totalKey, startTs, endTs);
      pipeline.zcount(conversionsKey, startTs, endTs);
      const results = await pipeline.exec();
      const totalInterventions = (results?.[0]?.[1] as number) || 0;
      const conversions = (results?.[1]?.[1] as number) || 0;
      if (totalInterventions === 0) return 0;
      return (conversions / totalInterventions) * 100;
    }, "calculate conversion rate");
  }

  async calculateROI(
    campaignId: string,
    storeId: string,
    timeframe: { start: Date; end: Date }
  ): Promise<number> {
    return this.handle(async () => {
      const startTs = timeframe.start.getTime();
      const endTs = timeframe.end.getTime();
      const revenueKey = `metrics:campaign:${campaignId}:store:${storeId}:revenue`;
      const costKey = `metrics:campaign:${campaignId}:store:${storeId}:cost`;
      const revenue = await this.sumScores(revenueKey, startTs, endTs);
      const cost = await this.sumScores(costKey, startTs, endTs);
      if (cost === 0) return revenue > 0 ? Infinity : 0;
      return ((revenue - cost) / cost) * 100;
    }, "calculate ROI");
  }

  async getChannelPerformance(
    storeId: string,
    timeframe: { start: Date; end: Date }
  ): Promise<ChannelPerformance[]> {
    return this.handle(async () => {
      const performance: ChannelPerformance[] = [];
      for (const channel of this.channels) {
        const channelMetrics = await this.getChannelMetrics(
          storeId,
          channel,
          timeframe
        );
        performance.push(channelMetrics);
      }
      return performance;
    }, "get channel performance");
  }

  private async getChannelMetrics(
    storeId: string,
    channel: string,
    timeframe: { start: Date; end: Date }
  ): Promise<ChannelPerformance> {
    const startTs = timeframe.start.getTime();
    const endTs = timeframe.end.getTime();
    const impressionsKey = `metrics:channel:${channel}:store:${storeId}:impressions`;
    const opensKey = `metrics:channel:${channel}:store:${storeId}:opens`;
    const clicksKey = `metrics:channel:${channel}:store:${storeId}:clicks`;
    const conversionsKey = `metrics:channel:${channel}:store:${storeId}:conversions`;
    const revenueKey = `metrics:channel:${channel}:store:${storeId}:revenue`;
    const costKey = `metrics:channel:${channel}:store:${storeId}:cost`;
    const pipeline = this.redis.pipeline();
    pipeline.zcount(impressionsKey, startTs, endTs);
    pipeline.zcount(opensKey, startTs, endTs);
    pipeline.zcount(clicksKey, startTs, endTs);
    pipeline.zcount(conversionsKey, startTs, endTs);
    const results = await pipeline.exec();
    const impressions = (results?.[0]?.[1] as number) || 0;
    const opens = (results?.[1]?.[1] as number) || 0;
    const clicks = (results?.[2]?.[1] as number) || 0;
    const conversions = (results?.[3]?.[1] as number) || 0;
    const revenue = await this.sumScores(revenueKey, startTs, endTs);
    const cost = await this.sumScores(costKey, startTs, endTs);
    const conversionRate =
      impressions > 0 ? (conversions / impressions) * 100 : 0;
    const costPerConversion = conversions > 0 ? cost / conversions : 0;
    return {
      channel,
      impressions,
      opens,
      clicks,
      conversions,
      revenue,
      conversionRate,
      costPerConversion,
    };
  }

  async getABTestResults(
    testId: string,
    storeId: string
  ): Promise<ABTestResultsDTO> {
    return this.handle(async () => {
      const testKey = `abtest:${testId}:store:${storeId}`;
      const testData = await this.redis.hgetall(testKey);
      if (!testData.variants) {
        throw new Error(`AB test ${testId} not found`);
      }
      const variantIds = JSON.parse(testData.variants);
      const variants: ABTestVariantDTO[] = [];
      for (const variantId of variantIds) {
        const variantKey = `abtest:${testId}:variant:${variantId}:store:${storeId}`;
        const variantData = await this.redis.hgetall(variantKey);
        const users = parseInt(variantData.users || "0");
        const conversions = parseInt(variantData.conversions || "0");
        const revenue = parseFloat(variantData.revenue || "0");
        variants.push({
          variantId,
          name: variantData.name || variantId,
          users,
          conversions,
          conversionRate: users > 0 ? (conversions / users) * 100 : 0,
          revenue,
          averageOrderValue: conversions > 0 ? revenue / conversions : 0,
        });
      }
      // Use extracted statistical logic
      const { significance, winner, confidence } =
        ABTestStatistics.calculateStatisticalSignificance(variants);
      return {
        testId,
        variants,
        statisticalSignificance: significance,
        winner,
        confidence,
      };
    }, "get AB test results");
  }


}

// Service implementation complete
