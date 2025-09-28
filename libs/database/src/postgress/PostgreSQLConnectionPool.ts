/**
 * Real PostgreSQL Connection Pool
 * Us  constructor(config: PostgreSQLPoolConfig) {
    super();
    if (config.metricsCollector) {
      this.metrics = config.metricsCollector;
    }

    // Create the actual PostgreSQL connection pool
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      max: config.max || 20, // Maximum number of clients in the pool
      min: config.min || 2,  // Minimum number of clients in the pool
      idleTimeoutMillis: config.idleTimeoutMillis || 30000,
      connectionTimeoutMillis: config.connectionTimeoutMillis || 2000,
      ...config,
    });ual connection multiplexing
 */

import { Pool, PoolClient, PoolConfig } from "pg";
import { EventEmitter } from "events";
import { PostgreSQLClient } from "./PostgreSQLClient";
import { IMetricsCollector } from "@libs/monitoring";
import { createLogger } from "@libs/utils";
import { ConsecutiveBreaker, handleAll, circuitBreaker } from "cockatiel";

export interface IPostgreSQLConnectionPool {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getClient(): Promise<PoolClient>;
  query<T = unknown>(
    text: string,
    params?: unknown[]
  ): Promise<{ rows: T[]; rowCount: number }>;
  transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>;
  getStats(): {
    totalCount: number;
    idleCount: number;
    waitingCount: number;
  };
  healthCheck(): Promise<boolean>;
}

export interface PostgreSQLPoolConfig extends PoolConfig {
  enableCircuitBreaker?: boolean;
  circuitBreakerThreshold?: number;
  metricsCollector?: IMetricsCollector;
}

export class PostgreSQLConnectionPool
  extends EventEmitter
  implements IPostgreSQLConnectionPool
{
  private readonly pool: Pool;
  private readonly logger = createLogger("PostgreSQLConnectionPool");
  private readonly circuitBreakerPolicy?: ReturnType<typeof circuitBreaker>;
  private readonly metrics: IMetricsCollector | undefined;

  constructor(config: PostgreSQLPoolConfig) {
    super();
    this.metrics = config.metricsCollector ?? undefined;

    // Create the actual PostgreSQL connection pool
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      max: config.max ?? 20, // Maximum number of clients in the pool
      min: config.min ?? 2, // Minimum number of clients in the pool
      idleTimeoutMillis: config.idleTimeoutMillis ?? 30000,
      connectionTimeoutMillis: config.connectionTimeoutMillis ?? 2000,
      ...config,
    });

    // Set up event handlers
    this.setupEventHandlers();

    // Initialize circuit breaker if enabled
    if (config.enableCircuitBreaker) {
      this.circuitBreakerPolicy = circuitBreaker(handleAll, {
        halfOpenAfter: 30000,
        breaker: new ConsecutiveBreaker(config.circuitBreakerThreshold ?? 5),
      });
    }
  }

  private setupEventHandlers(): void {
    this.pool.on("connect", async (_client: PoolClient) => {
      this.logger.debug("New client connected to pool");
      await this.metrics?.recordCounter("postgresql.pool.connect");
    });

    this.pool.on("acquire", async (_client: PoolClient) => {
      this.logger.debug("Client acquired from pool");
      await this.metrics?.recordCounter("postgresql.pool.acquire");
    });

    this.pool.on("remove", async (_client: PoolClient) => {
      this.logger.debug("Client removed from pool");
      await this.metrics?.recordCounter("postgresql.pool.remove");
    });

    this.pool.on("error", async (err: Error, _client: PoolClient) => {
      this.logger.error("Unexpected error on idle client", err);
      await this.metrics?.recordCounter("postgresql.pool.error");
    });
  }

  async connect(): Promise<void> {
    try {
      // Test the connection by getting and releasing a client
      const client = await this.pool.connect();
      client.release();
      this.logger.info("PostgreSQL connection pool initialized successfully");
    } catch (error) {
      this.logger.error(
        "Failed to initialize PostgreSQL connection pool",
        error
      );
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.pool.end();
      this.logger.info("PostgreSQL connection pool closed");
    } catch (error) {
      this.logger.error("Error closing PostgreSQL connection pool", error);
      throw error;
    }
  }

  async getClient(): Promise<PoolClient> {
    const startTime = performance.now();
    try {
      const client = await this.pool.connect();
      const duration = performance.now() - startTime;
      await this.metrics?.recordTimer(
        "postgresql.client.acquire_duration",
        duration
      );
      return client;
    } catch (error) {
      const duration = performance.now() - startTime;
      await this.metrics?.recordTimer(
        "postgresql.client.acquire_error_duration",
        duration
      );
      throw error;
    }
  }

  async query<T = unknown>(
    text: string,
    params?: unknown[]
  ): Promise<{ rows: T[]; rowCount: number }> {
    const operation = async (): Promise<{ rows: T[]; rowCount: number }> => {
      const startTime = performance.now();
      let client: PoolClient | undefined;

      try {
        client = await this.getClient();
        const result = await client.query(text, params);
        const duration = performance.now() - startTime;

        await this.metrics?.recordTimer("postgresql.query.duration", duration);
        await this.metrics?.recordCounter("postgresql.query.success");

        return {
          rows: result.rows as T[],
          rowCount: result.rowCount ?? 0,
        };
      } catch (error) {
        const duration = performance.now() - startTime;
        await this.metrics?.recordTimer(
          "postgresql.query.error_duration",
          duration
        );
        await this.metrics?.recordCounter("postgresql.query.error");
        throw error;
      } finally {
        if (client) {
          client.release();
        }
      }
    };

    if (this.circuitBreakerPolicy) {
      return this.circuitBreakerPolicy.execute(operation);
    }

    return operation();
  }

  async transaction<T>(
    callback: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const operation = async (): Promise<T> => {
      const startTime = performance.now();
      const client = await this.getClient();

      try {
        await client.query("BEGIN");
        const result = await callback(client);
        await client.query("COMMIT");

        const duration = performance.now() - startTime;
        await this.metrics?.recordTimer(
          "postgresql.transaction.duration",
          duration
        );
        await this.metrics?.recordCounter("postgresql.transaction.success");

        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        const duration = performance.now() - startTime;
        await this.metrics?.recordTimer(
          "postgresql.transaction.error_duration",
          duration
        );
        await this.metrics?.recordCounter("postgresql.transaction.error");
        throw error;
      } finally {
        client.release();
      }
    };

    if (this.circuitBreakerPolicy) {
      return this.circuitBreakerPolicy.execute(operation);
    }

    return operation();
  }

  getStats(): {
    totalCount: number;
    idleCount: number;
    waitingCount: number;
  } {
    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.query("SELECT 1 as health_check");
      return result.rows.length > 0;
    } catch (error) {
      this.logger.error("Health check failed", error);
      return false;
    }
  }

  /**
   * Create a PostgreSQL connection pool with circuit breaker
   */
  static create(config: PostgreSQLPoolConfig): PostgreSQLConnectionPool {
    return new PostgreSQLConnectionPool(config);
  }

  static fromPostgreSQLClient(
    _client: PostgreSQLClient,
    poolConfig: Partial<PostgreSQLPoolConfig> = {}
  ): PostgreSQLConnectionPool {
    // Extract connection config from the client
    // This is a simplified example - in practice you'd need to extract
    // the actual connection parameters from the client
    const config: PostgreSQLPoolConfig = {
      host: process.env["POSTGRES_HOST"] ?? "localhost",
      port: parseInt(process.env["POSTGRES_PORT"] ?? "5432"),
      database: process.env["POSTGRES_DB"] ?? "postgres",
      user: process.env["POSTGRES_USER"] ?? "postgres",
      password: process.env["POSTGRES_PASSWORD"],
      max: 20,
      min: 2,
      ...poolConfig,
    };

    return new PostgreSQLConnectionPool(config);
  }
}
