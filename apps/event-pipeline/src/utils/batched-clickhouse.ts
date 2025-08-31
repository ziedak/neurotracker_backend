import { ClickHouseClient } from "@libs/database";
import { Logger } from "@libs/monitoring";

/**
 * Optimized ClickHouse operations for batch processing
 * Reduces database overhead through efficient batching
 */
export class BatchedClickHouseOperations {
  private clickhouse: any;
  private logger: ILogger;
  private batchSize: number;
  private pendingEvents: any[] = [];
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(clickhouseClient?: any, batchSize: number = 100) {
    this.clickhouse = clickhouseClient || ClickHouseClient.getInstance();
    this.logger = Logger.getInstance("BatchedClickHouseOperations");
    this.batchSize = batchSize;
  }

  /**
   * Add event to batch queue for processing
   * Automatically flushes when batch size is reached
   */
  async queueEvent(event: any, table: string = "raw_events"): Promise<void> {
    this.pendingEvents.push({ event, table });

    // Auto-flush when batch size reached
    if (this.pendingEvents.length >= this.batchSize) {
      await this.flush();
    } else {
      // Set timer to flush pending events (max 5 seconds delay)
      this.scheduleFlush();
    }
  }

  /**
   * Add multiple events to batch queue
   */
  async queueEvents(
    events: any[],
    table: string = "raw_events"
  ): Promise<void> {
    events.forEach((event) => {
      this.pendingEvents.push({ event, table });
    });

    // Flush if we've exceeded batch size
    if (this.pendingEvents.length >= this.batchSize) {
      await this.flush();
    } else {
      this.scheduleFlush();
    }
  }

  /**
   * Process all events immediately in optimized batches
   */
  async batchInsert(
    events: any[],
    table: string = "raw_events"
  ): Promise<void> {
    if (events.length === 0) return;

    try {
      // Process in chunks to avoid memory issues
      const chunkSize = this.batchSize;

      for (let i = 0; i < events.length; i += chunkSize) {
        const chunk = events.slice(i, i + chunkSize);

        await this.clickhouse.insert(table, chunk);

        this.logger.debug("ClickHouse batch insert completed", {
          table,
          eventsInserted: chunk.length,
          totalProgress: `${Math.min(i + chunkSize, events.length)}/${
            events.length
          }`,
        });
      }

      this.logger.info("ClickHouse batch insert completed", {
        table,
        totalEvents: events.length,
        chunksProcessed: Math.ceil(events.length / chunkSize),
      });
    } catch (error) {
      this.logger.error("ClickHouse batch insert failed", error as Error, {
        table,
        eventCount: events.length,
      });
      throw error;
    }
  }

  /**
   * Flush all pending events immediately
   */
  async flush(): Promise<void> {
    if (this.pendingEvents.length === 0) return;

    // Clear flush timer
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // Group events by table
    const eventsByTable = new Map<string, any[]>();

    this.pendingEvents.forEach(({ event, table }) => {
      if (!eventsByTable.has(table)) {
        eventsByTable.set(table, []);
      }
      eventsByTable.get(table)!.push(event);
    });

    // Clear pending events
    const totalEvents = this.pendingEvents.length;
    this.pendingEvents = [];

    // Insert each table's events
    try {
      for (const [table, events] of eventsByTable) {
        await this.batchInsert(events, table);
      }

      this.logger.info("Pending events flushed successfully", {
        totalEvents,
        tablesAffected: eventsByTable.size,
      });
    } catch (error) {
      this.logger.error("Failed to flush pending events", error as Error, {
        totalEvents,
        tablesAffected: eventsByTable.size,
      });
      throw error;
    }
  }

  /**
   * Schedule automatic flush of pending events
   */
  private scheduleFlush(): void {
    // Clear existing timer
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }

    // Set new timer (5 seconds max delay)
    this.flushTimer = setTimeout(async () => {
      try {
        await this.flush();
      } catch (error) {
        this.logger.error("Scheduled flush failed", error as Error);
      }
    }, 5000);
  }

  /**
   * Get pending events count
   */
  getPendingCount(): number {
    return this.pendingEvents.length;
  }

  /**
   * Force immediate processing without batching (for urgent events)
   */
  async immediateInsert(
    event: any,
    table: string = "raw_events"
  ): Promise<void> {
    try {
      await this.clickhouse.insert(table, [event]);

      this.logger.debug("ClickHouse immediate insert completed", {
        table,
        eventId: event.eventId || "unknown",
      });
    } catch (error) {
      this.logger.error("ClickHouse immediate insert failed", error as Error, {
        table,
        event,
      });
      throw error;
    }
  }

  /**
   * Cleanup resources (call on service shutdown)
   */
  async cleanup(): Promise<void> {
    // Flush any pending events
    if (this.pendingEvents.length > 0) {
      this.logger.info("Flushing pending events on cleanup", {
        pendingCount: this.pendingEvents.length,
      });
      await this.flush();
    }

    // Clear timer
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }
}
