import { Redis } from "ioredis";
import { Logger } from "@libs/monitoring";

export class CampaignRepository {
  private redis: Redis;
  private logger: Logger;

  constructor(redis: Redis, logger: Logger) {
    this.redis = redis;
    this.logger = logger;
  }

  private getCampaignKey(campaignId: string): string {
    return `campaign:${campaignId}`;
  }

  private getCampaignListKey(): string {
    return "campaigns:list";
  }

  async getCampaign(campaignId: string): Promise<any | null> {
    const key = this.getCampaignKey(campaignId);
    const data = await this.redis.get(key);
    if (!data) return null;
    try {
      return JSON.parse(data);
    } catch (err) {
      this.logger.error("Failed to parse campaign data", err as Error);
      return null;
    }
  }

  async listCampaigns(): Promise<{ campaigns: any[]; total: number }> {
    const key = this.getCampaignListKey();
    const data = await this.redis.get(key);
    if (!data) return { campaigns: [], total: 0 };
    try {
      const campaigns = JSON.parse(data);
      return { campaigns, total: campaigns.length };
    } catch (err) {
      this.logger.error("Failed to parse campaign list", err as Error);
      return { campaigns: [], total: 0 };
    }
  }

  async setCampaign(campaignId: string, campaign: any): Promise<void> {
    const key = this.getCampaignKey(campaignId);
    await this.redis.set(key, JSON.stringify(campaign));
  }

  async setCampaignList(campaigns: any[]): Promise<void> {
    const key = this.getCampaignListKey();
    await this.redis.set(key, JSON.stringify(campaigns));
  }

  async deleteCampaign(campaignId: string): Promise<void> {
    const key = this.getCampaignKey(campaignId);
    await this.redis.del(key);
  }

  async deleteCampaignList(): Promise<void> {
    const key = this.getCampaignListKey();
    await this.redis.del(key);
  }
}
