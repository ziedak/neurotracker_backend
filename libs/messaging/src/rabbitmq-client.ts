import * as amqp from "amqplib";
import type { Options, Message } from "amqplib";

export interface RabbitMQConfig {
  url: string;
  prefetch?: number;
}

export class RabbitMQClient {
  private connection?: any;
  private channel?: any;
  private config: RabbitMQConfig;

  constructor(config: RabbitMQConfig) {
    this.config = config;
  }

  /**
   * Establish connection and channel to RabbitMQ
   */
  async connect(): Promise<void> {
    if (this.connection) return;
    this.connection = await amqp.connect(this.config.url);
    this.channel = await this.connection.createChannel();
    if (this.config.prefetch) {
      this.channel.prefetch(this.config.prefetch);
    }
  }

  /**
   * Assert a queue exists (creates if not)
   */
  async assertQueue(
    queue: string,
    options?: Options.AssertQueue
  ): Promise<void> {
    if (!this.channel) throw new Error("RabbitMQ channel not initialized");
    await this.channel.assertQueue(queue, options);
  }

  /**
   * Send a message to a queue
   */
  async sendToQueue(
    queue: string,
    content: Buffer,
    options?: Options.Publish
  ): Promise<boolean> {
    if (!this.channel) throw new Error("RabbitMQ channel not initialized");
    return this.channel.sendToQueue(queue, content, options);
  }

  /**
   * Consume messages from a queue
   */
  async consume(
    queue: string,
    onMessage: (msg: Message | null) => void,
    options?: Options.Consume
  ): Promise<void> {
    if (!this.channel) throw new Error("RabbitMQ channel not initialized");
    await this.channel.consume(queue, onMessage, options);
  }

  /**
   * Gracefully close channel and connection
   */
  async close(): Promise<void> {
    if (this.channel) {
      await this.channel.close();
      this.channel = undefined;
    }
    if (this.connection) {
      await this.connection.close();
      this.connection = undefined;
    }
  }
}
