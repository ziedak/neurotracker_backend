import { Elysia } from "elysia";
import { node } from "@elysiajs/node";
import { UserEvent } from "@libs/models";

const app = new Elysia({ adapter: node() });

app.post("/event", (context) => {
  const event = context.body as UserEvent;
  // Process event, e.g. send to Kafka or DB (stub)
  console.log("Received event:", event);
  return { status: "ok" };
});

app.post("/event", (context) => {
  const event = context.body as UserEvent;
  // Process event, e.g. send to Kafka or DB (stub)
  console.log("Received event:", event);
  return { status: "ok" };
});

app.listen(3002, () => {
  console.log("Prediction service running on port 3002");
});
