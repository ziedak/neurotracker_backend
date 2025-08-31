import { Redis } from "ioredis";
import { Logger } from "@libs/monitoring";

export class CampaignIndexRepository {
  private redis: Redis;
  private logger: ILogger;

  constructor(redis: Redis, logger: ILogger) {
    this.redis = redis;
    this.logger = logger;
  }

  getIndexKey(storeId: string): string {
    return `campaigns:index:${storeId}`;
  }

  getTypeKey(storeId: string, type: string): string {
    return `campaigns:type:${storeId}:${type}`;
  }

  async addToIndex(
    storeId: string,
    campaignId: string,
    timestamp: number
  ): Promise<void> {
    await this.redis.zadd(this.getIndexKey(storeId), timestamp, campaignId);
  }

  async getCampaignIds(storeId: string): Promise<string[]> {
    return await this.redis.zrevrange(this.getIndexKey(storeId), 0, -1);
  }

  async addToTypeIndex(
    storeId: string,
    type: string,
    campaignId: string
  ): Promise<void> {
    await this.redis.sadd(this.getTypeKey(storeId, type), campaignId);
  }

  async getTypeCampaignIds(
    storeId: string,
    types: string[]
  ): Promise<string[]> {
    const typeKeys = types.map((type) => this.getTypeKey(storeId, type));
    return await this.redis.sunion(...typeKeys);
  }

  async removeFromIndex(storeId: string, campaignId: string): Promise<void> {
    await this.redis.zrem(this.getIndexKey(storeId), campaignId);
  }

  async removeFromTypeIndex(
    storeId: string,
    type: string,
    campaignId: string
  ): Promise<void> {
    await this.redis.srem(this.getTypeKey(storeId, type), campaignId);
  }
  async updateIndex(
    storeId: string,
    campaignId: string,
    timestamp: number
  ): Promise<void> {
    // Remove and re-add to update timestamp
    await this.redis.zrem(this.getIndexKey(storeId), campaignId);
    await this.redis.zadd(this.getIndexKey(storeId), timestamp, campaignId);
  }
}
