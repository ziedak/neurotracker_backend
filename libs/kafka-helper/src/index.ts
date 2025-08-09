import { Kafka, Producer, Consumer, KafkaConfig, SASLOptions } from "kafkajs";
import { getArrayEnv, getBooleanEnv, getEnv } from "@libs/config";

export class KafkaClient {
  private static kafka: Kafka;
  private static producer: Producer;

  static getInstance(): Kafka {
    if (!KafkaClient.kafka) {
      const config: KafkaConfig = {
        clientId: getEnv("KAFKA_CLIENT_ID", "neuro-backend"),
        brokers: getArrayEnv("KAFKA_BROKERS") || ["localhost:9092"],
        ssl: getBooleanEnv("KAFKA_SSL"),
      };

      // Add SASL configuration if provided
      if (getEnv("KAFKA_SASL")) {
        config.sasl = {
          mechanism: getEnv("KAFKA_SASL_MECHANISM", "plain"),
          username: getEnv("KAFKA_USERNAME"),
          password: getEnv("KAFKA_PASSWORD"),
        } as SASLOptions;
      }

      KafkaClient.kafka = new Kafka(config);
    }
    return KafkaClient.kafka;
  }

  static async getProducer(): Promise<Producer> {
    if (!KafkaClient.producer) {
      KafkaClient.producer = KafkaClient.getInstance().producer({
        transactionTimeout: 30000,
        allowAutoTopicCreation: true,
      });
      await KafkaClient.producer.connect();
    }
    return KafkaClient.producer;
  }

  static async createConsumer(groupId: string): Promise<Consumer> {
    const consumer = KafkaClient.getInstance().consumer({
      groupId,
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
    });
    await consumer.connect();
    return consumer;
  }
}
