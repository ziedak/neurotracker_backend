import { RedisClient } from "@libs/database";
import { Logger } from "@libs/monitoring";
import { InterventionMetrics, UserJourney, ConversionEvent } from "./types";

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
  private redis: any;

  constructor(redis: any, private logger: Logger) {
    this.redis = redis || RedisClient.getInstance();
  }

  async calculateConversionRate(
    campaignId: string,
    storeId: string,
    timeframe: { start: Date; end: Date }
  ): Promise<number> {
    try {
      const startTs = timeframe.start.getTime();
      const endTs = timeframe.end.getTime();

      // Get total interventions sent
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
    } catch (error) {
      this.logger.error("Failed to calculate conversion rate", error as Error);
      throw error;
    }
  }

  async calculateROI(
    campaignId: string,
    storeId: string,
    timeframe: { start: Date; end: Date }
  ): Promise<number> {
    try {
      const startTs = timeframe.start.getTime();
      const endTs = timeframe.end.getTime();

      // Get campaign revenue
      const revenueKey = `metrics:campaign:${campaignId}:store:${storeId}:revenue`;
      const costKey = `metrics:campaign:${campaignId}:store:${storeId}:cost`;

      const pipeline = this.redis.pipeline();

      // Sum revenue in timeframe
      pipeline.eval(
        `
        local key = KEYS[1]
        local startTime = tonumber(ARGV[1])
        local endTime = tonumber(ARGV[2])
        
        local members = redis.call('ZRANGEBYSCORE', key, startTime, endTime, 'WITHSCORES')
        local total = 0
        
        for i = 2, #members, 2 do
          total = total + tonumber(members[i])
        end
        
        return total
      `,
        1,
        revenueKey,
        startTs,
        endTs
      );

      // Sum costs in timeframe
      pipeline.eval(
        `
        local key = KEYS[1]
        local startTime = tonumber(ARGV[1])
        local endTime = tonumber(ARGV[2])
        
        local members = redis.call('ZRANGEBYSCORE', key, startTime, endTime, 'WITHSCORES')
        local total = 0
        
        for i = 2, #members, 2 do
          total = total + tonumber(members[i])
        end
        
        return total
      `,
        1,
        costKey,
        startTs,
        endTs
      );

      const results = await pipeline.exec();
      const revenue = (results?.[0]?.[1] as number) || 0;
      const cost = (results?.[1]?.[1] as number) || 0;

      if (cost === 0) return revenue > 0 ? Infinity : 0;

      return ((revenue - cost) / cost) * 100;
    } catch (error) {
      this.logger.error("Failed to calculate ROI", error as Error);
      throw error;
    }
  }

  async getChannelPerformance(
    storeId: string,
    timeframe: { start: Date; end: Date }
  ): Promise<ChannelPerformance[]> {
    try {
      const channels = ["email", "sms", "push", "websocket"];
      const performance: ChannelPerformance[] = [];

      for (const channel of channels) {
        const channelMetrics = await this.getChannelMetrics(
          storeId,
          channel,
          timeframe
        );
        performance.push(channelMetrics);
      }

      return performance;
    } catch (error) {
      this.logger.error("Failed to get channel performance", error as Error);
      throw error;
    }
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

    // Sum revenue and cost
    pipeline.eval(
      `
      local key = KEYS[1]
      local startTime = tonumber(ARGV[1])
      local endTime = tonumber(ARGV[2])
      
      local members = redis.call('ZRANGEBYSCORE', key, startTime, endTime, 'WITHSCORES')
      local total = 0
      
      for i = 2, #members, 2 do
        total = total + tonumber(members[i])
      end
      
      return total
    `,
      1,
      revenueKey,
      startTs,
      endTs
    );

    pipeline.eval(
      `
      local key = KEYS[1]
      local startTime = tonumber(ARGV[1])
      local endTime = tonumber(ARGV[2])
      
      local members = redis.call('ZRANGEBYSCORE', key, startTime, endTime, 'WITHSCORES')
      local total = 0
      
      for i = 2, #members, 2 do
        total = total + tonumber(members[i])
      end
      
      return total
    `,
      1,
      costKey,
      startTs,
      endTs
    );

    const results = await pipeline.exec();

    const impressions = (results?.[0]?.[1] as number) || 0;
    const opens = (results?.[1]?.[1] as number) || 0;
    const clicks = (results?.[2]?.[1] as number) || 0;
    const conversions = (results?.[3]?.[1] as number) || 0;
    const revenue = (results?.[4]?.[1] as number) || 0;
    const cost = (results?.[5]?.[1] as number) || 0;

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

  async getCohortAnalysis(
    storeId: string,
    timeframe: { start: Date; end: Date }
  ): Promise<CohortAnalysis> {
    try {
      // Simplified cohort analysis - group users by week/month of first intervention
      const cohorts: CohortData[] = [];
      const retentionRates: number[][] = [];
      const averageOrderValue: number[] = [];

      // This would require more complex Redis operations or additional data structures
      // For now, returning a placeholder structure

      return {
        cohorts,
        retentionRates,
        averageOrderValue,
      };
    } catch (error) {
      this.logger.error("Failed to get cohort analysis", error as Error);
      throw error;
    }
  }

  async getFunnelAnalysis(
    campaignId: string,
    storeId: string
  ): Promise<FunnelStep[]> {
    try {
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
    } catch (error) {
      this.logger.error("Failed to get funnel analysis", error as Error);
      throw error;
    }
  }

  async getABTestResults(
    testId: string,
    storeId: string
  ): Promise<ABTestResults> {
    try {
      const testKey = `abtest:${testId}:store:${storeId}`;
      const testData = await this.redis.hgetall(testKey);

      if (!testData.variants) {
        throw new Error(`AB test ${testId} not found`);
      }

      const variantIds = JSON.parse(testData.variants);
      const variants: ABTestVariant[] = [];

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

      // Simple statistical significance calculation
      const { significance, winner, confidence } =
        this.calculateStatisticalSignificance(variants);

      return {
        testId,
        variants,
        statisticalSignificance: significance,
        winner,
        confidence,
      };
    } catch (error) {
      this.logger.error("Failed to get AB test results", error as Error);
      throw error;
    }
  }

  private calculateStatisticalSignificance(variants: ABTestVariant[]): {
    significance: number;
    winner: string | null;
    confidence: number;
  } {
    if (variants.length < 2) {
      return { significance: 0, winner: null, confidence: 0 };
    }

    // Simplified chi-square test approximation
    // In production, would use proper statistical libraries

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

    // Approximate p-value from z-score
    const pValue = 2 * (1 - this.normalCDF(Math.abs(zScore)));
    const significance = (1 - pValue) * 100;

    const winner =
      variantA.conversionRate > variantB.conversionRate
        ? variantA.variantId
        : variantB.variantId;
    const confidence = significance;

    return { significance, winner, confidence };
  }

  private normalCDF(x: number): number {
    // Approximation of normal cumulative distribution function
    return 0.5 * (1 + this.erf(x / Math.sqrt(2)));
  }

  private erf(x: number): number {
    // Approximation of error function
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

// Service implementation complete
