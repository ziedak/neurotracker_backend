import { RedisCampaignsService } from "./campaigns.service";
import type {
  CampaignCreateRequest,
  Campaign,
  CampaignUpdateRequest,
} from "./types";

export class CampaignFactoryService {
  static create(
    storeId: string,
    request: CampaignCreateRequest,
    createdBy: string
  ): Campaign {
    if (!storeId || !request.name || !request.type || !createdBy) {
      throw new Error("Missing required campaign fields");
    }
    const campaignId = `campaign_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    const now = new Date();
    return {
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
            costPerChannel:
              request.budget.costPerChannel ||
              RedisCampaignsService.DEFAULT_COST_PER_CHANNEL,
          }
        : undefined,
      createdAt: now,
      updatedAt: now,
      createdBy,
    };
  }

  static update(existing: Campaign, request: CampaignUpdateRequest): Campaign {
    return {
      ...existing,
      ...request,
      budget: request.budget
        ? {
            totalBudget:
              request.budget.totalBudget ?? existing.budget?.totalBudget,
            dailyBudget:
              request.budget.dailyBudget ?? existing.budget?.dailyBudget,
            currency:
              request.budget.currency ?? existing.budget?.currency ?? "USD",
            costPerChannel:
              request.budget.costPerChannel ||
              existing.budget?.costPerChannel ||
              RedisCampaignsService.DEFAULT_COST_PER_CHANNEL,
            spentAmount:
              request.budget.spentAmount ?? existing.budget?.spentAmount ?? 0,
            remainingBudget:
              request.budget.remainingBudget ??
              existing.budget?.remainingBudget ??
              0,
          }
        : existing.budget,
      updatedAt: new Date(),
    };
  }
}
