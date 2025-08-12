export interface UserProfile {
  userId: string;
  storeId: string;
  demographics: Demographics;
  behavioral: BehavioralData;
  preferences: UserPreferences;
  segments: string[];
  scores: UserScores;
  lastUpdated: Date;
}

export interface Demographics {
  age?: number;
  gender?: "male" | "female" | "other";
  location?: {
    country?: string;
    state?: string;
    city?: string;
    zipCode?: string;
    timezone?: string;
  };
  language?: string;
  customerType: "new" | "returning" | "vip";
  registrationDate?: Date;
}

export interface BehavioralData {
  purchaseHistory: PurchaseData;
  browsingBehavior: BrowsingData;
  engagementMetrics: EngagementData;
  activityLevel: "low" | "medium" | "high";
  lastActivity: Date;
}

export interface PurchaseData {
  totalOrders: number;
  totalSpent: number;
  averageOrderValue: number;
  lastPurchaseDate?: Date;
  favoriteCategories: string[];
  purchaseFrequency: "rarely" | "occasionally" | "regularly" | "frequently";
  seasonalTrends: Record<string, number>; // month -> spending
}

export interface BrowsingData {
  pagesViewed: number;
  sessionsCount: number;
  averageSessionDuration: number; // minutes
  bounceRate: number; // percentage
  deviceTypes: Record<string, number>; // device -> count
  referralSources: Record<string, number>; // source -> count
  searchTerms: string[];
}

export interface EngagementData {
  emailEngagement: {
    opens: number;
    clicks: number;
    openRate: number;
    clickRate: number;
  };
  notificationEngagement: {
    pushOpens: number;
    smsClicks: number;
    webSocketInteractions: number;
  };
  socialEngagement?: {
    shares: number;
    likes: number;
    comments: number;
  };
}

export interface UserPreferences {
  communication: {
    email: boolean;
    sms: boolean;
    push: boolean;
    frequency: "immediate" | "daily" | "weekly" | "never";
    timePreference?: string; // HH:mm format
  };
  content: {
    categories: string[];
    brands: string[];
    priceRange?: { min: number; max: number };
    discountThreshold?: number; // minimum discount percentage
  };
  privacy: {
    allowTracking: boolean;
    allowPersonalization: boolean;
    allowRecommendations: boolean;
  };
}

export interface UserScores {
  churnRisk: number; // 0-100
  engagementScore: number; // 0-100
  lifetimeValue: number; // predicted CLV
  conversionProbability: number; // 0-100
  recommendationRelevance: number; // 0-100
  lastCalculated: Date;
}

export interface PersonalizationRule {
  id: string;
  name: string;
  description?: string;
  storeId: string;
  conditions: PersonalizationCondition[];
  actions: PersonalizationAction[];
  priority: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PersonalizationCondition {
  field: string; // user profile field path
  operator:
    | "equals"
    | "greater_than"
    | "less_than"
    | "contains"
    | "in"
    | "not_in"
    | "exists";
  value: any;
}

export interface PersonalizationAction {
  type:
    | "content_variant"
    | "recommendation"
    | "discount"
    | "timing"
    | "channel";
  config: ActionConfig;
}

export interface ActionConfig {
  // Content variant
  templateId?: string;
  content?: Record<string, any>;

  // Recommendation
  algorithm?: "collaborative" | "content_based" | "hybrid";
  itemCount?: number;
  categories?: string[];

  // Discount
  discountType?: "percentage" | "fixed" | "free_shipping";
  discountValue?: number;
  minOrderValue?: number;

  // Timing
  delay?: number; // minutes
  optimalTime?: boolean;

  // Channel
  preferredChannel?: string;
  fallbackChannels?: string[];
}

export interface PersonalizationContext {
  userId: string;
  storeId: string;
  sessionId?: string;
  currentPage?: string;
  cartItems?: any[];
  recentlyViewed?: any[];
  currentLocation?: {
    lat: number;
    lng: number;
  };
  deviceType?: string;
  referrer?: string;
  campaignContext?: {
    campaignId: string;
    variantId?: string;
  };
  timestamp: Date;
}

export interface PersonalizationResult {
  userId: string;
  content: PersonalizedContent;
  recommendations: Recommendation[];
  offers: PersonalizedOffer[];
  timing: OptimalTiming;
  appliedRules: string[];
  confidence: number; // 0-100
}

export interface PersonalizedContent {
  subject?: string;
  headline?: string;
  body: string;
  images?: string[];
  ctaText?: string;
  ctaUrl?: string;
  variables: Record<string, any>;
}

export interface Recommendation {
  itemId: string;
  title: string;
  description?: string;
  imageUrl?: string;
  price?: number;
  originalPrice?: number;
  category: string;
  score: number; // relevance score 0-100
  reason: string; // why recommended
}

export interface PersonalizedOffer {
  id: string;
  type: "discount" | "free_shipping" | "upgrade" | "bundle";
  value: number;
  description: string;
  validUntil?: Date;
  conditions?: string[];
}

export interface OptimalTiming {
  bestTimeToSend?: Date;
  bestChannel: string;
  confidence: number;
  timezone: string;
}

export interface SegmentDefinition {
  id: string;
  name: string;
  description?: string;
  storeId: string;
  criteria: SegmentCriteria[];
  userCount?: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SegmentCriteria {
  field: string;
  operator:
    | "equals"
    | "greater_than"
    | "less_than"
    | "contains"
    | "in"
    | "between";
  value: any;
  logic?: "AND" | "OR";
}

export interface PersonalizationService {
  // User profiles
  updateUserProfile(
    userId: string,
    storeId: string,
    data: Partial<UserProfile>
  ): Promise<UserProfile>;
  getUserProfile(userId: string, storeId: string): Promise<UserProfile | null>;
  calculateUserScores(userId: string, storeId: string): Promise<UserScores>;

  // Personalization
  personalizeContent(
    context: PersonalizationContext
  ): Promise<PersonalizationResult>;
  generateRecommendations(
    userId: string,
    storeId: string,
    type: string,
    count?: number
  ): Promise<Recommendation[]>;
  getPersonalizedOffers(
    userId: string,
    storeId: string
  ): Promise<PersonalizedOffer[]>;

  // Segmentation
  createSegment(
    storeId: string,
    definition: Omit<SegmentDefinition, "id" | "createdAt" | "updatedAt">
  ): Promise<SegmentDefinition>;
  updateSegment(
    segmentId: string,
    storeId: string,
    definition: Partial<SegmentDefinition>
  ): Promise<SegmentDefinition>;
  getUserSegments(userId: string, storeId: string): Promise<string[]>;
  getSegmentUsers(segmentId: string, storeId: string): Promise<string[]>;

  // Rules
  createPersonalizationRule(
    storeId: string,
    rule: Omit<PersonalizationRule, "id" | "createdAt" | "updatedAt">
  ): Promise<PersonalizationRule>;
  updatePersonalizationRule(
    ruleId: string,
    storeId: string,
    rule: Partial<PersonalizationRule>
  ): Promise<PersonalizationRule>;
  getPersonalizationRules(storeId: string): Promise<PersonalizationRule[]>;

  // Optimal timing
  getOptimalSendTime(
    userId: string,
    storeId: string,
    channel: string
  ): Promise<Date>;
  getBestChannel(userId: string, storeId: string): Promise<string>;
}
