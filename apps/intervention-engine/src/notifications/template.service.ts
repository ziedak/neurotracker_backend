import { Logger, MetricsCollector } from "@libs/monitoring";
import {
  NotificationTemplate,
  PersonalizationData,
  NotificationJob,
} from "./types";

export class TemplateService {
  private templates: Map<string, NotificationTemplate> = new Map();

  constructor(private logger: ILogger, private metrics: MetricsCollector) {
    this.initializeDefaultTemplates();
  }

  /**
   * Get template by campaign and channel
   */
  async getTemplate(
    campaignId: string,
    channel: "email" | "sms" | "push"
  ): Promise<NotificationTemplate | null> {
    const templateKey = `${campaignId}_${channel}`;
    const template = this.templates.get(templateKey);

    if (!template) {
      this.logger.warn(`Template not found`, { campaignId, channel });
      this.metrics.recordCounter("template.not_found", 1, {
        campaignId,
        channel,
      });
      return null;
    }

    if (!template.isActive) {
      this.logger.warn(`Template is inactive`, {
        campaignId,
        channel,
        templateId: template.id,
      });
      this.metrics.recordCounter("template.inactive", 1, {
        campaignId,
        channel,
      });
      return null;
    }

    return template;
  }

  /**
   * Render template with personalization data
   */
  renderTemplate(
    template: NotificationTemplate,
    data: PersonalizationData
  ): string {
    let content = template.content;

    try {
      // Replace user variables
      content = content.replace(/\{\{user\.([^}]+)\}\}/g, (match, key) => {
        return this.getNestedValue(data.user, key) || match;
      });

      // Replace cart variables
      content = content.replace(/\{\{cart\.([^}]+)\}\}/g, (match, key) => {
        return this.getNestedValue(data.cart, key) || match;
      });

      // Replace store variables
      content = content.replace(/\{\{store\.([^}]+)\}\}/g, (match, key) => {
        return this.getNestedValue(data.store, key) || match;
      });

      // Replace intervention variables
      content = content.replace(
        /\{\{intervention\.([^}]+)\}\}/g,
        (match, key) => {
          return this.getNestedValue(data.intervention, key) || match;
        }
      );

      // Special handling for cart items
      if (content.includes("{{#each cart.items}}")) {
        content = this.renderCartItems(content, data.cart.items);
      }

      this.logger.debug(`Template rendered successfully`, {
        templateId: template.id,
        variables: template.variables.length,
      });

      this.metrics.recordCounter("template.rendered", 1, {
        channel: template.channel,
        campaignId: template.campaignId,
      });

      return content;
    } catch (error) {
      this.logger.error(`Failed to render template`, error as Error, {
        templateId: template.id,
        campaignId: template.campaignId,
      });

      this.metrics.recordCounter("template.render_failed", 1, {
        channel: template.channel,
        campaignId: template.campaignId,
      });

      // Return unrendered content as fallback
      return template.content;
    }
  }

  /**
   * Create or update template
   */
  async saveTemplate(
    template: Omit<NotificationTemplate, "id" | "createdAt" | "updatedAt">
  ): Promise<NotificationTemplate> {
    const now = new Date();
    const newTemplate: NotificationTemplate = {
      ...template,
      id: this.generateTemplateId(template.campaignId, template.channel),
      createdAt: now,
      updatedAt: now,
    };

    const templateKey = `${template.campaignId}_${template.channel}`;
    this.templates.set(templateKey, newTemplate);

    this.logger.info(`Template saved`, {
      templateId: newTemplate.id,
      campaignId: template.campaignId,
      channel: template.channel,
    });

    this.metrics.recordCounter("template.saved", 1, {
      channel: template.channel,
      campaignId: template.campaignId,
    });

    return newTemplate;
  }

  /**
   * Get all templates for a campaign
   */
  async getCampaignTemplates(
    campaignId: string
  ): Promise<NotificationTemplate[]> {
    const templates: NotificationTemplate[] = [];

    for (const [key, template] of this.templates) {
      if (template.campaignId === campaignId) {
        templates.push(template);
      }
    }

    return templates;
  }

  /**
   * Validate template variables
   */
  validateTemplate(template: NotificationTemplate): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    // Check for required fields
    if (!template.content?.trim()) {
      errors.push("Template content is required");
    }

    if (template.channel === "email" && !template.subject?.trim()) {
      errors.push("Email templates require a subject");
    }

    // Check for unclosed variables
    const unclosedVars = template.content.match(/\{\{[^}]*$/g);
    if (unclosedVars) {
      errors.push(`Unclosed template variables: ${unclosedVars.join(", ")}`);
    }

    // Check for unknown variables
    const variables = this.extractVariables(template.content);
    const validPrefixes = ["user.", "cart.", "store.", "intervention."];

    for (const variable of variables) {
      const hasValidPrefix = validPrefixes.some((prefix) =>
        variable.startsWith(prefix)
      );
      if (!hasValidPrefix && !variable.startsWith("#each")) {
        errors.push(`Unknown variable: {{${variable}}}`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Extract all variables from template content
   */
  private extractVariables(content: string): string[] {
    const variableMatches = content.match(/\{\{([^}]+)\}\}/g) || [];
    return variableMatches.map((match) => match.slice(2, -2).trim());
  }

  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(obj: any, path: string): any {
    return path.split(".").reduce((current, key) => current?.[key], obj);
  }

  /**
   * Render cart items using each loop
   */
  private renderCartItems(content: string, items: any[]): string {
    const eachMatch = content.match(
      /\{\{#each cart\.items\}\}(.*?)\{\{\/#each\}\}/gs
    );
    if (!eachMatch) return content;

    const [fullMatch, itemTemplate] = eachMatch;
    let renderedItems = "";

    for (const item of items) {
      let itemContent = itemTemplate;

      // Replace item-specific variables
      itemContent = itemContent.replace(
        /\{\{this\.([^}]+)\}\}/g,
        (match, key) => {
          return item[key] || match;
        }
      );

      renderedItems += itemContent;
    }

    return content.replace(fullMatch, renderedItems);
  }

  /**
   * Generate unique template ID
   */
  private generateTemplateId(campaignId: string, channel: string): string {
    return `tpl_${campaignId}_${channel}_${Date.now()}`;
  }

  /**
   * Initialize default templates for testing
   */
  private initializeDefaultTemplates(): void {
    // Cart abandonment email template
    const cartAbandonmentEmail: NotificationTemplate = {
      id: "tpl_cart_abandonment_email_default",
      campaignId: "cart_abandonment",
      channel: "email",
      name: "Cart Abandonment - Default",
      subject: "Don't forget your items at {{store.name}}!",
      content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Hi \{\{user.firstName\}\},</h2>
          
          <p>You left some great items in your cart at \{\{store.name\}\}. Don't miss out!</p>
          
          <div style="border: 1px solid #ddd; padding: 20px; margin: 20px 0;">
            <h3>Your Cart:</h3>
            \{\{#each cart.items\}\}
              <div style="border-bottom: 1px solid #eee; padding: 10px 0;">
                <strong>\{\{this.name\}\}</strong><br>
                Quantity: \{\{this.quantity\}\}<br>
                Price: $\{\{this.price\}\}
              </div>
            \{\{/#each\}\}
            <div style="font-size: 18px; font-weight: bold; margin-top: 10px;">
              Total: $\{\{cart.total\}\}
            </div>
          </div>
          
          \{\{#if intervention.discount\}\}
          <div style="background: #f0f8ff; padding: 15px; margin: 20px 0; border-radius: 5px;">
            <h3>Special Offer!</h3>
            <p>Complete your purchase now and save \{\{intervention.discount.amount\}\}% with code: <strong>\{\{intervention.discount.code\}\}</strong></p>
          </div>
          \{\{/if\}\}
          
          <a href="\{\{store.domain\}\}/cart" style="background: #007cba; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
            Complete Your Purchase
          </a>
          
          <p style="margin-top: 30px; font-size: 12px; color: #666;">
            This email was sent by \{\{store.name\}\}. If you no longer wish to receive these emails, 
            <a href="#">unsubscribe here</a>.
          </p>
        </div>
      `,
      variables: [
        "user.firstName",
        "store.name",
        "store.domain",
        "cart.items",
        "cart.total",
        "intervention.discount",
      ],
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {
        version: 1,
        tags: ["cart_abandonment", "default"],
        locale: "en",
      },
    };

    // Cart abandonment SMS template
    const cartAbandonmentSMS: NotificationTemplate = {
      id: "tpl_cart_abandonment_sms_default",
      campaignId: "cart_abandonment",
      channel: "sms",
      name: "Cart Abandonment - SMS",
      content: `Hi \{\{user.firstName\}\}! You left $\{\{cart.total\}\} worth of items in your cart at \{\{store.name\}\}. Complete your purchase: \{\{store.domain\}\}/cart \{\{#if intervention.discount\}\}Use code \{\{intervention.discount.code\}\} for \{\{intervention.discount.amount\}\}% off!\{\{/if\}\}`,
      variables: [
        "user.firstName",
        "cart.total",
        "store.name",
        "store.domain",
        "intervention.discount",
      ],
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {
        version: 1,
        tags: ["cart_abandonment", "sms"],
        locale: "en",
      },
    };

    // Cart abandonment push notification template
    const cartAbandonmentPush: NotificationTemplate = {
      id: "tpl_cart_abandonment_push_default",
      campaignId: "cart_abandonment",
      channel: "push",
      name: "Cart Abandonment - Push",
      subject: "Complete your purchase",
      content: `Your cart is waiting! $\{\{cart.total\}\} in items at \{\{store.name\}\}. \{\{#if intervention.discount\}\}Save \{\{intervention.discount.amount\}\}% with code \{\{intervention.discount.code\}\}\{\{/if\}\}`,
      variables: ["cart.total", "store.name", "intervention.discount"],
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {
        version: 1,
        tags: ["cart_abandonment", "push"],
        locale: "en",
      },
    };

    // Store templates
    this.templates.set("cart_abandonment_email", cartAbandonmentEmail);
    this.templates.set("cart_abandonment_sms", cartAbandonmentSMS);
    this.templates.set("cart_abandonment_push", cartAbandonmentPush);

    this.logger.info(`Initialized ${this.templates.size} default templates`);
  }
}
