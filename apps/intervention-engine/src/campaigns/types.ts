export interface Campaign {
  id: string;
  storeId: string;
  name: string;
  description?: string;
  type: CampaignType;
  status: CampaignStatus;
  triggerConditions: TriggerCondition[];
  channels: DeliveryChannel[];
  schedule?: CampaignSchedule;
  targeting: TargetingRules;
  content: CampaignContent;
  abTest?: ABTestConfig;
  budget?: CampaignBudget;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}

export type CampaignType =
  | "cart_abandonment"
  | "welcome_series"
  | "product_recommendation"
  | "re_engagement"
  | "win_back"
  | "promotional"
  | "custom";

export type CampaignStatus =
  | "draft"
  | "scheduled"
  | "active"
  | "paused"
  | "completed"
  | "archived";

export type DeliveryChannel = "email" | "sms" | "push" | "websocket" | "popup";

export interface TriggerCondition {
  type: TriggerType;
  operator:
    | "equals"
    | "greater_than"
    | "less_than"
    | "contains"
    | "in"
    | "not_in";
  value: any;
  timeframe?: number; // minutes
}

export type TriggerType =
  | "cart_abandoned"
  | "page_viewed"
  | "product_viewed"
  | "user_inactive"
  | "purchase_completed"
  | "session_started"
  | "custom_event";

export interface CampaignSchedule {
  startDate?: Date;
  endDate?: Date;
  timezone: string;
  frequency?: ScheduleFrequency;
  dayOfWeek?: number[]; // 0-6, Sunday=0
  timeOfDay?: string; // HH:mm format
}

export interface ScheduleFrequency {
  type: "once" | "daily" | "weekly" | "monthly";
  interval: number; // every N days/weeks/months
}

export interface TargetingRules {
  segments: string[]; // segment IDs
  demographics?: DemographicFilter;
  behavioral?: BehavioralFilter;
  geographic?: GeographicFilter;
  customAttributes?: Record<string, any>;
  excludeSegments?: string[];
}

export interface DemographicFilter {
  ageMin?: number;
  ageMax?: number;
  gender?: "male" | "female" | "other";
  language?: string[];
  customerType?: "new" | "returning" | "vip";
}

export interface BehavioralFilter {
  purchaseHistory?: {
    totalOrders?: { min?: number; max?: number };
    totalValue?: { min?: number; max?: number };
    lastPurchase?: { days?: number }; // days ago
    categories?: string[];
  };
  engagementScore?: { min?: number; max?: number };
  activityLevel?: "low" | "medium" | "high";
}

export interface GeographicFilter {
  countries?: string[];
  states?: string[];
  cities?: string[];
  zipCodes?: string[];
  radius?: { lat: number; lng: number; km: number };
}

export interface CampaignContent {
  templates: ChannelTemplate[];
  variables: ContentVariable[];
  personalization: PersonalizationConfig;
}

export interface ChannelTemplate {
  channel: DeliveryChannel;
  templateId: string;
  subject?: string; // for email
  fallbackContent?: string;
  priority: number; // 1-10
}

export interface ContentVariable {
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  defaultValue?: any;
  required: boolean;
  description?: string;
}

export interface PersonalizationConfig {
  useUserName: boolean;
  useLocation: boolean;
  usePurchaseHistory: boolean;
  useRecommendations: boolean;
  dynamicContent: DynamicContentRule[];
}

export interface DynamicContentRule {
  condition: string; // JavaScript expression
  content: Record<string, any>;
  priority: number;
}

export interface ABTestConfig {
  enabled: boolean;
  variants: ABTestVariant[];
  trafficSplit: number[]; // percentages, must sum to 100
  metrics: string[]; // metric names to track
  duration?: number; // days
  minSampleSize?: number;
  confidenceLevel: number; // 0.95, 0.99, etc.
}

export interface ABTestVariant {
  id: string;
  name: string;
  description?: string;
  content: CampaignContent;
  weight: number; // percentage of traffic
}

export interface CampaignBudget {
  totalBudget?: number;
  dailyBudget?: number;
  currency: string;
  costPerChannel: Record<DeliveryChannel, number>;
  spentAmount: number;
  remainingBudget: number;
}

export interface CampaignMetrics {
  campaignId: string;
  impressions: number;
  opens: number;
  clicks: number;
  conversions: number;
  revenue: number;
  cost: number;
  roi: number;
  conversionRate: number;
  clickThroughRate: number;
  openRate: number;
  channelBreakdown: Record<DeliveryChannel, ChannelMetrics>;
  lastUpdated: Date;
}

export interface ChannelMetrics {
  impressions: number;
  opens: number;
  clicks: number;
  conversions: number;
  revenue: number;
  cost: number;
}

export interface CampaignExecution {
  id: string;
  campaignId: string;
  userId: string;
  storeId: string;
  variant?: string; // for A/B tests
  channels: DeliveryChannel[];
  status: ExecutionStatus;
  scheduledAt: Date;
  executedAt?: Date;
  completedAt?: Date;
  results: ExecutionResult[];
  metadata: Record<string, any>;
}

export type ExecutionStatus =
  | "pending"
  | "scheduled"
  | "executing"
  | "completed"
  | "failed"
  | "cancelled";

export interface ExecutionResult {
  channel: DeliveryChannel;
  status: "sent" | "delivered" | "opened" | "clicked" | "converted" | "failed";
  timestamp: Date;
  deliveryId?: string;
  errorMessage?: string;
  metadata?: Record<string, any>;
}

export interface CampaignCreateRequest {
  name: string;
  description?: string;
  type: CampaignType;
  triggerConditions: TriggerCondition[];
  channels: DeliveryChannel[];
  schedule?: CampaignSchedule;
  targeting: TargetingRules;
  content: CampaignContent;
  abTest?: ABTestConfig;
  budget?: Omit<CampaignBudget, "spentAmount" | "remainingBudget">;
}

export interface CampaignUpdateRequest {
  name?: string;
  description?: string;
  status?: CampaignStatus;
  triggerConditions?: TriggerCondition[];
  channels?: DeliveryChannel[];
  schedule?: CampaignSchedule;
  targeting?: TargetingRules;
  content?: CampaignContent;
  abTest?: ABTestConfig;
  budget?: Partial<CampaignBudget>;
}

export interface CampaignListFilter {
  status?: CampaignStatus[];
  type?: CampaignType[];
  channels?: DeliveryChannel[];
  createdAfter?: Date;
  createdBefore?: Date;
  search?: string;
  limit?: number;
  offset?: number;
}
