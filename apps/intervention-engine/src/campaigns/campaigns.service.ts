// Factory for campaign construction and validation

import { LRUCache } from "@libs/utils";
import { getEnv, getNumberEnv } from "@libs/config";
import { Logger, MetricsCollector } from "@libs/monitoring";
import { CampaignRepository } from "./campaign.repository";
import { CampaignIndexRepository } from "./campaign-index.repository";
import { ILifecycleService, LifecycleService } from "./lifecycle.service";
import { IExecutionService, ExecutionService } from "./execution.service";
import { IMetricsService, MetricsService } from "./metrics.service";
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
import { CampaignFactoryService } from "./CampaignFactoryService";

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
  //TODO: CampaignStatus
  // A/B Testing
  assignVariant(campaignId: string, userId: string): Promise<string>;
  getVariantPerformance(
    campaignId: string,
    storeId: string
  ): Promise<Record<string, CampaignMetrics>>;
}

export class RedisCampaignsService implements CampaignsService {
  private redis: any;
  private campaignCache: LRUCache<string, Campaign>;
  private listCache: LRUCache<string, { campaigns: Campaign[]; total: number }>;
  private repository: CampaignRepository;
  private indexRepository: CampaignIndexRepository;
  private lifecycleService: ILifecycleService;
  private executionService: IExecutionService;
  private metricsService: IMetricsService;
  private logger: Logger;
  private metrics: MetricsCollector;
  // Centralized Redis key builder
  private static keys = {
    store: (storeId: string) =>
      getEnv("CAMPAIGN_STORE_KEY", `campaigns:store:${storeId}`),
    index: (storeId: string) =>
      getEnv("CAMPAIGN_INDEX_KEY", `campaigns:index:${storeId}`),
    type: (storeId: string, type: string) =>
      getEnv("CAMPAIGN_TYPE_KEY", `campaigns:type:${storeId}:${type}`),
    active: (storeId: string) =>
      getEnv("CAMPAIGN_ACTIVE_KEY", `campaigns:active:${storeId}`),
    executions: (campaignId: string) =>
      getEnv("CAMPAIGN_EXECUTIONS_KEY", `campaign:executions:${campaignId}`),
    metrics: (storeId: string) =>
      getEnv("CAMPAIGN_METRICS_KEY", `campaign:metrics:${storeId}`),
    metricsVariant: (campaignId: string) =>
      getEnv(
        "CAMPAIGN_METRICS_VARIANT_KEY",
        `campaign:metrics:variant:${campaignId}:*`
      ),
    variants: (campaignId: string) =>
      getEnv("CAMPAIGN_VARIANTS_KEY", `campaign:variants:${campaignId}`),
  };
  // Magic values as constants
  public static DEFAULT_COST_PER_CHANNEL = {
    email: getNumberEnv("CAMPAIGN_COST_EMAIL", 0.01),
    sms: getNumberEnv("CAMPAIGN_COST_SMS", 0.05),
    push: getNumberEnv("CAMPAIGN_COST_PUSH", 0.002),
    websocket: getNumberEnv("CAMPAIGN_COST_WEBSOCKET", 0),
    popup: getNumberEnv("CAMPAIGN_COST_POPUP", 0),
  };

  constructor(
    redis: any,
    repository: CampaignRepository,
    indexRepository: CampaignIndexRepository,
    logger: Logger,
    metrics: MetricsCollector,
    lifecycleService?: ILifecycleService,
    executionService?: IExecutionService,
    metricsService?: IMetricsService
  ) {
    this.redis = redis;
    this.repository = repository;
    this.indexRepository = indexRepository;
    this.lifecycleService =
      lifecycleService ?? new LifecycleService(redis, logger);
    this.executionService =
      executionService ?? new ExecutionService(redis, logger);
    this.metricsService = metricsService ?? new MetricsService(redis, logger);
    this.logger = logger;
    this.metrics = metrics;
    this.campaignCache = new LRUCache<string, Campaign>({
      max: 500,
      ttl: 1000 * 60,
    });
    this.listCache = new LRUCache<
      string,
      { campaigns: Campaign[]; total: number }
    >({
      max: 100,
      ttl: 1000 * 30,
    });
  }

  /**
   * Create a new campaign with validation
   */
  async createCampaign(
    storeId: string,
    request: CampaignCreateRequest,
    createdBy: string
  ): Promise<Campaign> {
    try {
      // Delegate campaign construction to factory
      const campaign = CampaignFactoryService.create(
        storeId,
        request,
        createdBy
      );
      await this.repository.setCampaign(campaign.id, campaign);
      await this.indexRepository.addToIndex(
        storeId,
        campaign.id,
        campaign.createdAt.getTime()
      );
      await this.indexRepository.addToTypeIndex(
        storeId,
        campaign.type,
        campaign.id
      );
      this.logger.info("Campaign created", {
        campaignId: campaign.id,
        storeId,
        name: campaign.name,
        type: campaign.type,
      });
      this.metrics.recordCounter("campaigns.created", 1, {
        storeId,
        type: campaign.type,
      });
      return campaign;
    } catch (error) {
      this.logger.error("Failed to create campaign", error as Error);
      throw error;
    }
  }

  /**
   * Update an existing campaign with validation
   */
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

      // Delegate campaign update to factory
      const updated = CampaignFactoryService.update(existing, request);
      await this.repository.setCampaign(campaignId, updated);
      await this.indexRepository.updateIndex(
        storeId,
        campaignId,
        updated.updatedAt.getTime()
      );
      this.campaignCache.delete(`${storeId}:${campaignId}`);
      this.listCache.clear();
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

  /**
   * Get a campaign by ID
   */
  async getCampaign(
    campaignId: string,
    storeId: string
  ): Promise<Campaign | null> {
    try {
      const cacheKey = `${storeId}:${campaignId}`;
      const cached = this.campaignCache.get(cacheKey);
      if (cached) return cached;
      const campaign = await this.repository.getCampaign(campaignId);
      if (!campaign) return null;
      this.campaignCache.set(cacheKey, campaign);
      return campaign;
    } catch (error) {
      this.logger.error("Failed to get campaign", error as Error);
      throw error;
    }
  }

  /**
   * List campaigns with filtering and pagination
   */
  async listCampaigns(
    storeId: string,
    filter?: CampaignListFilter
  ): Promise<{ campaigns: Campaign[]; total: number }> {
    try {
      const cacheKey = JSON.stringify({ storeId, filter });
      const cached = this.listCache.get(cacheKey);
      if (cached) return cached;
      const result = await this.repository.listCampaigns();
      this.listCache.set(cacheKey, result);
      return result;
    } catch (error) {
      this.logger.error("Failed to list campaigns", error as Error);
      throw error;
    }
  }

  async deleteCampaign(campaignId: string, storeId: string): Promise<boolean> {
    try {
      const campaign = await this.getCampaign(campaignId, storeId);
      if (!campaign) return false;

      // Delegate deletion to repository and indexRepository
      await this.repository.deleteCampaign(campaignId);
      await this.indexRepository.removeFromIndex(storeId, campaignId);
      this.campaignCache.delete(`${storeId}:${campaignId}`);
      this.listCache.clear();
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
      await this.updateCampaign(campaignId, storeId, { status: "active" });
      await this.lifecycleService.activateCampaign(storeId, campaignId);
      this.metrics.recordCounter("campaigns.activated", 1, { storeId });
      return true;
    } catch (error) {
      this.logger.error("Failed to activate campaign", error as Error);
      return false;
    }
  }

  async pauseCampaign(campaignId: string, storeId: string): Promise<boolean> {
    try {
      await this.updateCampaign(campaignId, storeId, { status: "paused" });
      await this.lifecycleService.pauseCampaign(storeId, campaignId);
      this.metrics.recordCounter("campaigns.paused", 1, { storeId });
      return true;
    } catch (error) {
      this.logger.error("Failed to pause campaign", error as Error);
      return false;
    }
  }

  async stopCampaign(campaignId: string, storeId: string): Promise<boolean> {
    try {
      await this.updateCampaign(campaignId, storeId, { status: "completed" });
      await this.lifecycleService.stopCampaign(storeId, campaignId);
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
      // Assign A/B test variant if needed
      const variant = campaign.abTest?.enabled
        ? await this.assignVariant(campaign.id, userId)
        : undefined;
      // Pass variant to executionService if needed
      const execution = await this.executionService.executeCampaign(
        campaign,
        userId,
        context,
        variant
      );
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
      return await this.executionService.getCampaignExecutions(campaignId);
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
      return await this.metricsService.getCampaignMetrics(campaignId, storeId);
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
      await this.metricsService.updateCampaignMetrics(
        campaignId,
        storeId,
        metrics
      );
    } catch (error) {
      this.logger.error("Failed to update campaign metrics", error as Error);
      throw error;
    }
  }

  async assignVariant(campaignId: string, userId: string): Promise<string> {
    try {
      const campaign = await this.getCampaign(campaignId, "");
      if (!campaign) return "control";
      return await this.metricsService.assignVariant(
        campaignId,
        userId,
        campaign
      );
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
      return await this.metricsService.getVariantPerformance(campaignId);
    } catch (error) {
      this.logger.error("Failed to get variant performance", error as Error);
      throw error;
    }
  }

  // Fast filter for campaigns (static for performance)
  private static fastMatchesFilter(
    campaign: Campaign,
    filter?: CampaignListFilter
  ): boolean {
    if (!filter) return true;
    if (filter.status && !filter.status.includes(campaign.status)) return false;
    if (filter.type && !filter.type.includes(campaign.type)) return false;
    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      if (
        !campaign.name.toLowerCase().includes(searchLower) &&
        !(
          campaign.description &&
          campaign.description.toLowerCase().includes(searchLower)
        )
      ) {
        return false;
      }
    }
    if (filter.createdAfter && campaign.createdAt < filter.createdAfter)
      return false;
    if (filter.createdBefore && campaign.createdAt > filter.createdBefore)
      return false;
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
