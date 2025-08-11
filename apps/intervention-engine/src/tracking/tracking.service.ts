import { Logger, MetricsCollector } from "@libs/monitoring";
import { RedisClient } from "@libs/database";
import {
  TrackingEvent,
  ConversionEvent,
  UserJourney,
  InterventionMetrics,
  AttributionModel,
} from "./types";

export class TrackingService {
  private redis: any;
  private defaultAttributionModel: AttributionModel = {
    type: "last_touch",
    windowDays: 7,
  };

  constructor(private logger: Logger, private metrics: MetricsCollector) {
    this.redis = RedisClient.getInstance();
  }

  /**
   * Track intervention event
   */
  async trackEvent(
    event: Omit<TrackingEvent, "id" | "timestamp">
  ): Promise<string> {
    const trackingEvent: TrackingEvent = {
      ...event,
      id: this.generateEventId(),
      timestamp: new Date(),
    };

    try {
      // Store event in multiple formats for different query patterns
      await Promise.all([
        // Store raw event
        this.storeRawEvent(trackingEvent),

        // Update real-time metrics
        this.updateRealTimeMetrics(trackingEvent),

        // Update user journey
        this.updateUserJourney(trackingEvent),

        // Update campaign metrics
        this.updateCampaignMetrics(trackingEvent),
      ]);

      this.logger.info("Event tracked successfully", {
        eventId: trackingEvent.id,
        type: event.type,
        userId: event.userId,
        campaignId: event.campaignId,
        channel: event.channel,
      });

      this.metrics.recordCounter("tracking.events.recorded", 1, {
        type: event.type,
        channel: event.channel,
        campaignId: event.campaignId,
      });

      return trackingEvent.id;
    } catch (error) {
      this.logger.error("Failed to track event", error as Error, {
        type: event.type,
        userId: event.userId,
        campaignId: event.campaignId,
      });

      this.metrics.recordCounter("tracking.events.failed", 1, {
        type: event.type,
        channel: event.channel,
      });

      throw error;
    }
  }

  /**
   * Track conversion event with attribution
   */
  async trackConversion(
    conversion: Omit<ConversionEvent, "id" | "attribution" | "timeToConversion">
  ): Promise<string> {
    try {
      // Get user journey to calculate attribution
      const userJourney = await this.getUserJourney(
        conversion.userId,
        conversion.storeId
      );

      // Calculate attribution
      const attribution = this.calculateAttribution(
        userJourney,
        this.defaultAttributionModel
      );

      // Calculate time to conversion
      const timeToConversion = this.calculateTimeToConversion(
        userJourney,
        conversion.timestamp
      );

      const conversionEvent: ConversionEvent = {
        ...conversion,
        id: this.generateEventId(),
        attribution,
        timeToConversion,
      };

      // Store conversion event
      await Promise.all([
        this.storeConversionEvent(conversionEvent),
        this.updateConversionMetrics(conversionEvent),
        this.updateUserJourneyConversion(conversionEvent),
      ]);

      this.logger.info("Conversion tracked successfully", {
        conversionId: conversionEvent.id,
        userId: conversion.userId,
        orderId: conversion.orderId,
        value: conversion.orderValue,
        timeToConversion: timeToConversion,
      });

      this.metrics.recordCounter("tracking.conversions.recorded", 1, {
        campaignId: conversion.campaignId,
        storeId: conversion.storeId,
      });

      this.metrics.recordGauge(
        "tracking.conversion_value",
        conversion.orderValue,
        {
          campaignId: conversion.campaignId,
          currency: conversion.currency,
        }
      );

      return conversionEvent.id;
    } catch (error) {
      this.logger.error("Failed to track conversion", error as Error, {
        userId: conversion.userId,
        orderId: conversion.orderId,
      });

      this.metrics.recordCounter("tracking.conversions.failed", 1);
      throw error;
    }
  }

  /**
   * Get intervention metrics for campaign
   */
  async getCampaignMetrics(
    campaignId: string,
    storeId: string,
    startDate: Date,
    endDate: Date
  ): Promise<InterventionMetrics> {
    try {
      const timeRange = { start: startDate, end: endDate };

      // Get aggregated metrics from Redis
      const totals = await this.getCampaignTotals(
        campaignId,
        storeId,
        startDate,
        endDate
      );
      const channelBreakdown = await this.getChannelBreakdown(
        campaignId,
        storeId,
        startDate,
        endDate
      );
      const revenue = await this.getRevenueMetrics(
        campaignId,
        storeId,
        startDate,
        endDate
      );
      const timeToConversion = await this.getTimeToConversionMetrics(
        campaignId,
        storeId,
        startDate,
        endDate
      );

      // Calculate rates
      const rates = {
        deliveryRate:
          totals.triggered > 0 ? totals.delivered / totals.triggered : 0,
        openRate: totals.delivered > 0 ? totals.opened / totals.delivered : 0,
        clickRate: totals.opened > 0 ? totals.clicked / totals.opened : 0,
        conversionRate:
          totals.clicked > 0 ? totals.converted / totals.clicked : 0,
        dismissalRate:
          totals.delivered > 0 ? totals.dismissed / totals.delivered : 0,
      };

      const metrics: InterventionMetrics = {
        campaignId,
        storeId,
        timeRange,
        totals,
        rates,
        channelBreakdown,
        revenue,
        timeToConversion,
      };

      this.logger.debug("Campaign metrics retrieved", {
        campaignId,
        storeId,
        timeRange,
        totals,
      });

      return metrics;
    } catch (error) {
      this.logger.error("Failed to get campaign metrics", error as Error, {
        campaignId,
        storeId,
      });
      throw error;
    }
  }

  /**
   * Get user journey
   */
  async getUserJourney(
    userId: string,
    storeId: string
  ): Promise<UserJourney | null> {
    try {
      const journeyKey = `journey:${storeId}:${userId}`;
      const journeyData = await this.redis.get(journeyKey);

      if (!journeyData) {
        return null;
      }

      const journey: UserJourney = JSON.parse(journeyData);

      this.logger.debug("User journey retrieved", {
        userId,
        storeId,
        touchpoints: journey.touchpoints.length,
        status: journey.status,
      });

      return journey;
    } catch (error) {
      this.logger.error("Failed to get user journey", error as Error, {
        userId,
        storeId,
      });
      return null;
    }
  }

  /**
   * Store raw tracking event
   */
  private async storeRawEvent(event: TrackingEvent): Promise<void> {
    const eventKey = `event:${event.id}`;
    const userEventsKey = `events:user:${event.storeId}:${event.userId}`;
    const campaignEventsKey = `events:campaign:${event.campaignId}`;

    const eventData = JSON.stringify(event);
    const timestamp = event.timestamp.getTime();

    await Promise.all([
      // Store individual event
      this.redis.setex(eventKey, 86400 * 30, eventData), // 30 days TTL

      // Add to user events timeline
      this.redis.zadd(userEventsKey, timestamp, event.id),

      // Add to campaign events timeline
      this.redis.zadd(campaignEventsKey, timestamp, event.id),

      // Clean up old events (keep last 1000 per user)
      this.redis.zremrangebyrank(userEventsKey, 0, -1001),
    ]);
  }

  /**
   * Update real-time metrics
   */
  private async updateRealTimeMetrics(event: TrackingEvent): Promise<void> {
    const hourKey = `metrics:hour:${event.storeId}:${this.getHourKey(
      event.timestamp
    )}`;
    const dayKey = `metrics:day:${event.storeId}:${this.getDayKey(
      event.timestamp
    )}`;

    const metricField = `${event.type}:${event.channel}`;

    await Promise.all([
      this.redis.hincrby(hourKey, metricField, 1),
      this.redis.hincrby(dayKey, metricField, 1),
      this.redis.expire(hourKey, 86400 * 7), // 7 days TTL
      this.redis.expire(dayKey, 86400 * 30), // 30 days TTL
    ]);
  }

  /**
   * Update user journey
   */
  private async updateUserJourney(event: TrackingEvent): Promise<void> {
    const journeyKey = `journey:${event.storeId}:${event.userId}`;

    let journey = await this.getUserJourney(event.userId, event.storeId);

    if (!journey) {
      journey = {
        userId: event.userId,
        storeId: event.storeId,
        sessionId: event.sessionId,
        startTime: event.timestamp,
        status: "active",
        touchpoints: [],
        summary: {
          totalInterventions: 0,
          channelsUsed: [],
        },
      };
    }

    // Add touchpoint
    journey.touchpoints.push({
      timestamp: event.timestamp,
      type: event.type,
      channel: event.channel,
      interventionId: event.interventionId,
      campaignId: event.campaignId,
      metadata: event.metadata,
    });

    // Update summary
    if (event.type === "intervention_triggered") {
      journey.summary.totalInterventions++;
    }

    if (!journey.summary.channelsUsed.includes(event.channel)) {
      journey.summary.channelsUsed.push(event.channel);
    }

    // Store updated journey
    await this.redis.setex(journeyKey, 86400 * 30, JSON.stringify(journey));
  }

  /**
   * Update campaign metrics
   */
  private async updateCampaignMetrics(event: TrackingEvent): Promise<void> {
    const campaignKey = `campaign_metrics:${event.campaignId}:${event.storeId}`;
    const fieldKey = `${event.type}:${event.channel}`;

    await this.redis.hincrby(campaignKey, fieldKey, 1);
    await this.redis.expire(campaignKey, 86400 * 90); // 90 days TTL
  }

  /**
   * Store conversion event
   */
  private async storeConversionEvent(
    conversion: ConversionEvent
  ): Promise<void> {
    const conversionKey = `conversion:${conversion.id}`;
    const campaignConversionsKey = `conversions:campaign:${conversion.campaignId}`;
    const userConversionsKey = `conversions:user:${conversion.storeId}:${conversion.userId}`;

    const conversionData = JSON.stringify(conversion);
    const timestamp = conversion.timestamp.getTime();

    await Promise.all([
      // Store individual conversion
      this.redis.setex(conversionKey, 86400 * 90, conversionData), // 90 days TTL

      // Add to campaign conversions
      this.redis.zadd(campaignConversionsKey, timestamp, conversion.id),

      // Add to user conversions
      this.redis.zadd(userConversionsKey, timestamp, conversion.id),
    ]);
  }

  /**
   * Update conversion metrics
   */
  private async updateConversionMetrics(
    conversion: ConversionEvent
  ): Promise<void> {
    const campaignKey = `campaign_metrics:${conversion.campaignId}:${conversion.storeId}`;
    const revenueKey = `campaign_revenue:${conversion.campaignId}:${conversion.storeId}`;

    await Promise.all([
      this.redis.hincrby(campaignKey, "conversions", 1),
      this.redis.hincrbyfloat(revenueKey, "total_value", conversion.orderValue),
      this.redis.hincrby(revenueKey, "total_orders", 1),
    ]);
  }

  /**
   * Update user journey with conversion
   */
  private async updateUserJourneyConversion(
    conversion: ConversionEvent
  ): Promise<void> {
    const journeyKey = `journey:${conversion.storeId}:${conversion.userId}`;
    const journey = await this.getUserJourney(
      conversion.userId,
      conversion.storeId
    );

    if (journey) {
      journey.status = "converted";
      journey.endTime = conversion.timestamp;
      journey.conversion = conversion;
      journey.summary.conversionValue = conversion.orderValue;
      journey.summary.timeToConversion = conversion.timeToConversion;

      await this.redis.setex(journeyKey, 86400 * 90, JSON.stringify(journey)); // Extended TTL for conversions
    }
  }

  /**
   * Calculate attribution based on user journey
   */
  private calculateAttribution(
    journey: UserJourney | null,
    model: AttributionModel
  ): any {
    if (!journey || journey.touchpoints.length === 0) {
      return {
        firstTouch: null,
        lastTouch: null,
        touchpoints: [],
      };
    }

    const interventionTouchpoints = journey.touchpoints.filter(
      (tp) =>
        tp.type === "intervention_triggered" ||
        tp.type === "intervention_delivered"
    );

    if (interventionTouchpoints.length === 0) {
      return {
        firstTouch: null,
        lastTouch: null,
        touchpoints: [],
      };
    }

    const firstTouch = interventionTouchpoints[0];
    const lastTouch =
      interventionTouchpoints[interventionTouchpoints.length - 1];

    return {
      firstTouch: firstTouch.channel,
      lastTouch: lastTouch.channel,
      touchpoints: interventionTouchpoints.map((tp) => ({
        channel: tp.channel,
        timestamp: tp.timestamp,
        interventionId: tp.interventionId,
      })),
    };
  }

  /**
   * Calculate time to conversion
   */
  private calculateTimeToConversion(
    journey: UserJourney | null,
    conversionTime: Date
  ): number {
    if (!journey || journey.touchpoints.length === 0) {
      return 0;
    }

    const firstIntervention = journey.touchpoints.find(
      (tp) => tp.type === "intervention_triggered"
    );

    if (!firstIntervention) {
      return 0;
    }

    return conversionTime.getTime() - firstIntervention.timestamp.getTime();
  }

  /**
   * Get campaign totals from Redis
   */
  private async getCampaignTotals(
    campaignId: string,
    storeId: string,
    startDate: Date,
    endDate: Date
  ): Promise<any> {
    // Mock implementation - in production, aggregate from time-series data
    return {
      triggered: 100,
      delivered: 95,
      opened: 38,
      clicked: 15,
      dismissed: 12,
      converted: 8,
    };
  }

  /**
   * Get channel breakdown
   */
  private async getChannelBreakdown(
    campaignId: string,
    storeId: string,
    startDate: Date,
    endDate: Date
  ): Promise<any> {
    // Mock implementation
    return {
      websocket: {
        delivered: 40,
        opened: 20,
        clicked: 8,
        converted: 4,
        conversionValue: 1200,
      },
      email: {
        delivered: 35,
        opened: 12,
        clicked: 5,
        converted: 3,
        conversionValue: 900,
      },
      sms: {
        delivered: 15,
        opened: 4,
        clicked: 2,
        converted: 1,
        conversionValue: 300,
      },
      push: {
        delivered: 5,
        opened: 2,
        clicked: 0,
        converted: 0,
        conversionValue: 0,
      },
    };
  }

  /**
   * Get revenue metrics
   */
  private async getRevenueMetrics(
    campaignId: string,
    storeId: string,
    startDate: Date,
    endDate: Date
  ): Promise<any> {
    // Mock implementation
    return {
      totalValue: 2400,
      averageOrderValue: 300,
      totalRecovered: 1800,
      currency: "USD",
    };
  }

  /**
   * Get time to conversion metrics
   */
  private async getTimeToConversionMetrics(
    campaignId: string,
    storeId: string,
    startDate: Date,
    endDate: Date
  ): Promise<any> {
    // Mock implementation
    return {
      average: 3600000, // 1 hour in milliseconds
      median: 2700000, // 45 minutes
      percentiles: {
        p25: 1800000, // 30 minutes
        p75: 5400000, // 1.5 hours
        p90: 7200000, // 2 hours
      },
    };
  }

  /**
   * Generate unique event ID
   */
  private generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get hour key for time-based aggregation
   */
  private getHourKey(date: Date): string {
    return `${date.getFullYear()}-${(date.getMonth() + 1)
      .toString()
      .padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")}-${date
      .getHours()
      .toString()
      .padStart(2, "0")}`;
  }

  /**
   * Get day key for time-based aggregation
   */
  private getDayKey(date: Date): string {
    return `${date.getFullYear()}-${(date.getMonth() + 1)
      .toString()
      .padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")}`;
  }
}
