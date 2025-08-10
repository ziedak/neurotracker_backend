import { UserEvent } from "@libs/models";

export class ValidationService {
  validate(event: any): UserEvent {
    if (!event || typeof event !== "object")
      throw new Error("Invalid event object");
    if (!event.userId || typeof event.userId !== "string")
      throw new Error("Missing userId");
    if (!event.eventType || typeof event.eventType !== "string")
      throw new Error("Missing eventType");
    if (!event.timestamp || typeof event.timestamp !== "number")
      throw new Error("Missing timestamp");
    // Optionally validate metadata
    return {
      userId: event.userId,
      eventType: event.eventType,
      timestamp: event.timestamp,
      metadata: event.metadata || {},
    };
  }
}
