import { RedisClient } from "@libs/database";
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

export class PersonalizationService implements IPersonalizationService {
  private redis: any;

  constructor(private logger: Logger, private metrics: MetricsCollector) {
    this.redis = RedisClient.getInstance();
  }

  async updateUserProfile(
    userId: string,
    storeId: string,
    data: Partial<UserProfile>
  ): Promise<UserProfile> {
    try {
      const existing = await this.getUserProfile(userId, storeId);

      const profile: UserProfile = {
        userId,
        storeId,
        demographics: {
          customerType: "new",
          ...existing?.demographics,
          ...data.demographics,
        },
        behavioral: {
          purchaseHistory: {
            totalOrders: 0,
            totalSpent: 0,
            averageOrderValue: 0,
            favoriteCategories: [],
            purchaseFrequency: "rarely",
            seasonalTrends: {},
          },
          browsingBehavior: {
            pagesViewed: 0,
            sessionsCount: 0,
            averageSessionDuration: 0,
            bounceRate: 0,
            deviceTypes: {},
            referralSources: {},
            searchTerms: [],
          },
          engagementMetrics: {
            emailEngagement: { opens: 0, clicks: 0, openRate: 0, clickRate: 0 },
            notificationEngagement: {
              pushOpens: 0,
              smsClicks: 0,
              webSocketInteractions: 0,
            },
          },
          activityLevel: "low",
          lastActivity: new Date(),
          ...existing?.behavioral,
          ...data.behavioral,
        },
        preferences: {
          communication: {
            email: true,
            sms: false,
            push: true,
            frequency: "daily",
          },
          content: {
            categories: [],
            brands: [],
          },
          privacy: {
            allowTracking: true,
            allowPersonalization: true,
            allowRecommendations: true,
          },
          ...existing?.preferences,
          ...data.preferences,
        },
        segments: existing?.segments || [],
        scores: existing?.scores || {
          churnRisk: 0,
          engagementScore: 0,
          lifetimeValue: 0,
          conversionProbability: 0,
          recommendationRelevance: 0,
          lastCalculated: new Date(),
        },
        lastUpdated: new Date(),
        ...data,
      };

      // Store profile
      await this.redis.hset(
        `user:profiles:${storeId}`,
        userId,
        JSON.stringify(profile)
      );

      // Update user segments
      await this.updateUserSegments(userId, storeId, profile);

      this.logger.info("User profile updated", { userId, storeId });
      this.metrics.recordCounter("personalization.profiles.updated", 1, {
        storeId,
      });

      return profile;
    } catch (error) {
      this.logger.error("Failed to update user profile", error as Error);
      throw error;
    }
  }

  async getUserProfile(
    userId: string,
    storeId: string
  ): Promise<UserProfile | null> {
    try {
      const data = await this.redis.hget(`user:profiles:${storeId}`, userId);

      if (!data) return null;

      return JSON.parse(data) as UserProfile;
    } catch (error) {
      this.logger.error("Failed to get user profile", error as Error);
      throw error;
    }
  }

  async calculateUserScores(
    userId: string,
    storeId: string
  ): Promise<UserScores> {
    try {
      const profile = await this.getUserProfile(userId, storeId);

      if (!profile) {
        throw new Error("User profile not found");
      }

      const scores: UserScores = {
        churnRisk: this.calculateChurnRisk(profile),
        engagementScore: this.calculateEngagementScore(profile),
        lifetimeValue: this.calculateLifetimeValue(profile),
        conversionProbability: this.calculateConversionProbability(profile),
        recommendationRelevance: this.calculateRecommendationRelevance(profile),
        lastCalculated: new Date(),
      };

      // Update profile with new scores
      await this.updateUserProfile(userId, storeId, { scores });

      return scores;
    } catch (error) {
      this.logger.error("Failed to calculate user scores", error as Error);
      throw error;
    }
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

      const rules = await this.getPersonalizationRules(context.storeId);
      const applicableRules = this.filterApplicableRules(
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
    type: string,
    count = 5
  ): Promise<Recommendation[]> {
    try {
      const profile = await this.getUserProfile(userId, storeId);

      if (!profile) {
        return this.getPopularRecommendations(storeId, count);
      }

      // Simple recommendation algorithm based on user behavior
      const recommendations: Recommendation[] = [];

      // Category-based recommendations
      for (const category of profile.behavioral.purchaseHistory.favoriteCategories.slice(
        0,
        count
      )) {
        recommendations.push({
          itemId: `item_${category}_${Math.random().toString(36).substr(2, 6)}`,
          title: `Recommended ${category} Product`,
          description: `Based on your interest in ${category}`,
          category,
          score: 85 + Math.random() * 15,
          reason: `You frequently browse ${category} products`,
        });
      }

      // Fill with collaborative filtering if needed
      while (recommendations.length < count) {
        recommendations.push({
          itemId: `item_popular_${Math.random().toString(36).substr(2, 6)}`,
          title: "Popular Product",
          description: "Customers like you also viewed this",
          category: "general",
          score: 70 + Math.random() * 20,
          reason: "Popular with similar customers",
        });
      }

      return recommendations.slice(0, count);
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
    try {
      const segmentId = `segment_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;
      const now = new Date();

      const segment: SegmentDefinition = {
        id: segmentId,
        createdAt: now,
        updatedAt: now,
        ...definition,
      };

      await this.redis.hset(
        `segments:${storeId}`,
        segmentId,
        JSON.stringify(segment)
      );

      // Calculate initial user count
      await this.recalculateSegment(segmentId, storeId);

      this.logger.info("Segment created", {
        segmentId,
        storeId,
        name: definition.name,
      });

      return segment;
    } catch (error) {
      this.logger.error("Failed to create segment", error as Error);
      throw error;
    }
  }

  async updateSegment(
    segmentId: string,
    storeId: string,
    definition: Partial<SegmentDefinition>
  ): Promise<SegmentDefinition> {
    try {
      const existing = await this.getSegment(segmentId, storeId);
      if (!existing) {
        throw new Error("Segment not found");
      }

      const updated: SegmentDefinition = {
        ...existing,
        ...definition,
        updatedAt: new Date(),
      };

      await this.redis.hset(
        `segments:${storeId}`,
        segmentId,
        JSON.stringify(updated)
      );

      // Recalculate if criteria changed
      if (definition.criteria) {
        await this.recalculateSegment(segmentId, storeId);
      }

      return updated;
    } catch (error) {
      this.logger.error("Failed to update segment", error as Error);
      throw error;
    }
  }

  async getUserSegments(userId: string, storeId: string): Promise<string[]> {
    try {
      const segments = await this.redis.smembers(
        `user:segments:${storeId}:${userId}`
      );
      return segments || [];
    } catch (error) {
      this.logger.error("Failed to get user segments", error as Error);
      throw error;
    }
  }

  async getSegmentUsers(segmentId: string, storeId: string): Promise<string[]> {
    try {
      const users = await this.redis.smembers(
        `segment:users:${storeId}:${segmentId}`
      );
      return users || [];
    } catch (error) {
      this.logger.error("Failed to get segment users", error as Error);
      throw error;
    }
  }

  async createPersonalizationRule(
    storeId: string,
    rule: Omit<PersonalizationRule, "id" | "createdAt" | "updatedAt">
  ): Promise<PersonalizationRule> {
    try {
      const ruleId = `rule_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;
      const now = new Date();

      const personalizationRule: PersonalizationRule = {
        id: ruleId,
        createdAt: now,
        updatedAt: now,
        ...rule,
      };

      await this.redis.hset(
        `personalization:rules:${storeId}`,
        ruleId,
        JSON.stringify(personalizationRule)
      );

      this.logger.info("Personalization rule created", {
        ruleId,
        storeId,
        name: rule.name,
      });

      return personalizationRule;
    } catch (error) {
      this.logger.error(
        "Failed to create personalization rule",
        error as Error
      );
      throw error;
    }
  }

  async updatePersonalizationRule(
    ruleId: string,
    storeId: string,
    rule: Partial<PersonalizationRule>
  ): Promise<PersonalizationRule> {
    try {
      const existing = await this.getPersonalizationRule(ruleId, storeId);
      if (!existing) {
        throw new Error("Personalization rule not found");
      }

      const updated: PersonalizationRule = {
        ...existing,
        ...rule,
        updatedAt: new Date(),
      };

      await this.redis.hset(
        `personalization:rules:${storeId}`,
        ruleId,
        JSON.stringify(updated)
      );

      return updated;
    } catch (error) {
      this.logger.error(
        "Failed to update personalization rule",
        error as Error
      );
      throw error;
    }
  }

  async getPersonalizationRules(
    storeId: string
  ): Promise<PersonalizationRule[]> {
    try {
      const rulesData = await this.redis.hgetall(
        `personalization:rules:${storeId}`
      );

      const rules = Object.values(rulesData)
        .map((data: any) => JSON.parse(data) as PersonalizationRule)
        .filter((rule) => rule.isActive)
        .sort((a, b) => b.priority - a.priority);

      return rules;
    } catch (error) {
      this.logger.error("Failed to get personalization rules", error as Error);
      throw error;
    }
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

      // Simple algorithm: find the hour with highest engagement
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
      return Object.entries(scores).reduce((best, [channel, score]) =>
        score > scores[best as keyof typeof scores] ? channel : best
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

  private calculateChurnRisk(profile: UserProfile): number {
    const daysSinceLastActivity = Math.floor(
      (Date.now() - profile.behavioral.lastActivity.getTime()) /
        (1000 * 60 * 60 * 24)
    );

    let risk = Math.min(daysSinceLastActivity * 2, 100);

    // Adjust based on engagement
    if (profile.behavioral.engagementMetrics.emailEngagement.openRate < 10)
      risk += 20;
    if (profile.behavioral.purchaseHistory.totalOrders === 0) risk += 30;

    return Math.min(risk, 100);
  }

  private calculateEngagementScore(profile: UserProfile): number {
    const email = profile.behavioral.engagementMetrics.emailEngagement;
    const notification =
      profile.behavioral.engagementMetrics.notificationEngagement;

    let score = 0;
    score += email.openRate * 0.3;
    score += email.clickRate * 0.4;
    score += Math.min(notification.pushOpens / 10, 20) * 0.2;
    score +=
      Math.min(profile.behavioral.browsingBehavior.sessionsCount / 5, 10) * 0.1;

    return Math.min(score, 100);
  }

  private calculateLifetimeValue(profile: UserProfile): number {
    const purchase = profile.behavioral.purchaseHistory;
    const monthlyValue =
      purchase.totalSpent / Math.max(1, this.getCustomerAgeInMonths(profile));

    // Simple CLV = monthly value * 24 months (2 years)
    return monthlyValue * 24;
  }

  private calculateConversionProbability(profile: UserProfile): number {
    let probability = 50; // base 50%

    // Adjust based on purchase history
    if (profile.behavioral.purchaseHistory.totalOrders > 0) probability += 20;
    if (profile.behavioral.purchaseHistory.totalOrders > 5) probability += 15;

    // Adjust based on engagement
    probability +=
      profile.behavioral.engagementMetrics.emailEngagement.clickRate * 0.5;

    // Adjust based on activity level
    if (profile.behavioral.activityLevel === "high") probability += 10;
    else if (profile.behavioral.activityLevel === "low") probability -= 10;

    return Math.min(Math.max(probability, 0), 100);
  }

  private calculateRecommendationRelevance(profile: UserProfile): number {
    // Based on browsing behavior and purchase history
    const categories =
      profile.behavioral.purchaseHistory.favoriteCategories.length;
    const sessions = Math.min(
      profile.behavioral.browsingBehavior.sessionsCount / 10,
      10
    );

    return Math.min(categories * 15 + sessions * 5 + 30, 100);
  }

  private getCustomerAgeInMonths(profile: UserProfile): number {
    if (!profile.demographics.registrationDate) return 1;

    const diffTime =
      Date.now() - profile.demographics.registrationDate.getTime();
    return Math.max(Math.floor(diffTime / (1000 * 60 * 60 * 24 * 30)), 1);
  }

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

  private filterApplicableRules(
    rules: PersonalizationRule[],
    profile: UserProfile,
    context: PersonalizationContext
  ): PersonalizationRule[] {
    return rules.filter((rule) =>
      rule.conditions.every((condition) =>
        this.evaluateCondition(condition, profile, context)
      )
    );
  }

  private evaluateCondition(
    condition: PersonalizationCondition,
    profile: UserProfile,
    context: PersonalizationContext
  ): boolean {
    const value = this.getValueFromPath(condition.field, { profile, context });

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
      case "exists":
        return value !== undefined && value !== null;
      default:
        return false;
    }
  }

  private getValueFromPath(path: string, data: any): any {
    return path.split(".").reduce((current, key) => current?.[key], data);
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

  private async updateUserSegments(
    userId: string,
    storeId: string,
    profile: UserProfile
  ): Promise<void> {
    const segments = await this.redis.hgetall(`segments:${storeId}`);
    const userSegments: string[] = [];

    for (const [segmentId, segmentData] of Object.entries(segments)) {
      const segment = JSON.parse(segmentData as string) as SegmentDefinition;

      if (segment.isActive && this.userMatchesSegment(profile, segment)) {
        userSegments.push(segmentId);
        await this.redis.sadd(`segment:users:${storeId}:${segmentId}`, userId);
      } else {
        await this.redis.srem(`segment:users:${storeId}:${segmentId}`, userId);
      }
    }

    // Update user's segments
    await this.redis.del(`user:segments:${storeId}:${userId}`);
    if (userSegments.length > 0) {
      await this.redis.sadd(
        `user:segments:${storeId}:${userId}`,
        ...userSegments
      );
    }

    // Update profile
    profile.segments = userSegments;
  }

  private userMatchesSegment(
    profile: UserProfile,
    segment: SegmentDefinition
  ): boolean {
    return segment.criteria.every((criteria) => {
      const value = this.getValueFromPath(criteria.field, { profile });

      switch (criteria.operator) {
        case "equals":
          return value === criteria.value;
        case "greater_than":
          return Number(value) > Number(criteria.value);
        case "less_than":
          return Number(value) < Number(criteria.value);
        case "contains":
          return String(value).includes(String(criteria.value));
        case "in":
          return (
            Array.isArray(criteria.value) && criteria.value.includes(value)
          );
        case "between":
          return (
            Array.isArray(criteria.value) &&
            Number(value) >= Number(criteria.value[0]) &&
            Number(value) <= Number(criteria.value[1])
          );
        default:
          return false;
      }
    });
  }

  private async getSegment(
    segmentId: string,
    storeId: string
  ): Promise<SegmentDefinition | null> {
    const data = await this.redis.hget(`segments:${storeId}`, segmentId);
    return data ? (JSON.parse(data) as SegmentDefinition) : null;
  }

  private async getPersonalizationRule(
    ruleId: string,
    storeId: string
  ): Promise<PersonalizationRule | null> {
    const data = await this.redis.hget(
      `personalization:rules:${storeId}`,
      ruleId
    );
    return data ? (JSON.parse(data) as PersonalizationRule) : null;
  }

  private async recalculateSegment(
    segmentId: string,
    storeId: string
  ): Promise<void> {
    // This would recalculate which users belong to this segment
    // For now, just update the timestamp
    const segment = await this.getSegment(segmentId, storeId);
    if (segment) {
      segment.updatedAt = new Date();
      await this.redis.hset(
        `segments:${storeId}`,
        segmentId,
        JSON.stringify(segment)
      );
    }
  }
}

export { PersonalizationService };
