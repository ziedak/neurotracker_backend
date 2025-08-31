import { KafkaClient } from "@libs/messaging";
import { Logger } from "@libs/monitoring";

export class StreamProcessor {
  private logger: ILogger;

  constructor() {
    this.logger = Logger.getInstance("StreamProcessor");
  }

  async process(event: any): Promise<void> {
    try {
      const producer = await KafkaClient.getProducer();
      await producer.send({
        topic: "cart-events",
        messages: [{ value: JSON.stringify(event) }],
      });
      this.logger.info("Event streamed to Kafka", { eventId: event.eventId });
    } catch (error) {
      this.logger.error("Kafka stream failed", error as Error, { event });
      throw error;
    }
  }
}
