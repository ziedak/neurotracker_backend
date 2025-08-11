export interface NotificationTemplate {
  id: string;
  campaignId: string;
  channel: "email" | "sms" | "push";
  name: string;
  subject?: string; // For email
  content: string;
  variables: string[]; // List of available template variables
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  metadata: {
    version: number;
    tags?: string[];
    locale?: string;
    [key: string]: any;
  };
}

export interface NotificationJob {
  id: string;
  type: "email" | "sms" | "push";
  deliveryId: string;
  campaignId: string;
  userId: string;
  storeId: string;
  priority: "high" | "medium" | "low";
  scheduledFor: Date;
  attempts: number;
  maxAttempts: number;
  status: "pending" | "processing" | "sent" | "failed" | "cancelled";
  template: NotificationTemplate;
  variables: Record<string, any>;
  recipient: {
    email?: string;
    phone?: string;
    deviceToken?: string;
    [key: string]: any;
  };
  metadata: {
    processedAt?: Date;
    sentAt?: Date;
    failureReason?: string;
    providerResponse?: any;
    [key: string]: any;
  };
}

export interface EmailConfig {
  provider: "sendgrid" | "ses" | "smtp";
  apiKey?: string;
  region?: string;
  fromEmail: string;
  fromName: string;
  replyTo?: string;
  templateId?: string;
}

export interface SMSConfig {
  provider: "twilio" | "sns";
  accountSid?: string;
  authToken?: string;
  region?: string;
  fromNumber: string;
}

export interface PushConfig {
  provider: "fcm" | "apns";
  serverKey?: string;
  bundleId?: string;
  teamId?: string;
  keyId?: string;
  privateKey?: string;
}

export interface NotificationResult {
  success: boolean;
  messageId?: string;
  error?: string;
  metadata?: any;
}

export interface PersonalizationData {
  user: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    [key: string]: any;
  };
  cart: {
    items: Array<{
      name: string;
      price: number;
      quantity: number;
      imageUrl?: string;
      [key: string]: any;
    }>;
    total: number;
    currency: string;
    abandonedAt?: Date;
    [key: string]: any;
  };
  store: {
    name: string;
    domain: string;
    logo?: string;
    supportEmail?: string;
    [key: string]: any;
  };
  intervention: {
    type: string;
    discount?: {
      code: string;
      amount: number;
      type: "percentage" | "fixed";
    };
    urgency?: {
      timeLeft: string;
      stockLeft?: number;
    };
    [key: string]: any;
  };
}
