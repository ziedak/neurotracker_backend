export interface ILifecycleService {
  activateCampaign(storeId: string, campaignId: string): Promise<void>;
  pauseCampaign(storeId: string, campaignId: string): Promise<void>;
  stopCampaign(storeId: string, campaignId: string): Promise<void>;
}
import { Redis } from "ioredis";
import { Logger } from "@libs/monitoring";

export class LifecycleService {
  private redis: Redis;
  private logger: ILogger;

  constructor(redis: Redis, logger: ILogger) {
    this.redis = redis;
    this.logger = logger;
  }

  async activateCampaign(storeId: string, campaignId: string): Promise<void> {
    await this.redis.sadd(`campaigns:active:${storeId}`, campaignId);
    this.logger.info("Campaign activated", { campaignId, storeId });
  }

  async pauseCampaign(storeId: string, campaignId: string): Promise<void> {
    await this.redis.srem(`campaigns:active:${storeId}`, campaignId);
    this.logger.info("Campaign paused", { campaignId, storeId });
  }

  async stopCampaign(storeId: string, campaignId: string): Promise<void> {
    await this.redis.srem(`campaigns:active:${storeId}`, campaignId);
    this.logger.info("Campaign stopped", { campaignId, storeId });
  }

  async getActiveCampaignIds(storeId: string): Promise<string[]> {
    return await this.redis.smembers(`campaigns:active:${storeId}`);
  }
}
