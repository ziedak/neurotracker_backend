export interface UserEvent {
  userId: string;
  timestamp: number;
  eventType: string;
  metadata?: Record<string, any>;
}
