import { Logger, MetricsCollector } from "@libs/monitoring";
import { getEnv, getNumberEnv } from "@libs/config";
import { Recommendation, PersonalizedOffer, UserProfile } from "./types";
import { DataAccessService } from "./data-access.service";

export class RecommendationService {
  /**
   * Personalized price sensitivity
   */
  getPriceSensitiveRecommendations(
    profile: UserProfile,
    count: number
  ): Recommendation[] {
    const avg = profile.behavioral.purchaseHistory.averageOrderValue;
    return profile.behavioral.purchaseHistory.favoriteCategories
      .slice(0, count)
      .map((category, i) => ({
        itemId: `price_${category}_${i}`,
        title: `Best Value: ${category}`,
        description: `Products around your typical spend (${avg})`,
        category,
        score: 80 - i * 2,
        reason: "Matches your price sensitivity",
      }));
  }

  /**
   * Brand affinity
   */
  getBrandAffinityRecommendations(
    profile: UserProfile,
    count: number
  ): Recommendation[] {
    const brands = profile.preferences.content.brands || [];
    return brands.slice(0, count).map((brand, i) => ({
      itemId: `brand_${brand}_${i}`,
      title: `Top ${brand} Picks`,
      description: `Recommended from your favorite brand: ${brand}`,
      category: "brand",
      score: 85 - i * 3,
      reason: "Brand affinity",
    }));
  }

  /**
   * Time-of-day/recency
   */
  getRecencyRecommendations(
    profile: UserProfile,
    count: number
  ): Recommendation[] {
    const hour = new Date().getHours();
    return profile.behavioral.browsingBehavior.searchTerms
      .slice(0, count)
      .map((term, i) => ({
        itemId: `recency_${term}_${hour}_${i}`,
        title: `Active Now: ${term}`,
        description: `Recommended for your current activity window`,
        category: "general",
        score: 75 - i * 2,
        reason: "Recency/time-of-day",
      }));
  }

  /**
   * Geo-targeted
   */
  getGeoTargetedRecommendations(
    profile: UserProfile,
    count: number
  ): Recommendation[] {
    const loc =
      profile.demographics.location?.city ||
      profile.demographics.location?.country ||
      "your area";
    return profile.behavioral.purchaseHistory.favoriteCategories
      .slice(0, count)
      .map((category, i) => ({
        itemId: `geo_${category}_${loc}_${i}`,
        title: `Local Pick: ${category}`,
        description: `Popular in ${loc}`,
        category,
        score: 78 - i * 2,
        reason: "Geo-targeted",
      }));
  }

  /**
   * Behavioral segmentation
   */
  getSegmentRecommendations(
    profile: UserProfile,
    count: number
  ): Recommendation[] {
    const segment = profile.segments?.[0] || "general";
    return profile.behavioral.purchaseHistory.favoriteCategories
      .slice(0, count)
      .map((category, i) => ({
        itemId: `segment_${segment}_${category}_${i}`,
        title: `Segment Pick: ${category}`,
        description: `Recommended for ${segment} users`,
        category,
        score: 80 - i * 2,
        reason: `Segment: ${segment}`,
      }));
  }

  /**
   * Cross-category discovery
   */
  getCrossCategoryRecommendations(
    profile: UserProfile,
    count: number
  ): Recommendation[] {
    // Stub: Suggest adjacent categories (simulate with reversed list)
    const categories = profile.behavioral.purchaseHistory.favoriteCategories
      .slice()
      .reverse();
    return categories.slice(0, count).map((category, i) => ({
      itemId: `cross_${category}_${i}`,
      title: `Discover: ${category}`,
      description: `Explore adjacent category: ${category}`,
      category,
      score: 76 - i * 2,
      reason: "Cross-category discovery",
    }));
  }

  /**
   * Custom campaign/experiment
   */
  getCampaignRecommendations(
    profile: UserProfile,
    count: number,
    campaignId?: string
  ): Recommendation[] {
    // Stub: Use campaignId for variant
    return profile.behavioral.purchaseHistory.favoriteCategories
      .slice(0, count)
      .map((category, i) => ({
        itemId: `campaign_${campaignId || "default"}_${category}_${i}`,
        title: `Campaign Pick: ${category}`,
        description: `Recommended for campaign ${campaignId || "default"}`,
        category,
        score: 79 - i * 2,
        reason: `Campaign: ${campaignId || "default"}`,
      }));
  }
  /**
   * Frequently bought together (stub)
   */
  getFrequentlyBoughtTogetherRecommendations(
    profile: UserProfile,
    count: number
  ): Recommendation[] {
    // Stub: Replace with real association mining
    if (!profile.behavioral.purchaseHistory.favoriteCategories.length)
      return [];
    return profile.behavioral.purchaseHistory.favoriteCategories
      .slice(0, count)
      .map((category, i) => ({
        itemId: `fbt_${category}_${i}`,
        title: `Bought Together: ${category}`,
        description: `Customers often buy ${category} with your recent purchases`,
        category,
        score: 78 - i * 4,
        reason: "Frequently bought together",
      }));
  }

  /**
   * Personalized discounted items (real data)
   */
  async getDiscountedRecommendations(
    profile: UserProfile,
    count: number
  ): Promise<Recommendation[]> {
    const categories = profile.behavioral.purchaseHistory.favoriteCategories;
    const products = await this.dataAccess.getProducts({});
    const offers = await this.dataAccess.getOffers({ type: "discount" });
    const filtered = products.filter(
      (p) =>
        categories.includes(p.category) &&
        offers.some((o) => o.productId === p.id)
    );
    return filtered.slice(0, count).map((p, i) => ({
      itemId: p.id,
      title: p.name,
      description: `Special offer on ${p.name}`,
      category: p.category,
      score: 82 - i * 3,
      reason: "Personalized discount",
      imageUrl: p.imageUrl,
    }));
  }

  /**
   * Seasonal/contextual recommendations (stub)
   */
  getSeasonalRecommendations(
    profile: UserProfile,
    count: number
  ): Recommendation[] {
    // Stub: Use current month for demo
    const month = new Date().getMonth();
    return profile.behavioral.purchaseHistory.favoriteCategories
      .slice(0, count)
      .map((category, i) => ({
        itemId: `seasonal_${category}_${month}_${i}`,
        title: `Seasonal Pick: ${category}`,
        description: `Top ${category} products for this season`,
        category,
        score: 77 - i * 2,
        reason: "Seasonal recommendation",
      }));
  }
  /**
   * Trending products (global/store-level popularity)
   */
  async getTrendingRecommendations(
    storeId: string,
    count: number
  ): Promise<Recommendation[]> {
    const products = await this.dataAccess.getProducts({ isTrending: true });
    return products.slice(0, count).map((p, i) => ({
      itemId: p.id,
      title: p.name,
      description: p.imageUrl || "Popular right now",
      category: p.category,
      score: 90 - i * 5,
      reason: "Trending in your store",
      imageUrl: p.imageUrl,
    }));
  }

  /**
   * Recently viewed products by the user
   */
  getRecentlyViewedRecommendations(
    profile: UserProfile,
    count: number
  ): Recommendation[] {
    if (!profile.behavioral.browsingBehavior.searchTerms?.length) return [];
    return profile.behavioral.browsingBehavior.searchTerms
      .slice(0, count)
      .map((term, i) => ({
        itemId: `recent_${term}_${i}`,
        title: `Recently Viewed: ${term}`,
        description: `You recently searched for ${term}`,
        category: "general",
        score: 75 - i * 5,
        reason: "Based on your recent activity",
      }));
  }

  /**
   * New arrivals in favorite categories
   */
  async getNewArrivalsRecommendations(
    profile: UserProfile,
    count: number
  ): Promise<Recommendation[]> {
    const categories = profile.behavioral.purchaseHistory.favoriteCategories;
    const products = await this.dataAccess.getProducts({ isNew: true });
    const filtered = products.filter((p) => categories.includes(p.category));
    return filtered.slice(0, count).map((p, i) => ({
      itemId: p.id,
      title: p.name,
      description: p.imageUrl || `Check out new products in ${p.category}`,
      category: p.category,
      score: 80 - i * 3,
      reason: "New in your favorite category",
      imageUrl: p.imageUrl,
    }));
  }
  public logger: ILogger;
  public metrics: MetricsCollector;
  public dataAccess: DataAccessService;
  constructor(
    logger: ILogger,
    metrics: MetricsCollector,
    dataAccess: DataAccessService
  ) {
    this.logger = logger;
    this.metrics = metrics;
    this.dataAccess = dataAccess;
  }

  /**
   * Category-based recommendations (content-based)
   */
  getCategoryRecommendations(
    profile: UserProfile,
    count: number
  ): Recommendation[] {
    const recommendations: Recommendation[] = [];
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
    return recommendations;
  }

  /**
   * Collaborative filtering stub (to be replaced with real algorithm)
   */
  getCollaborativeRecommendations(count: number): Recommendation[] {
    const recommendations: Recommendation[] = [];
    for (let i = 0; i < count; i++) {
      recommendations.push({
        itemId: `item_popular_${Math.random().toString(36).substr(2, 6)}`,
        title: "Popular Product",
        description: "Customers like you also viewed this",
        category: "general",
        score: 70 + Math.random() * 20,
        reason: "Popular with similar customers",
      });
    }
    return recommendations;
  }

  /**
   * Hybrid recommendation (combines category and collaborative)
   */
  getHybridRecommendations(
    profile: UserProfile,
    count: number
  ): Recommendation[] {
    const categoryRecs = this.getCategoryRecommendations(
      profile,
      Math.floor(count / 2)
    );
    const collabRecs = this.getCollaborativeRecommendations(
      count - categoryRecs.length
    );
    return [...categoryRecs, ...collabRecs];
  }

  /**
   * Main entry point for recommendation generation (async for real data)
   */
  async generateRecommendations(
    profile: UserProfile | null,
    type: string = "hybrid",
    count = 5,
    storeId?: string
  ): Promise<Recommendation[]> {
    if (!profile) {
      if (type === "trending" && storeId)
        return await this.getTrendingRecommendations(storeId, count);
      return this.getCollaborativeRecommendations(count);
    }
    switch (type) {
      case "category":
        return this.getCategoryRecommendations(profile, count);
      case "collaborative":
      case "general":
        return this.getCollaborativeRecommendations(count);
      case "trending":
        return storeId
          ? await this.getTrendingRecommendations(storeId, count)
          : this.getCollaborativeRecommendations(count);
      case "recent":
        return this.getRecencyRecommendations(profile, count);
      case "new":
        return await this.getNewArrivalsRecommendations(profile, count);
      case "fbt":
      case "frequently_bought_together":
        return this.getFrequentlyBoughtTogetherRecommendations(profile, count);
      case "discount":
      case "discounted":
        return await this.getDiscountedRecommendations(profile, count);
      case "seasonal":
        return this.getSeasonalRecommendations(profile, count);
      case "price":
      case "price_sensitive":
        return this.getPriceSensitiveRecommendations(profile, count);
      case "brand":
      case "brand_affinity":
        return this.getBrandAffinityRecommendations(profile, count);
      case "recency":
        return this.getRecencyRecommendations(profile, count);
      case "geo":
      case "geo_targeted":
        return this.getGeoTargetedRecommendations(profile, count);
      case "segment":
      case "behavioral_segment":
        return this.getSegmentRecommendations(profile, count);
      case "cross":
      case "cross_category":
        return this.getCrossCategoryRecommendations(profile, count);
      case "campaign":
      case "experiment":
        return this.getCampaignRecommendations(profile, count);
      case "hybrid":
      default:
        return this.getHybridRecommendations(profile, count);
    }
  }

  async getPersonalizedOffers(
    userId: string,
    storeId: string,
    profile: UserProfile | null
  ): Promise<PersonalizedOffer[]> {
    // ...existing code from PersonalizationService.getPersonalizedOffers...
    return [];
  }

  // popular recommendations helper will be moved here
}
