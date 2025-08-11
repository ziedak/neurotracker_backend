import { WebSocketMessage } from "@libs/elysia-server";

export interface InterventionMessage extends WebSocketMessage {
  type:
    | "authenticate"
    | "trigger_intervention"
    | "update_campaign"
    | "track_event"
    | "connection_status"
    | "intervention_delivered"
    | "intervention_clicked"
    | "intervention_dismissed";
  payload: {
    interventionId?: string;
    campaignId?: string;
    userId?: string;
    sessionId?: string;
    storeId?: string;
    cartId?: string;
    event?: string;
    data?: any;
    [key: string]: any;
  };
}

export interface ConnectionPool {
  storeId: string;
  connections: Map<string, WebSocketConnection>;
  userSessions: Map<string, Set<string>>; // userId -> connectionIds
  lastActivity: Date;
}

export interface WebSocketConnection {
  id: string;
  ws: any;
  userId?: string;
  sessionId?: string;
  storeId?: string;
  connectedAt: Date;
  lastSeen: Date;
  isAlive: boolean;
}

export interface InterventionDelivery {
  id: string;
  interventionId: string;
  campaignId: string;
  userId: string;
  storeId: string;
  channel: "websocket" | "email" | "sms" | "push";
  status: "pending" | "delivered" | "failed" | "clicked" | "dismissed";
  deliveredAt?: Date;
  metadata: {
    connectionId?: string;
    template?: string;
    personalization?: Record<string, any>;
    retryCount?: number;
    failureReason?: string;
    queuedAt?: string;
    [key: string]: any;
  };
}

export interface InterventionTrigger {
  campaignId: string;
  userId: string;
  storeId: string;
  cartId: string;
  trigger: {
    type:
      | "cart_abandonment"
      | "browse_abandonment"
      | "price_drop"
      | "stock_alert";
    data: Record<string, any>;
  };
  channels: Array<"websocket" | "email" | "sms" | "push">;
  priority: "high" | "medium" | "low";
  delayMs?: number;
  expiresAt?: Date;
}
