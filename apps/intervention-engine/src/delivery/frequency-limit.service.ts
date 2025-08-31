import { Logger, MetricsCollector } from "@libs/monitoring";
import { RedisClient } from "@libs/database";
import { InterventionTrigger, InterventionDelivery } from "./types";

import { getNumberEnv } from "@libs/config";

const FREQUENCY_CONFIG = {
  user: {
    perHour: getNumberEnv("FREQUENCY_USER_PER_HOUR", 5),
    perDay: getNumberEnv("FREQUENCY_USER_PER_DAY", 20),
  },
  campaign: {
    perHour: getNumberEnv("FREQUENCY_CAMPAIGN_PER_HOUR", 1),
    perDay: getNumberEnv("FREQUENCY_CAMPAIGN_PER_DAY", 3),
  },
  historyRetentionMs: getNumberEnv(
    "FREQUENCY_HISTORY_RETENTION_MS",
    7 * 24 * 60 * 60 * 1000
  ),
};

export class FrequencyLimitService {
  public redis: any;
  constructor(private logger: ILogger, private metrics: MetricsCollector) {
    this.redis = RedisClient.getInstance();
  }

  async checkFrequencyLimits(trigger: InterventionTrigger): Promise<boolean> {
    const userKey = `intervention:frequency:${trigger.storeId}:${trigger.userId}`;
    const campaignKey = `intervention:frequency:${trigger.storeId}:${trigger.userId}:${trigger.campaignId}`;
    const now = Date.now();
    const hourAgo = now - 60 * 60 * 1000;
    const dayAgo = now - 24 * 60 * 60 * 1000;
    const userHourCount = await this.redis.zcount(userKey, hourAgo, now);
    const userDayCount = await this.redis.zcount(userKey, dayAgo, now);
    if (
      userHourCount >= FREQUENCY_CONFIG.user.perHour ||
      userDayCount >= FREQUENCY_CONFIG.user.perDay
    ) {
      return false;
    }
    const campaignHourCount = await this.redis.zcount(
      campaignKey,
      hourAgo,
      now
    );
    const campaignDayCount = await this.redis.zcount(campaignKey, dayAgo, now);
    if (
      campaignHourCount >= FREQUENCY_CONFIG.campaign.perHour ||
      campaignDayCount >= FREQUENCY_CONFIG.campaign.perDay
    ) {
      return false;
    }
    return true;
  }

  async recordInterventionHistory(
    trigger: InterventionTrigger,
    deliveries: InterventionDelivery[]
  ): Promise<void> {
    const now = Date.now();
    const userKey = `intervention:frequency:${trigger.storeId}:${trigger.userId}`;
    const campaignKey = `intervention:frequency:${trigger.storeId}:${trigger.userId}:${trigger.campaignId}`;
    const record = {
      campaignId: trigger.campaignId,
      deliveries: deliveries.map((d) => ({
        id: d.id,
        channel: d.channel,
        status: d.status,
      })),
      timestamp: now,
    };
    await Promise.all([
      this.redis.zadd(userKey, now, JSON.stringify(record)),
      this.redis.zadd(campaignKey, now, JSON.stringify(record)),
      this.redis.zremrangebyscore(
        userKey,
        0,
        now - FREQUENCY_CONFIG.historyRetentionMs
      ),
      this.redis.zremrangebyscore(
        campaignKey,
        0,
        now - FREQUENCY_CONFIG.historyRetentionMs
      ),
    ]);
  }
}
