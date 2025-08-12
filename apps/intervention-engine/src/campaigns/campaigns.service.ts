import { RedisClient } from "@libs/database";
import { Logger, MetricsCollector } from "@libs/monitoring";
import {
  Campaign,
  CampaignCreateRequest,
  CampaignUpdateRequest,
  CampaignListFilter,
  CampaignStatus,
  CampaignExecution,
  CampaignMetrics,
  TriggerCondition,
} from "./types";

export interface CampaignsService {
  createCampaign(
    storeId: string,
    request: CampaignCreateRequest,
    createdBy: string
  ): Promise<Campaign>;
  updateCampaign(
    campaignId: string,
    storeId: string,
    request: CampaignUpdateRequest
  ): Promise<Campaign>;
  getCampaign(campaignId: string, storeId: string): Promise<Campaign | null>;
  listCampaigns(
    storeId: string,
    filter?: CampaignListFilter
  ): Promise<{ campaigns: Campaign[]; total: number }>;
  deleteCampaign(campaignId: string, storeId: string): Promise<boolean>;

  // Campaign lifecycle
  activateCampaign(campaignId: string, storeId: string): Promise<boolean>;
  pauseCampaign(campaignId: string, storeId: string): Promise<boolean>;
  stopCampaign(campaignId: string, storeId: string): Promise<boolean>;

  // Campaign execution
  checkTriggerConditions(
    storeId: string,
    userId: string,
    eventData: any
  ): Promise<Campaign[]>;
  executeCampaign(
    campaign: Campaign,
    userId: string,
    context: any
  ): Promise<CampaignExecution>;
  getCampaignExecutions(
    campaignId: string,
    storeId: string
  ): Promise<CampaignExecution[]>;

  // Campaign metrics
  getCampaignMetrics(
    campaignId: string,
    storeId: string
  ): Promise<CampaignMetrics>;
  updateCampaignMetrics(
    campaignId: string,
    storeId: string,
    metrics: Partial<CampaignMetrics>
  ): Promise<void>;

  // A/B Testing
  assignVariant(campaignId: string, userId: string): Promise<string>;
  getVariantPerformance(
    campaignId: string,
    storeId: string
  ): Promise<Record<string, CampaignMetrics>>;
}

export class RedisCampaignsService implements CampaignsService {
  private redis: any;
  
  constructor(
    redis: any,
    private logger: Logger,
    private metrics: MetricsCollector
  ) {
    this.redis = redis || RedisClient.getInstance();
  }

  async createCampaign(
    storeId: string,
    request: CampaignCreateRequest,
    createdBy: string
  ): Promise<Campaign> {
    try {
      const campaignId = `campaign_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;
      const now = new Date();

      const campaign: Campaign = {
        id: campaignId,
        storeId,
        name: request.name,
        description: request.description,
        type: request.type,
        status: "draft",
        triggerConditions: request.triggerConditions,
        channels: request.channels,
        schedule: request.schedule,
        targeting: request.targeting,
        content: request.content,
        abTest: request.abTest,
        budget: request.budget
          ? {
              ...request.budget,
              spentAmount: 0,
              remainingBudget: request.budget.totalBudget || 0,
            }
          : undefined,
        createdAt: now,
        updatedAt: now,
        createdBy,
      };

      // Store campaign in Redis
      await this.redis.hset(
        `campaigns:store:${storeId}`,
        campaignId,
        JSON.stringify(campaign)
      );

      // Add to campaign index for faster queries
      await this.redis.zadd(
        `campaigns:index:${storeId}`,
        now.getTime(),
        campaignId
      );

      // Add to type index
      await this.redis.sadd(
        `campaigns:type:${storeId}:${request.type}`,
        campaignId
      );

      this.logger.info("Campaign created", {
        campaignId,
        storeId,
        name: request.name,
        type: request.type,
      });

      this.metrics.recordCounter("campaigns.created", 1, {
        storeId,
        type: request.type,
      });

      return campaign;
    } catch (error) {
      this.logger.error("Failed to create campaign", error as Error);
      throw error;
    }
  }

  async updateCampaign(
    campaignId: string,
    storeId: string,
    request: CampaignUpdateRequest
  ): Promise<Campaign> {
    try {
      const existing = await this.getCampaign(campaignId, storeId);
      if (!existing) {
        throw new Error(`Campaign ${campaignId} not found`);
      }

      const updated: Campaign = {
        ...existing,
        ...request,
        budget: request.budget ? {
          totalBudget: request.budget.totalBudget ?? existing.budget?.totalBudget,
          dailyBudget: request.budget.dailyBudget ?? existing.budget?.dailyBudget,
          currency: request.budget.currency ?? existing.budget?.currency ?? "USD",
          costPerChannel: request.budget.costPerChannel ?? existing.budget?.costPerChannel ?? {
            email: 0.01,
            sms: 0.05,
            push: 0.002,
            websocket: 0,
            popup: 0
          },
          spentAmount: request.budget.spentAmount ?? existing.budget?.spentAmount ?? 0,
          remainingBudget: request.budget.remainingBudget ?? existing.budget?.remainingBudget ?? 0
        } : existing.budget,
        updatedAt: new Date(),
      };

      // Store updated campaign
      await this.redis.hset(
        `campaigns:store:${storeId}`,
        campaignId,
        JSON.stringify(updated)
      );

      this.logger.info("Campaign updated", {
        campaignId,
        storeId,
        changes: Object.keys(request),
      });

      this.metrics.recordCounter("campaigns.updated", 1, {
        storeId,
        type: updated.type,
      });

      return updated;
    } catch (error) {
      this.logger.error("Failed to update campaign", error as Error);
      throw error;
    }
  }

  async getCampaign(
    campaignId: string,
    storeId: string
  ): Promise<Campaign | null> {
    try {
      const data = await this.redis.hget(
        `campaigns:store:${storeId}`,
        campaignId
      );

      if (!data) return null;

      return JSON.parse(data) as Campaign;
    } catch (error) {
      this.logger.error("Failed to get campaign", error as Error);
      throw error;
    }
  }

  async listCampaigns(
    storeId: string,
    filter?: CampaignListFilter
  ): Promise<{ campaigns: Campaign[]; total: number }> {
    try {
      let campaignIds: string[];

      if (filter?.type && filter.type.length > 0) {
        // Get campaigns by type
        const typeKeys = filter.type.map(
          (type) => `campaigns:type:${storeId}:${type}`
        );
        campaignIds = await this.redis.sunion(...typeKeys);
      } else {
        // Get all campaigns for store
        campaignIds = await this.redis.zrevrange(
          `campaigns:index:${storeId}`,
          0,
          -1
        );
      }

      // Apply pagination
      const offset = filter?.offset || 0;
      const limit = filter?.limit || 50;
      const paginatedIds = campaignIds.slice(offset, offset + limit);

      // Fetch campaign data
      const campaigns: Campaign[] = [];
      if (paginatedIds.length > 0) {
        const campaignData = await this.redis.hmget(
          `campaigns:store:${storeId}`,
          ...paginatedIds
        );

        for (const data of campaignData) {
          if (data) {
            const campaign = JSON.parse(data) as Campaign;

            // Apply filters
            if (this.matchesFilter(campaign, filter)) {
              campaigns.push(campaign);
            }
          }
        }
      }

      return {
        campaigns,
        total: campaignIds.length,
      };
    } catch (error) {
      this.logger.error("Failed to list campaigns", error as Error);
      throw error;
    }
  }

  async deleteCampaign(campaignId: string, storeId: string): Promise<boolean> {
    try {
      const campaign = await this.getCampaign(campaignId, storeId);
      if (!campaign) return false;

      // Remove from all indexes
      await Promise.all([
        this.redis.hdel(`campaigns:store:${storeId}`, campaignId),
        this.redis.zrem(`campaigns:index:${storeId}`, campaignId),
        this.redis.srem(
          `campaigns:type:${storeId}:${campaign.type}`,
          campaignId
        ),
        this.redis.del(`campaign:executions:${campaignId}`),
        this.redis.del(`campaign:metrics:${campaignId}`),
      ]);

      this.logger.info("Campaign deleted", { campaignId, storeId });
      this.metrics.recordCounter("campaigns.deleted", 1, { storeId });

      return true;
    } catch (error) {
      this.logger.error("Failed to delete campaign", error as Error);
      throw error;
    }
  }

  async activateCampaign(
    campaignId: string,
    storeId: string
  ): Promise<boolean> {
    try {
      const campaign = await this.updateCampaign(campaignId, storeId, {
        status: "active",
      });

      // Add to active campaigns set
      await this.redis.sadd(`campaigns:active:${storeId}`, campaignId);

      this.logger.info("Campaign activated", { campaignId, storeId });
      this.metrics.recordCounter("campaigns.activated", 1, { storeId });

      return true;
    } catch (error) {
      this.logger.error("Failed to activate campaign", error as Error);
      return false;
    }
  }

  async pauseCampaign(campaignId: string, storeId: string): Promise<boolean> {
    try {
      await this.updateCampaign(campaignId, storeId, {
        status: "paused",
      });

      // Remove from active campaigns set
      await this.redis.srem(`campaigns:active:${storeId}`, campaignId);

      this.logger.info("Campaign paused", { campaignId, storeId });
      this.metrics.recordCounter("campaigns.paused", 1, { storeId });

      return true;
    } catch (error) {
      this.logger.error("Failed to pause campaign", error as Error);
      return false;
    }
  }

  async stopCampaign(campaignId: string, storeId: string): Promise<boolean> {
    try {
      await this.updateCampaign(campaignId, storeId, {
        status: "completed",
      });

      // Remove from active campaigns set
      await this.redis.srem(`campaigns:active:${storeId}`, campaignId);

      this.logger.info("Campaign stopped", { campaignId, storeId });
      this.metrics.recordCounter("campaigns.stopped", 1, { storeId });

      return true;
    } catch (error) {
      this.logger.error("Failed to stop campaign", error as Error);
      return false;
    }
  }

  async checkTriggerConditions(
    storeId: string,
    userId: string,
    eventData: any
  ): Promise<Campaign[]> {
    try {
      // Get active campaigns for this store
      const activeCampaignIds = await this.redis.smembers(
        `campaigns:active:${storeId}`
      );

      const triggeredCampaigns: Campaign[] = [];

      for (const campaignId of activeCampaignIds) {
        const campaign = await this.getCampaign(campaignId, storeId);
        if (!campaign) continue;

        // Check if conditions match
        if (
          this.evaluateTriggerConditions(campaign.triggerConditions, eventData)
        ) {
          triggeredCampaigns.push(campaign);
        }
      }

      return triggeredCampaigns;
    } catch (error) {
      this.logger.error("Failed to check trigger conditions", error as Error);
      throw error;
    }
  }

  async executeCampaign(
    campaign: Campaign,
    userId: string,
    context: any
  ): Promise<CampaignExecution> {
    try {
      const executionId = `exec_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;
      const now = new Date();

      // Assign A/B test variant if needed
      const variant = campaign.abTest?.enabled
        ? await this.assignVariant(campaign.id, userId)
        : undefined;

      const execution: CampaignExecution = {
        id: executionId,
        campaignId: campaign.id,
        userId,
        storeId: campaign.storeId,
        variant,
        channels: campaign.channels,
        status: "pending",
        scheduledAt: now,
        results: [],
        metadata: context,
      };

      // Store execution
      await this.redis.hset(
        `campaign:executions:${campaign.id}`,
        executionId,
        JSON.stringify(execution)
      );

      // Add to execution queue
      await this.redis.lpush(
        `queue:campaign:executions`,
        JSON.stringify({
          executionId,
          campaignId: campaign.id,
          storeId: campaign.storeId,
          priority: this.calculatePriority(campaign),
          scheduledAt: now.getTime(),
        })
      );

      this.logger.info("Campaign execution created", {
        executionId,
        campaignId: campaign.id,
        userId,
        variant,
      });

      this.metrics.recordCounter("campaigns.executions.created", 1, {
        storeId: campaign.storeId,
        campaignType: campaign.type,
      });

      return execution;
    } catch (error) {
      this.logger.error("Failed to execute campaign", error as Error);
      throw error;
    }
  }

  async getCampaignExecutions(
    campaignId: string,
    storeId: string
  ): Promise<CampaignExecution[]> {
    try {
      const executions = await this.redis.hgetall(
        `campaign:executions:${campaignId}`
      );

      return Object.values(executions).map(
        (data) => JSON.parse(String(data)) as CampaignExecution
      );
    } catch (error) {
      this.logger.error("Failed to get campaign executions", error as Error);
      throw error;
    }
  }

  async getCampaignMetrics(
    campaignId: string,
    storeId: string
  ): Promise<CampaignMetrics> {
    try {
      const data = await this.redis.hget(
        `campaign:metrics:${storeId}`,
        campaignId
      );

      if (!data) {
        // Return default metrics
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
            email: { impressions: 0, opens: 0, clicks: 0, conversions: 0, revenue: 0, cost: 0 },
            sms: { impressions: 0, opens: 0, clicks: 0, conversions: 0, revenue: 0, cost: 0 },
            push: { impressions: 0, opens: 0, clicks: 0, conversions: 0, revenue: 0, cost: 0 },
            websocket: { impressions: 0, opens: 0, clicks: 0, conversions: 0, revenue: 0, cost: 0 },
            popup: { impressions: 0, opens: 0, clicks: 0, conversions: 0, revenue: 0, cost: 0 }
          },
          lastUpdated: new Date(),
        };
      }

      return JSON.parse(data) as CampaignMetrics;
    } catch (error) {
      this.logger.error("Failed to get campaign metrics", error as Error);
      throw error;
    }
  }

  async updateCampaignMetrics(
    campaignId: string,
    storeId: string,
    metrics: Partial<CampaignMetrics>
  ): Promise<void> {
    try {
      const existing = await this.getCampaignMetrics(campaignId, storeId);

      const updated: CampaignMetrics = {
        ...existing,
        ...metrics,
        lastUpdated: new Date(),
      };

      // Recalculate derived metrics
      if (updated.impressions > 0) {
        updated.openRate = (updated.opens / updated.impressions) * 100;
        updated.clickThroughRate = (updated.clicks / updated.impressions) * 100;
        updated.conversionRate =
          (updated.conversions / updated.impressions) * 100;
      }

      if (updated.cost > 0) {
        updated.roi = ((updated.revenue - updated.cost) / updated.cost) * 100;
      }

      await this.redis.hset(
        `campaign:metrics:${storeId}`,
        campaignId,
        JSON.stringify(updated)
      );
    } catch (error) {
      this.logger.error("Failed to update campaign metrics", error as Error);
      throw error;
    }
  }

  async assignVariant(campaignId: string, userId: string): Promise<string> {
    try {
      // Check if user already has an assigned variant
      const existing = await this.redis.hget(
        `campaign:variants:${campaignId}`,
        userId
      );
      if (existing) return existing;

      const campaign = await this.redis.hget(`campaigns:store:*`, campaignId);
      if (!campaign) throw new Error("Campaign not found");

      const campaignData = JSON.parse(campaign) as Campaign;
      const abTest = campaignData.abTest;

      if (!abTest?.enabled || !abTest.variants.length) {
        return "control";
      }

      // Assign variant based on traffic split
      const random = Math.random() * 100;
      let cumulative = 0;

      for (let i = 0; i < abTest.variants.length; i++) {
        cumulative += abTest.trafficSplit[i];
        if (random <= cumulative) {
          const variantId = abTest.variants[i].id;

          // Store assignment
          await this.redis.hset(
            `campaign:variants:${campaignId}`,
            userId,
            variantId
          );

          return variantId;
        }
      }

      // Fallback to first variant
      const fallbackVariant = abTest.variants[0].id;
      await this.redis.hset(
        `campaign:variants:${campaignId}`,
        userId,
        fallbackVariant
      );

      return fallbackVariant;
    } catch (error) {
      this.logger.error("Failed to assign variant", error as Error);
      return "control";
    }
  }

  async getVariantPerformance(
    campaignId: string,
    storeId: string
  ): Promise<Record<string, CampaignMetrics>> {
    try {
      const variantKeys = await this.redis.keys(
        `campaign:metrics:variant:${campaignId}:*`
      );
      const performance: Record<string, CampaignMetrics> = {};

      for (const key of variantKeys) {
        const variantId = key.split(":").pop()!;
        const data = await this.redis.get(key);

        if (data) {
          performance[variantId] = JSON.parse(data) as CampaignMetrics;
        }
      }

      return performance;
    } catch (error) {
      this.logger.error("Failed to get variant performance", error as Error);
      throw error;
    }
  }

  private matchesFilter(
    campaign: Campaign,
    filter?: CampaignListFilter
  ): boolean {
    if (!filter) return true;

    if (filter.status && !filter.status.includes(campaign.status)) {
      return false;
    }

    if (filter.type && !filter.type.includes(campaign.type)) {
      return false;
    }

    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      if (
        !campaign.name.toLowerCase().includes(searchLower) &&
        !campaign.description?.toLowerCase().includes(searchLower)
      ) {
        return false;
      }
    }

    if (filter.createdAfter && campaign.createdAt < filter.createdAfter) {
      return false;
    }

    if (filter.createdBefore && campaign.createdAt > filter.createdBefore) {
      return false;
    }

    return true;
  }

  private evaluateTriggerConditions(
    conditions: TriggerCondition[],
    eventData: any
  ): boolean {
    return conditions.every((condition) => {
      const value = this.getNestedValue(eventData, condition.type);

      switch (condition.operator) {
        case "equals":
          return value === condition.value;
        case "greater_than":
          return Number(value) > Number(condition.value);
        case "less_than":
          return Number(value) < Number(condition.value);
        case "contains":
          return String(value).includes(String(condition.value));
        case "in":
          return (
            Array.isArray(condition.value) && condition.value.includes(value)
          );
        case "not_in":
          return (
            Array.isArray(condition.value) && !condition.value.includes(value)
          );
        default:
          return false;
      }
    });
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split(".").reduce((current, key) => current?.[key], obj);
  }

  private calculatePriority(campaign: Campaign): number {
    // Higher priority for time-sensitive campaigns
    let priority = 5; // default

    if (campaign.type === "cart_abandonment") priority += 3;
    if (campaign.channels.includes("websocket")) priority += 2;
    if (campaign.budget?.dailyBudget && campaign.budget.dailyBudget > 100)
      priority += 1;

    return Math.min(priority, 10); // cap at 10
  }
}

// Service implementation complete
