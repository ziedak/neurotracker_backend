export interface IMetricsService {
  getCampaignMetrics(
    campaignId: string,
    storeId: string
  ): Promise<CampaignMetrics>;
  updateCampaignMetrics(
    campaignId: string,
    storeId: string,
    metrics: Partial<CampaignMetrics>
  ): Promise<void>;
  assignVariant(
    campaignId: string,
    userId: string,
    campaign: Campaign
  ): Promise<string>;
  getVariantPerformance(
    campaignId: string
  ): Promise<Record<string, CampaignMetrics>>;
}
import { Redis } from "ioredis";
import { Logger } from "@libs/monitoring";
import { CampaignMetrics, Campaign } from "./types";

export class MetricsService {
  private redis: Redis;
  private logger: Logger;

  constructor(redis: Redis, logger: Logger) {
    this.redis = redis;
    this.logger = logger;
  }

  async getCampaignMetrics(
    campaignId: string,
    storeId: string
  ): Promise<CampaignMetrics> {
    const data = await this.redis.hget(
      `campaign:metrics:${storeId}`,
      campaignId
    );
    if (!data) {
      return {
        campaignId,
        impressions: 0,
        opens: 0,
        clicks: 0,
        conversions: 0,
        revenue: 0,
        cost: 0,
        roi: 0,
        conversionRate: 0,
        clickThroughRate: 0,
        openRate: 0,
        channelBreakdown: {
          email: {
            impressions: 0,
            opens: 0,
            clicks: 0,
            conversions: 0,
            revenue: 0,
            cost: 0,
          },
          sms: {
            impressions: 0,
            opens: 0,
            clicks: 0,
            conversions: 0,
            revenue: 0,
            cost: 0,
          },
          push: {
            impressions: 0,
            opens: 0,
            clicks: 0,
            conversions: 0,
            revenue: 0,
            cost: 0,
          },
          websocket: {
            impressions: 0,
            opens: 0,
            clicks: 0,
            conversions: 0,
            revenue: 0,
            cost: 0,
          },
          popup: {
            impressions: 0,
            opens: 0,
            clicks: 0,
            conversions: 0,
            revenue: 0,
            cost: 0,
          },
        },
        lastUpdated: new Date(),
      };
    }
    return JSON.parse(data) as CampaignMetrics;
  }

  async updateCampaignMetrics(
    campaignId: string,
    storeId: string,
    metrics: Partial<CampaignMetrics>
  ): Promise<void> {
    const existing = await this.getCampaignMetrics(campaignId, storeId);
    const updated: CampaignMetrics = {
      ...existing,
      ...metrics,
      lastUpdated: new Date(),
    };
    await this.redis.hset(
      `campaign:metrics:${storeId}`,
      campaignId,
      JSON.stringify(updated)
    );
  }

  async assignVariant(
    campaignId: string,
    userId: string,
    campaign: Campaign
  ): Promise<string> {
    const existing = await this.redis.hget(
      `campaign:variants:${campaignId}`,
      userId
    );
    if (existing) return existing;
    const abTest = campaign.abTest;
    if (!abTest?.enabled || !abTest.variants.length) return "control";
    const random = Math.random() * 100;
    let cumulative = 0;
    for (let i = 0; i < abTest.variants.length; i++) {
      cumulative += abTest.trafficSplit[i];
      if (random <= cumulative) {
        const variantId = abTest.variants[i].id;
        await this.redis.hset(
          `campaign:variants:${campaignId}`,
          userId,
          variantId
        );
        return variantId;
      }
    }
    const fallbackVariant = abTest.variants[0].id;
    await this.redis.hset(
      `campaign:variants:${campaignId}`,
      userId,
      fallbackVariant
    );
    return fallbackVariant;
  }

  async getVariantPerformance(
    campaignId: string
  ): Promise<Record<string, CampaignMetrics>> {
    const variantKeys = await this.redis.keys(
      `campaign:metrics:variant:${campaignId}:*`
    );
    const performance: Record<string, CampaignMetrics> = {};
    for (const key of variantKeys) {
      const variantId = key.split(":").pop()!;
      const data = await this.redis.get(key);
      if (data) performance[variantId] = JSON.parse(data) as CampaignMetrics;
    }
    return performance;
  }
}
