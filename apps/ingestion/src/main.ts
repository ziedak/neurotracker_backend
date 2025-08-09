import { Elysia } from "elysia";
import { node } from "@elysiajs/node";
import { UserEvent } from "@libs/models";
import { getEnv } from "@libs/config";

const app = new Elysia({ adapter: node() });
app.get("/event", (context) => {
  const event = context.body as UserEvent;
  // Process event, e.g. send to Kafka or DB (stub)
  console.log("get env", getEnv("TEST", "aaa"));
  console.log("Received event:", event, getEnv("TEST", "aaa"));
  return { status: "ok" };
});
app.post("/event", (context) => {
  const event = context.body as UserEvent;
  // Process event, e.g. send to Kafka or DB (stub)
  console.log("Received event:", event);
  return { status: "ok" };
});

app.listen(3001, () => {
  console.log("Ingestion service running on port 3001");
});
