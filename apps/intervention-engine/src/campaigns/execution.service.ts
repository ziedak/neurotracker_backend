export interface IExecutionService {
  executeCampaign(
    campaign: Campaign,
    userId: string,
    context: any,
    variant?: string
  ): Promise<CampaignExecution>;
  getCampaignExecutions(campaignId: string): Promise<CampaignExecution[]>;
}
import { Redis } from "ioredis";
import { Logger } from "@libs/monitoring";
import { Campaign, CampaignExecution } from "./types";

export class ExecutionService {
  private redis: Redis;
  private logger: Logger;

  constructor(redis: Redis, logger: Logger) {
    this.redis = redis;
    this.logger = logger;
  }

  async executeCampaign(
    campaign: Campaign,
    userId: string,
    context: any,
    variant?: string
  ): Promise<CampaignExecution> {
    const executionId = `exec_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    const now = new Date();
    const execution: CampaignExecution = {
      id: executionId,
      campaignId: campaign.id,
      userId,
      storeId: campaign.storeId,
      variant: variant,
      channels: campaign.channels,
      status: "pending",
      scheduledAt: now,
      results: [],
      metadata: context,
    };
    await this.redis.hset(
      `campaign:executions:${campaign.id}`,
      executionId,
      JSON.stringify(execution)
    );
    await this.redis.lpush(
      `queue:campaign:executions`,
      JSON.stringify({
        executionId,
        campaignId: campaign.id,
        storeId: campaign.storeId,
        priority: 5,
        scheduledAt: now.getTime(),
      })
    );
    this.logger.info("Campaign execution created", {
      executionId,
      campaignId: campaign.id,
      userId,
      variant,
    });
    return execution;
  }

  async getCampaignExecutions(
    campaignId: string
  ): Promise<CampaignExecution[]> {
    const executions = await this.redis.hgetall(
      `campaign:executions:${campaignId}`
    );
    return Object.values(executions).map(
      (data) => JSON.parse(String(data)) as CampaignExecution
    );
  }
}
