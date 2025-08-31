import { RedisClient } from "@libs/database";
import { SegmentService } from "./segment.service";
import { UserProfileService } from "./user-profile.service";
import { Logger, MetricsCollector } from "@libs/monitoring";
import {
  UserProfile,
  PersonalizationContext,
  PersonalizationResult,
  PersonalizationRule,
  PersonalizationCondition,
  Recommendation,
  PersonalizedOffer,
  OptimalTiming,
  SegmentDefinition,
  UserScores,
  PersonalizationService as IPersonalizationService,
} from "./types";
import { RuleService } from "./rule.service";
import { RecommendationService } from "./recommendation.service";

export class PersonalizationService implements IPersonalizationService {
  // ...existing code...

  private redis: any;
  private segmentService: SegmentService;
  private userProfileService: UserProfileService;
  private ruleService: RuleService;
  private recommendationService: RecommendationService;

  constructor(private logger: ILogger, private metrics: MetricsCollector) {
    this.redis = RedisClient.getInstance();
    this.userProfileService = new UserProfileService(logger, metrics);
    this.segmentService = new SegmentService(logger);
    this.ruleService = new RuleService(logger);
    this.recommendationService = new RecommendationService(logger, metrics);
  }

  async getOptimalSendTime(
    userId: string,
    storeId: string,
    channel: string
  ): Promise<Date> {
    try {
      const profile = await this.getUserProfile(userId, storeId);
      if (!profile) {
        // Default to 10 AM in user's timezone (or UTC)
        const defaultTime = new Date();
        defaultTime.setHours(10, 0, 0, 0);
        return defaultTime;
      }
      // Analyze historical engagement patterns
      const engagementHistory = await this.redis.hgetall(
        `user:engagement:${storeId}:${userId}:${channel}`
      );
      const hourlyEngagement = Array(24).fill(0);
      for (const [timestamp, engagement] of Object.entries(engagementHistory)) {
        const date = new Date(parseInt(timestamp));
        const hour = date.getHours();
        hourlyEngagement[hour] += parseFloat(engagement as string);
      }
      const bestHour = hourlyEngagement.indexOf(Math.max(...hourlyEngagement));
      const optimalTime = new Date();
      optimalTime.setHours(bestHour || 10, 0, 0, 0);
      // Ensure it's in the future
      if (optimalTime <= new Date()) {
        optimalTime.setDate(optimalTime.getDate() + 1);
      }
      return optimalTime;
    } catch (error) {
      this.logger.error("Failed to get optimal send time", error as Error);
      throw error;
    }
  }

  async updateUserProfile(
    userId: string,
    storeId: string,
    data: Partial<UserProfile>
  ): Promise<UserProfile> {
    return this.userProfileService.updateUserProfile(userId, storeId, data);
  }

  async getUserProfile(
    userId: string,
    storeId: string
  ): Promise<UserProfile | null> {
    return this.userProfileService.getUserProfile(userId, storeId);
  }

  async calculateUserScores(
    userId: string,
    storeId: string
  ): Promise<UserScores> {
    return this.userProfileService.calculateUserScores(userId, storeId);
  }

  async personalizeContent(
    context: PersonalizationContext
  ): Promise<PersonalizationResult> {
    try {
      const profile = await this.getUserProfile(
        context.userId,
        context.storeId
      );

      if (!profile) {
        // Return default personalization for new users
        return this.getDefaultPersonalization(context);
      }

      const rules = await this.ruleService.getPersonalizationRules(
        context.storeId
      );
      const applicableRules = this.ruleService.filterApplicableRules(
        rules,
        profile,
        context
      );

      const [recommendations, offers, timing] = await Promise.all([
        this.generateRecommendations(
          context.userId,
          context.storeId,
          "general",
          5
        ),
        this.getPersonalizedOffers(context.userId, context.storeId),
        this.getOptimalTiming(context.userId, context.storeId),
      ]);

      const content = this.applyPersonalizationRules(
        applicableRules,
        profile,
        context
      );

      const result: PersonalizationResult = {
        userId: context.userId,
        content,
        recommendations,
        offers,
        timing,
        appliedRules: applicableRules.map((r) => r.id),
        confidence: this.calculateConfidence(profile, applicableRules.length),
      };

      this.metrics.recordCounter("personalization.content.generated", 1, {
        storeId: context.storeId,
        rulesApplied: applicableRules.length.toString(),
      });

      return result;
    } catch (error) {
      this.logger.error("Failed to personalize content", error as Error);
      throw error;
    }
  }

  async generateRecommendations(
    userId: string,
    storeId: string,
    type: string = "hybrid",
    count = 5
  ): Promise<Recommendation[]> {
    try {
      const profile = await this.getUserProfile(userId, storeId);
      return this.recommendationService.generateRecommendations(
        profile,
        type,
        count
      );
    } catch (error) {
      this.logger.error("Failed to generate recommendations", error as Error);
      throw error;
    }
  }

  async getPersonalizedOffers(
    userId: string,
    storeId: string
  ): Promise<PersonalizedOffer[]> {
    try {
      const profile = await this.getUserProfile(userId, storeId);

      if (!profile) return [];

      const offers: PersonalizedOffer[] = [];

      // Churn risk offer
      if (profile.scores.churnRisk > 70) {
        offers.push({
          id: `offer_retention_${Date.now()}`,
          type: "discount",
          value: 20,
          description: "20% off your next order - We miss you!",
          validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        });
      }

      // High value customer offer
      if (profile.behavioral.purchaseHistory.totalSpent > 1000) {
        offers.push({
          id: `offer_vip_${Date.now()}`,
          type: "free_shipping",
          value: 0,
          description: "Free shipping on all orders - VIP member benefit",
        });
      }

      // Category-based offers
      if (profile.behavioral.purchaseHistory.favoriteCategories.length > 0) {
        const category =
          profile.behavioral.purchaseHistory.favoriteCategories[0];
        offers.push({
          id: `offer_category_${Date.now()}`,
          type: "discount",
          value: 15,
          description: `15% off ${category} products`,
          validUntil: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days
        });
      }

      return offers;
    } catch (error) {
      this.logger.error("Failed to get personalized offers", error as Error);
      throw error;
    }
  }

  async createSegment(
    storeId: string,
    definition: Omit<SegmentDefinition, "id" | "createdAt" | "updatedAt">
  ): Promise<SegmentDefinition> {
    return this.segmentService.createSegment(storeId, definition);
  }

  async updateSegment(
    segmentId: string,
    storeId: string,
    definition: Partial<SegmentDefinition>
  ): Promise<SegmentDefinition> {
    return this.segmentService.updateSegment(segmentId, storeId, definition);
  }

  async getUserSegments(userId: string, storeId: string): Promise<string[]> {
    return this.segmentService.getUserSegments(userId, storeId);
  }

  async getSegmentUsers(segmentId: string, storeId: string): Promise<string[]> {
    return this.segmentService.getSegmentUsers(segmentId, storeId);
  }

  async createPersonalizationRule(
    storeId: string,
    rule: Omit<PersonalizationRule, "id" | "createdAt" | "updatedAt">
  ): Promise<PersonalizationRule> {
    return this.ruleService.createPersonalizationRule(storeId, rule);
  }

  async updatePersonalizationRule(
    ruleId: string,
    storeId: string,
    rule: Partial<PersonalizationRule>
  ): Promise<PersonalizationRule> {
    return this.ruleService.updatePersonalizationRule(ruleId, storeId, rule);
  }

  async getPersonalizationRules(
    storeId: string
  ): Promise<PersonalizationRule[]> {
    return this.ruleService.getPersonalizationRules(storeId);
  }

  async getBestChannel(userId: string, storeId: string): Promise<string> {
    try {
      const profile = await this.getUserProfile(userId, storeId);

      if (!profile) return "email"; // default

      const preferences = profile.preferences.communication;
      const engagement = profile.behavioral.engagementMetrics;

      // Calculate channel scores
      const scores = {
        email: preferences.email ? engagement.emailEngagement.openRate : 0,
        sms: preferences.sms ? 50 : 0, // default if no data
        push: preferences.push ? 45 : 0,
        websocket: 40, // real-time always available
      };

      // Return channel with highest score
      return Object.entries(scores).reduce(
        (best: string, [channel, score]: [string, number]) => {
          const bestScore = scores[best as keyof typeof scores] || 0;
          return score > bestScore ? channel : best;
        },
        "email"
      );
    } catch (error) {
      this.logger.error("Failed to get best channel", error as Error);
      return "email"; // fallback
    }
  }

  // Private helper methods

  private async getOptimalTiming(
    userId: string,
    storeId: string
  ): Promise<OptimalTiming> {
    const bestChannel = await this.getBestChannel(userId, storeId);
    const bestTime = await this.getOptimalSendTime(
      userId,
      storeId,
      bestChannel
    );

    return {
      bestTimeToSend: bestTime,
      bestChannel,
      confidence: 75, // simplified confidence score
      timezone: "UTC", // would get from user profile
    };
  }

  // ...existing code...

  private getDefaultPersonalization(
    context: PersonalizationContext
  ): PersonalizationResult {
    return {
      userId: context.userId,
      content: {
        body: "Welcome! Check out our latest offers.",
        variables: { userName: "Valued Customer" },
      },
      recommendations: [],
      offers: [],
      timing: {
        bestChannel: "email",
        confidence: 50,
        timezone: "UTC",
      },
      appliedRules: [],
      confidence: 30,
    };
  }

  private applyPersonalizationRules(
    rules: PersonalizationRule[],
    profile: UserProfile,
    context: PersonalizationContext
  ): any {
    let content = {
      body: "Welcome back!",
      variables: { userName: profile.demographics.customerType || "Customer" },
    };

    for (const rule of rules) {
      for (const action of rule.actions) {
        if (action.type === "content_variant" && action.config.content) {
          content = { ...content, ...action.config.content };
        }
      }
    }

    return content;
  }

  private calculateConfidence(
    profile: UserProfile,
    rulesApplied: number
  ): number {
    let confidence = 50; // base confidence

    // More data = higher confidence
    if (profile.behavioral.purchaseHistory.totalOrders > 0) confidence += 20;
    if (profile.behavioral.browsingBehavior.sessionsCount > 5) confidence += 15;

    // More rules applied = higher confidence
    confidence += rulesApplied * 5;

    return Math.min(confidence, 100);
  }

  private async getPopularRecommendations(
    storeId: string,
    count: number
  ): Promise<Recommendation[]> {
    // Simplified popular items (would come from actual product data)
    return Array.from({ length: count }, (_, i) => ({
      itemId: `popular_${i + 1}`,
      title: `Popular Product ${i + 1}`,
      description: "Trending now",
      category: "general",
      score: 80 - i * 5,
      reason: "Popular with all customers",
    }));
  }

  // ...existing code...
}

// Service implementation complete
