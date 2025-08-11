import {
  ClickHouseClient,
  PostgreSQLClient,
  RedisClient,
} from "@libs/database";
import { DatabaseUtils, ClickHouseQueryBuilder } from "@libs/database";
import { Logger, MetricsCollector } from "@libs/monitoring";
import { performance } from "perf_hooks";

export interface ReconciliationRule {
  id: string;
  name: string;
  sourceTable: string;
  targetTable: string;
  joinKey: string;
  enabled: boolean;
  sourceColumns?: string[];
  targetColumns?: string[];
  tolerance?: number;
}

export interface ReconciliationResult {
  ruleId: string;
  status: "passed" | "failed" | "warning";
  recordsChecked: number;
  discrepancies: number;
  executedAt: string;
  executionTime: number;
  details?: DiscrepancyDetail[];
}

export interface DiscrepancyDetail {
  id: string;
  column: string;
  sourceValue: any;
  targetValue: any;
  severity: "high" | "medium" | "low";
  confidence: number;
}

export interface RepairOperation {
  operationId: string;
  type: "update" | "insert" | "delete";
  table: string;
  query: string;
  params: any[];
  estimatedImpact: number;
}

/**
 * Data Reconciliation Service
 * Handles cross-system data consistency validation and automated repair
 */
export class DataReconciliationService {
  private readonly redis: RedisClient;
  private readonly clickhouse: ClickHouseClient;
  private readonly postgres: PostgreSQLClient;
  private readonly logger: Logger;
  private readonly metrics: MetricsCollector;

  constructor(
    redis: RedisClient,
    clickhouse: ClickHouseClient,
    postgres: PostgreSQLClient,
    logger: Logger,
    metrics: MetricsCollector
  ) {
    this.redis = redis;
    this.clickhouse = clickhouse;
    this.postgres = postgres;
    this.logger = logger;
    this.metrics = metrics;
  }

  /**
   * Create a new reconciliation rule
   */
  async createRule(
    ruleData: Omit<ReconciliationRule, "id">
  ): Promise<ReconciliationRule> {
    try {
      const startTime = performance.now();

      const rule: ReconciliationRule = {
        id: `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        ...ruleData,
      };

      // Store rule in PostgreSQL
      await PostgreSQLClient.executeRaw(
        `INSERT INTO reconciliation_rules (id, name, source_table, target_table, join_key, enabled, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          rule.id,
          rule.name,
          rule.sourceTable,
          rule.targetTable,
          rule.joinKey,
          rule.enabled,
        ]
      );

      // Cache the rule
      const redisClient = RedisClient.getInstance();
      await redisClient.setex(
        `recon_rule:${rule.id}`,
        3600,
        JSON.stringify(rule)
      );

      const duration = performance.now() - startTime;
      await this.metrics.recordTimer("reconciliation_rule_creation", duration);
      await this.metrics.recordCounter("reconciliation_rules_created");

      this.logger.info("Reconciliation rule created", {
        ruleId: rule.id,
        name: rule.name,
      });
      return rule;
    } catch (error) {
      this.logger.error("Failed to create reconciliation rule", error as Error);
      await this.metrics.recordCounter("reconciliation_rule_creation_errors");
      throw new Error(
        `Failed to create reconciliation rule: ${(error as Error).message}`
      );
    }
  }

  /**
   * Execute reconciliation for a specific rule
   */
  async executeReconciliation(ruleId: string): Promise<ReconciliationResult> {
    try {
      const startTime = performance.now();
      this.logger.info("Starting reconciliation execution", { ruleId });

      // Get the rule
      const rule = await this.getRule(ruleId);
      if (!rule || !rule.enabled) {
        throw new Error(`Rule ${ruleId} not found or disabled`);
      }

      // Build and execute reconciliation query
      const { query, params } = this.buildReconciliationQuery(rule);
      const discrepancies = await ClickHouseClient.execute(query, params);

      const result: ReconciliationResult = {
        ruleId,
        status:
          discrepancies.length === 0
            ? "passed"
            : discrepancies.length > 100
            ? "failed"
            : "warning",
        recordsChecked: discrepancies.length + Math.floor(Math.random() * 1000), // Mock total records
        discrepancies: discrepancies.length,
        executedAt: new Date().toISOString(),
        executionTime: performance.now() - startTime,
        details: discrepancies
          .slice(0, 50)
          .map((d: any) => this.mapDiscrepancy(d, rule)),
      };

      // Cache result
      const redisClient = RedisClient.getInstance();
      const resultKey = `recon_result:${ruleId}:${Date.now()}`;
      await redisClient.setex(resultKey, 86400, JSON.stringify(result));

      // Record metrics
      await this.metrics.recordCounter("reconciliation_executions");
      await this.metrics.recordTimer(
        "reconciliation_execution_duration",
        result.executionTime
      );

      // Store execution history
      await this.storeExecutionResult(result);

      this.logger.info("Reconciliation execution completed", {
        ruleId,
        status: result.status,
        discrepancies: result.discrepancies,
      });

      return result;
    } catch (error) {
      await this.metrics.recordCounter("reconciliation_execution_errors");
      this.logger.error("Reconciliation execution failed", error as Error, {
        ruleId,
      });
      throw new Error(
        `Reconciliation execution failed: ${(error as Error).message}`
      );
    }
  }

  /**
   * Get reconciliation status overview
   */
  async getStatus(): Promise<{
    totalRules: number;
    activeRules: number;
    recentExecutions: number;
    failureRate: number;
    lastExecution?: string;
  }> {
    try {
      // Get total and active rules count
      const totalRules = await PostgreSQLClient.executeRaw(
        "SELECT COUNT(*) as count FROM reconciliation_rules"
      );
      const activeRules = await PostgreSQLClient.executeRaw(
        "SELECT COUNT(*) as count FROM reconciliation_rules WHERE enabled = true"
      );

      // Get recent executions (last 24 hours)
      const recentExecutions = await PostgreSQLClient.executeRaw(
        `SELECT COUNT(*) as count FROM reconciliation_executions 
         WHERE executed_at > NOW() - INTERVAL '24 hours'`
      );

      // Get recent failures
      const recentFailures = await PostgreSQLClient.executeRaw(
        `SELECT COUNT(*) as count FROM reconciliation_executions 
         WHERE executed_at > NOW() - INTERVAL '24 hours' AND status = 'failed'`
      );

      // Get last execution
      const lastExecution = await PostgreSQLClient.executeRaw(
        `SELECT executed_at FROM reconciliation_executions 
         ORDER BY executed_at DESC LIMIT 1`
      );

      const execCount = (recentExecutions as any[])[0]?.count || 0;
      const failCount = (recentFailures as any[])[0]?.count || 0;
      const failureRate = execCount > 0 ? (failCount / execCount) * 100 : 0;

      return {
        totalRules: (totalRules as any[])[0]?.count || 0,
        activeRules: (activeRules as any[])[0]?.count || 0,
        recentExecutions: execCount,
        failureRate: Math.round(failureRate * 100) / 100,
        lastExecution: (lastExecution as any[])[0]?.executed_at?.toISOString(),
      };
    } catch (error) {
      this.logger.error("Failed to get reconciliation status", error as Error);
      throw new Error(
        `Failed to get reconciliation status: ${(error as Error).message}`
      );
    }
  }

  /**
   * Schedule reconciliation for all active rules
   */
  async scheduleReconciliation(): Promise<{
    scheduled: number;
    failed: number;
    results: Array<{ ruleId: string; status: string; error?: string }>;
  }> {
    try {
      const rules = await this.getActiveRules();
      const results: Array<{ ruleId: string; status: string; error?: string }> =
        [];

      let scheduled = 0;
      let failed = 0;

      for (const rule of rules) {
        try {
          await this.executeReconciliation(rule.id);
          results.push({ ruleId: rule.id, status: "success" });
          scheduled++;
        } catch (error) {
          results.push({
            ruleId: rule.id,
            status: "failed",
            error: (error as Error).message,
          });
          failed++;
        }
      }

      await this.metrics.recordCounter("scheduled_reconciliations");

      this.logger.info("Scheduled reconciliation completed", {
        scheduled,
        failed,
      });

      return { scheduled, failed, results };
    } catch (error) {
      this.logger.error("Scheduled reconciliation failed", error as Error);
      throw new Error(
        `Scheduled reconciliation failed: ${(error as Error).message}`
      );
    }
  }

  /**
   * Auto-repair discrepancies
   */
  async autoRepair(
    ruleId: string,
    maxRepairs = 10
  ): Promise<RepairOperation[]> {
    try {
      const startTime = performance.now();

      // Get the rule to get target table
      const rule = await this.getRule(ruleId);
      if (!rule) {
        throw new Error(`Rule ${ruleId} not found`);
      }

      // Get latest reconciliation result
      const redisClient = RedisClient.getInstance();
      const resultKey = `recon_result:${ruleId}:latest`;
      const cachedResult = await redisClient.get(resultKey);

      if (!cachedResult) {
        throw new Error(
          `No recent reconciliation result found for rule ${ruleId}`
        );
      }

      const result: ReconciliationResult = JSON.parse(cachedResult);
      const repairOperations: RepairOperation[] = [];

      // Generate repair operations for discrepancies
      const discrepancies = result.details?.slice(0, maxRepairs) || [];

      for (const discrepancy of discrepancies) {
        const operation = await this.generateRepairOperation(
          discrepancy,
          rule.targetTable
        );
        if (operation) {
          repairOperations.push(operation);
        }
      }

      // Execute repair operations
      for (const operation of repairOperations) {
        await this.executeRepairOperation(operation);
      }

      await this.metrics.recordCounter("auto_repairs_executed");
      await this.metrics.recordTimer(
        "auto_repair_duration",
        performance.now() - startTime
      );

      this.logger.info("Auto-repair completed", {
        ruleId,
        repairsExecuted: repairOperations.length,
      });

      return repairOperations;
    } catch (error) {
      await this.metrics.recordCounter("auto_repair_errors");
      this.logger.error("Auto-repair failed", error as Error, { ruleId });
      throw new Error(`Auto-repair failed: ${(error as Error).message}`);
    }
  }

  // Private helper methods

  private async getRule(ruleId: string): Promise<ReconciliationRule | null> {
    try {
      // Try cache first
      const redisClient = RedisClient.getInstance();
      const cached = await redisClient.get(`recon_rule:${ruleId}`);
      if (cached) {
        return JSON.parse(cached);
      }

      // Get from database
      const rows = await PostgreSQLClient.executeRaw(
        `SELECT id, name, source_table, target_table, join_key, enabled,
                source_columns, target_columns, tolerance
         FROM reconciliation_rules WHERE id = $1`,
        [ruleId]
      );

      if ((rows as any[]).length === 0) {
        return null;
      }

      const row = (rows as any[])[0];
      const rule: ReconciliationRule = {
        id: row.id,
        name: row.name,
        sourceTable: row.source_table,
        targetTable: row.target_table,
        joinKey: row.join_key,
        enabled: row.enabled,
        sourceColumns: row.source_columns
          ? JSON.parse(row.source_columns)
          : undefined,
        targetColumns: row.target_columns
          ? JSON.parse(row.target_columns)
          : undefined,
        tolerance: row.tolerance,
      };

      // Cache for future use
      await redisClient.setex(
        `recon_rule:${ruleId}`,
        3600,
        JSON.stringify(rule)
      );

      return rule;
    } catch (error) {
      this.logger.error("Failed to get reconciliation rule", error as Error, {
        ruleId,
      });
      return null;
    }
  }

  private async getActiveRules(): Promise<ReconciliationRule[]> {
    try {
      const rows = await PostgreSQLClient.executeRaw(
        `SELECT id, name, source_table, target_table, join_key, enabled
         FROM reconciliation_rules WHERE enabled = true`
      );

      return (rows as any[]).map((row) => ({
        id: row.id,
        name: row.name,
        sourceTable: row.source_table,
        targetTable: row.target_table,
        joinKey: row.join_key,
        enabled: row.enabled,
      }));
    } catch (error) {
      this.logger.error(
        "Failed to get active reconciliation rules",
        error as Error
      );
      return [];
    }
  }

  private buildReconciliationQuery(rule: ReconciliationRule): {
    query: string;
    params: Record<string, any>;
  } {
    const sourceColumns = rule.sourceColumns || ["*"];
    const targetColumns = rule.targetColumns || ["*"];

    // Use ClickHouseQueryBuilder for secure query construction
    const queryBuilder = new ClickHouseQueryBuilder();

    // Build select clause with validated columns
    const selectFields: string[] = [];
    selectFields.push("s.{joinKey:String} as join_key");

    sourceColumns.forEach((col, index) => {
      selectFields.push(
        `s.{sourceCol${index}:String} as source_{sourceCol${index}:String}`
      );
    });

    targetColumns.forEach((col, index) => {
      selectFields.push(
        `t.{targetCol${index}:String} as target_{targetCol${index}:String}`
      );
    });

    // Build where conditions for discrepancies
    const whereConditions: string[] = [
      "s.{joinKey:String} IS NULL",
      "t.{joinKey:String} IS NULL",
    ];

    // Add column comparison conditions
    sourceColumns.forEach((col, index) => {
      const targetCol = targetColumns[index] || col;
      if (rule.tolerance) {
        whereConditions.push(
          `abs(s.{sourceCol${index}:String} - t.{targetCol${index}:String}) > {tolerance:Float64}`
        );
      } else {
        whereConditions.push(
          `s.{sourceCol${index}:String} != t.{targetCol${index}:String}`
        );
      }
    });

    // Build the secure query
    const query = `
      SELECT ${selectFields.join(", ")}
      FROM {sourceTable:String} s
      FULL OUTER JOIN {targetTable:String} t ON s.{joinKey:String} = t.{joinKey:String}
      WHERE (${whereConditions.join(" OR ")})
      LIMIT 1000
    `;

    // Build parameters object
    const params: Record<string, any> = {
      joinKey: rule.joinKey,
      sourceTable: rule.sourceTable,
      targetTable: rule.targetTable,
    };

    // Add column parameters
    sourceColumns.forEach((col, index) => {
      params[`sourceCol${index}`] = col;
    });

    targetColumns.forEach((col, index) => {
      params[`targetCol${index}`] = col;
    });

    if (rule.tolerance) {
      params.tolerance = rule.tolerance;
    }

    return { query, params };
  }

  private mapDiscrepancy(
    record: any,
    rule: ReconciliationRule
  ): DiscrepancyDetail {
    // Simple mapping - in real implementation, this would be more sophisticated
    const sourceColumns = rule.sourceColumns || [rule.joinKey];
    const column = sourceColumns[0];

    return {
      id: `disc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      column,
      sourceValue: record[`source_${column}`],
      targetValue: record[`target_${column}`],
      severity: "medium",
      confidence: 0.8,
    };
  }

  private async storeExecutionResult(
    result: ReconciliationResult
  ): Promise<void> {
    await PostgreSQLClient.executeRaw(
      `INSERT INTO reconciliation_executions 
       (rule_id, status, records_checked, discrepancies, executed_at, execution_time, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        result.ruleId,
        result.status,
        result.recordsChecked,
        result.discrepancies,
        result.executedAt,
        result.executionTime,
        JSON.stringify(result.details || []),
      ]
    );
  }

  private async generateRepairOperation(
    discrepancy: DiscrepancyDetail,
    targetTable: string = "target_table"
  ): Promise<RepairOperation | null> {
    // Validate column name to prevent injection
    const allowedColumns = [
      "value",
      "amount",
      "status",
      "quantity",
      "price",
      "name",
      "description",
    ];
    if (!allowedColumns.includes(discrepancy.column)) {
      throw new Error(`Invalid column name: ${discrepancy.column}`);
    }

    // Simple repair logic - update target to match source
    return {
      operationId: `repair_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`,
      type: "update",
      table: targetTable, // Would be derived from rule context
      query: `UPDATE target_table SET ${discrepancy.column} = $1 WHERE id = $2`,
      params: [discrepancy.sourceValue, discrepancy.id],
      estimatedImpact: 1,
    };
  }

  private async executeRepairOperation(
    operation: RepairOperation
  ): Promise<void> {
    try {
      await PostgreSQLClient.executeRaw(operation.query, operation.params);

      // Log successful repair
      await PostgreSQLClient.executeRaw(
        `INSERT INTO repair_operations (operation_id, type, status, executed_at)
         VALUES ($1, $2, $3, NOW())`,
        [operation.operationId, operation.type, "success"]
      );
    } catch (error) {
      // Log failed repair
      await PostgreSQLClient.executeRaw(
        `INSERT INTO repair_operations (operation_id, type, status, error, executed_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [
          operation.operationId,
          operation.type,
          "failed",
          (error as Error).message,
        ]
      );
      throw error;
    }
  }
}
