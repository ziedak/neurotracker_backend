export interface TrackingEvent {
  id: string;
  type:
    | "intervention_triggered"
    | "intervention_delivered"
    | "intervention_opened"
    | "intervention_clicked"
    | "intervention_dismissed"
    | "intervention_converted"
    | "email_opened"
    | "email_clicked"
    | "sms_delivered"
    | "push_opened"
    | "cart_recovered";
  timestamp: Date;
  userId: string;
  storeId: string;
  sessionId?: string;
  interventionId: string;
  campaignId: string;
  deliveryId?: string;
  channel: "websocket" | "email" | "sms" | "push";
  metadata: {
    userAgent?: string;
    ipAddress?: string;
    referrer?: string;
    deviceType?: "mobile" | "desktop" | "tablet";
    browser?: string;
    os?: string;
    location?: {
      country?: string;
      region?: string;
      city?: string;
    };
    value?: number; // For conversion events
    currency?: string;
    [key: string]: any;
  };
}

export interface ConversionEvent {
  id: string;
  userId: string;
  storeId: string;
  interventionId: string;
  campaignId: string;
  orderId: string;
  orderValue: number;
  currency: string;
  timestamp: Date;
  timeToConversion: number; // milliseconds from intervention to conversion
  attribution: {
    firstTouch?: string; // First intervention channel
    lastTouch?: string; // Last intervention channel before conversion
    touchpoints: Array<{
      channel: string;
      timestamp: Date;
      interventionId: string;
    }>;
  };
  metadata: {
    recoveredCartValue?: number;
    discountUsed?: boolean;
    discountAmount?: number;
    itemsRecovered?: number;
    [key: string]: any;
  };
}

export interface InterventionMetrics {
  campaignId: string;
  storeId: string;
  timeRange: {
    start: Date;
    end: Date;
  };
  totals: {
    triggered: number;
    delivered: number;
    opened: number;
    clicked: number;
    dismissed: number;
    converted: number;
  };
  rates: {
    deliveryRate: number; // delivered / triggered
    openRate: number; // opened / delivered
    clickRate: number; // clicked / opened
    conversionRate: number; // converted / clicked
    dismissalRate: number; // dismissed / delivered
  };
  channelBreakdown: {
    [channel: string]: {
      delivered: number;
      opened: number;
      clicked: number;
      converted: number;
      conversionValue: number;
    };
  };
  revenue: {
    totalValue: number;
    averageOrderValue: number;
    totalRecovered: number;
    currency: string;
  };
  timeToConversion: {
    average: number;
    median: number;
    percentiles: {
      p25: number;
      p75: number;
      p90: number;
    };
  };
}

export interface UserJourney {
  userId: string;
  storeId: string;
  sessionId?: string;
  startTime: Date;
  endTime?: Date;
  status: "active" | "converted" | "abandoned";
  touchpoints: Array<{
    timestamp: Date;
    type: string;
    channel: string;
    interventionId: string;
    campaignId: string;
    metadata: any;
  }>;
  conversion?: ConversionEvent;
  summary: {
    totalInterventions: number;
    channelsUsed: string[];
    timeToConversion?: number;
    conversionValue?: number;
  };
}

export interface PerformanceMetrics {
  storeId: string;
  period: "hour" | "day" | "week" | "month";
  timestamp: Date;
  metrics: {
    // Volume metrics
    interventionsTriggered: number;
    interventionsDelivered: number;
    uniqueUsersReached: number;

    // Engagement metrics
    totalOpens: number;
    totalClicks: number;
    averageEngagementTime: number;

    // Conversion metrics
    totalConversions: number;
    conversionRevenue: number;
    averageOrderValue: number;

    // Performance metrics
    averageDeliveryTime: number;
    deliverySuccessRate: number;

    // Channel performance
    channelPerformance: {
      [channel: string]: {
        delivered: number;
        opened: number;
        clicked: number;
        converted: number;
        revenue: number;
      };
    };
  };
}

export interface AttributionModel {
  type:
    | "first_touch"
    | "last_touch"
    | "linear"
    | "time_decay"
    | "position_based";
  windowDays: number; // Attribution window in days
  weights?: {
    [position: string]: number; // For position-based attribution
  };
}

export interface CohortAnalysis {
  cohortDate: Date;
  storeId: string;
  campaignId?: string;
  usersInCohort: number;
  conversionsByDay: { [day: number]: number };
  revenueByDay: { [day: number]: number };
  retentionByDay: { [day: number]: number };
}
