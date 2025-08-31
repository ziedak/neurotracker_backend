import { RedisClient } from "@libs/database";
import { Logger } from "@libs/monitoring";
import { getEnv } from "@libs/config";
import {
  PersonalizationRule,
  PersonalizationCondition,
  PersonalizationContext,
  UserProfile,
} from "./types";

export class RuleService {
  /**
   * Returns rules applicable to the given user profile and context.
   */
  public filterApplicableRules(
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

  /**
   * Evaluates a single rule condition against the user profile and context.
   */
  public evaluateCondition(
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

  /**
   * Utility to get a nested value from an object using dot notation.
   */
  public getValueFromPath(path: string, data: any): any {
    return path.split(".").reduce((current, key) => current?.[key], data);
  }
  private redis: any;
  constructor(private logger: ILogger) {
    this.redis = RedisClient.getInstance();
  }

  async createPersonalizationRule(
    storeId: string,
    rule: Omit<PersonalizationRule, "id" | "createdAt" | "updatedAt">
  ): Promise<PersonalizationRule> {
    try {
      const ruleId = `rule_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 6)}`;
      const newRule: PersonalizationRule = {
        ...rule,
        id: ruleId,
        storeId,
        isActive: true,
        priority: rule.priority ?? 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await this.redis.hset(
        `personalization:rules:${storeId}`,
        ruleId,
        JSON.stringify(newRule)
      );
      return newRule;
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
      const data = await this.redis.hget(
        `personalization:rules:${storeId}`,
        ruleId
      );
      if (!data) throw new Error("Rule not found");
      const existingRule = JSON.parse(data) as PersonalizationRule;
      const updatedRule: PersonalizationRule = {
        ...existingRule,
        ...rule,
        updatedAt: new Date(),
      };
      await this.redis.hset(
        `personalization:rules:${storeId}`,
        ruleId,
        JSON.stringify(updatedRule)
      );
      return updatedRule;
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
      if (!rulesData) return [];
      return (Object.values(rulesData) as string[]).map(
        (data) => JSON.parse(data) as PersonalizationRule
      );
    } catch (error) {
      this.logger.error("Failed to get personalization rules", error as Error);
      throw error;
    }
  }

  // rule evaluation helpers will be moved here
}
