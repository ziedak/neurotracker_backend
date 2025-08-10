#!/usr/bin/env bun

interface WebSocketMessage {
  type: string;
  payload: any;
  timestamp?: string;
}

async function testWebSocketConnection() {
  console.log("🔌 Testing WebSocket connection to event-pipeline service...");

  // Using Bun's native WebSocket support
  const ws = new WebSocket("ws://localhost:3001/events/stream");

  ws.onopen = () => {
    console.log("✅ WebSocket connection opened");

    // Test sending a cart event
    const testEvent = {
      type: "cart_event",
      payload: {
        userId: "ws-test-user-123",
        eventType: "item_added",
        timestamp: Date.now(),
        metadata: {
          productId: "premium-subscription",
          quantity: 1,
          price: 29.99,
        },
      },
      timestamp: new Date().toISOString(),
    };

    console.log("📤 Sending test event:", testEvent);
    ws.send(JSON.stringify(testEvent));

    // Send another event after 2 seconds
    setTimeout(() => {
      const event2 = {
        type: "cart_event",
        payload: {
          userId: "ws-test-user-456",
          eventType: "checkout_started",
          timestamp: Date.now(),
          metadata: {
            cartValue: 59.98,
            itemCount: 2,
          },
        },
        timestamp: new Date().toISOString(),
      };

      console.log("📤 Sending second test event:", event2);
      ws.send(JSON.stringify(event2));
    }, 2000);

    // Test invalid message type
    setTimeout(() => {
      const invalidEvent = {
        type: "invalid_type",
        payload: { test: "data" },
        timestamp: new Date().toISOString(),
      };

      console.log("📤 Sending invalid event (should get error):", invalidEvent);
      ws.send(JSON.stringify(invalidEvent));
    }, 4000);

    // Close connection after 8 seconds
    setTimeout(() => {
      console.log("🔌 Closing WebSocket connection");
      ws.close();
    }, 8000);
  };

  ws.onmessage = (event) => {
    try {
      const message: WebSocketMessage = JSON.parse(event.data);
      console.log("📥 Received message:", {
        type: message.type,
        payload: message.payload,
        timestamp: message.timestamp,
      });
    } catch (error) {
      console.error("❌ Failed to parse message:", error);
    }
  };

  ws.onclose = (event) => {
    console.log(
      `🔌 WebSocket connection closed: ${event.code} ${event.reason}`
    );
  };

  ws.onerror = (error) => {
    console.error("❌ WebSocket error:", error);
  };
}

// Run the test
testWebSocketConnection().catch(console.error);
