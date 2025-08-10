import { WebSocketManager, WebSocketMessage } from "./websocket_not-used";

// Example usage of WebSocket functionality

// 1. Basic WebSocket server setup
const wsManager = new WebSocketManager({
  port: 8080,
  path: "/ws",
  heartbeatInterval: 30000,
  maxConnections: 1000,
  enableCompression: true,
  enableHeartbeat: true,
});

// 2. Integration with existing HTTP server (for use with Elysia)
/*
import { createServer } from "http";
const httpServer = createServer();
const wsManager = WebSocketManager.fromHttpServer(httpServer, {
  path: "/ws",
  heartbeatInterval: 30000,
});
*/

// 3. Example message handling and broadcasting
class NotificationService {
  private wsManager: WebSocketManager;

  constructor(wsManager: WebSocketManager) {
    this.wsManager = wsManager;
  }

  // Send notification to specific user
  async notifyUser(userId: string, notification: any): Promise<void> {
    const message: WebSocketMessage = {
      type: "notification",
      payload: notification,
      timestamp: new Date().toISOString(),
    };

    const sent = this.wsManager.sendToUser(userId, message);
    console.log(`Notification sent to ${sent} connections for user ${userId}`);
  }

  // Send message to a room (e.g., chat room, team channel)
  async sendToRoom(
    room: string,
    message: any,
    senderId?: string
  ): Promise<void> {
    const wsMessage: WebSocketMessage = {
      type: "room_message",
      payload: {
        room,
        message,
        senderId,
      },
      timestamp: new Date().toISOString(),
    };

    const sent = this.wsManager.sendToRoom(room, wsMessage);
    console.log(`Message sent to ${sent} connections in room ${room}`);
  }

  // Broadcast to all subscribers of a topic
  async broadcastToTopic(topic: string, data: any): Promise<void> {
    const message: WebSocketMessage = {
      type: "topic_update",
      payload: {
        topic,
        data,
      },
      timestamp: new Date().toISOString(),
    };

    const sent = this.wsManager.broadcastToTopic(topic, message);
    console.log(`Broadcast sent to ${sent} subscribers of topic ${topic}`);
  }

  // System-wide announcements
  async systemAnnouncement(announcement: string): Promise<void> {
    const message: WebSocketMessage = {
      type: "system_announcement",
      payload: { announcement },
      timestamp: new Date().toISOString(),
    };

    const sent = this.wsManager.broadcast(message);
    console.log(`System announcement sent to ${sent} connections`);
  }

  // Get statistics
  getStats() {
    return {
      activeConnections: this.wsManager.getConnectionCount(),
      activeRooms: this.wsManager.getActiveRooms(),
    };
  }
}

// 4. Example client-side message types
/*
Client Message Examples:

// Authentication
{
  "type": "authenticate",
  "payload": {
    "userId": "user123",
    "sessionId": "session456",
    "token": "jwt-token-here"
  }
}

// Subscribe to topics (e.g., user events, system updates)
{
  "type": "subscribe",
  "payload": {
    "topic": "user_events"
  }
}

// Join a room (e.g., chat room, collaboration space)
{
  "type": "join_room",
  "payload": {
    "room": "team_alpha"
  }
}

// Heartbeat (optional, for manual heartbeat)
{
  "type": "heartbeat",
  "payload": {}
}
*/

// 5. Example integration with microservices
export class WebSocketIntegration {
  private notificationService: NotificationService;

  constructor(wsManager: WebSocketManager) {
    this.notificationService = new NotificationService(wsManager);
  }

  // Called when a user event occurs (from event pipeline)
  async handleUserEvent(userId: string, event: any): Promise<void> {
    await this.notificationService.notifyUser(userId, {
      type: "user_event",
      event,
    });
  }

  // Called when AI analysis is complete
  async handleAiAnalysisComplete(userId: string, analysis: any): Promise<void> {
    await this.notificationService.notifyUser(userId, {
      type: "ai_analysis_complete",
      analysis,
    });

    // Also broadcast to analysts topic if relevant
    await this.notificationService.broadcastToTopic("ai_analysis", {
      userId,
      analysis: analysis.summary, // Send summary only for privacy
    });
  }

  // Called for real-time intervention alerts
  async handleInterventionAlert(alert: any): Promise<void> {
    await this.notificationService.broadcastToTopic("interventions", alert);

    // Send to specific care team room
    if (alert.careTeamId) {
      await this.notificationService.sendToRoom(
        `care_team_${alert.careTeamId}`,
        alert
      );
    }
  }

  // Handle system maintenance notifications
  async handleSystemMaintenance(maintenanceInfo: any): Promise<void> {
    await this.notificationService.systemAnnouncement(
      `System maintenance scheduled: ${maintenanceInfo.scheduledTime}`
    );
  }
}

export { NotificationService, wsManager };
