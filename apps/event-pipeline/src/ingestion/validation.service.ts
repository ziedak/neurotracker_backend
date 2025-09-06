import { UserEvent } from "@libs/database";
import { injectable } from "tsyringe";

@injectable()
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
      id: "", // You should generate a unique ID here
      userId: event.userId,
      sessionId: event.sessionId ?? null,
      eventType: event.eventType,
      timestamp: new Date(event.timestamp),
      metadata: event.metadata ?? null,
      pageUrl: event.pageUrl ?? null,
      userAgent: event.userAgent ?? null,
      ipAddress: event.ipAddress ?? null,
      isError: false,
      errorMsg: null,
      user: undefined as any, // Replace with actual User object if available
      session: null,
    };
  }
}
