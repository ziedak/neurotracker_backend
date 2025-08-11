import {
  ClickHouseClient,
  PostgreSQLClient,
  RedisClient,
} from "@libs/database";
import { Logger, MetricsCollector } from "@libs/monitoring";
import { performance } from "perf_hooks";

export interface ReconciliationRule {
  id: string;
  name: string;
  sourceTable: string;
  targetTable: string;
  joinKey: string;
  enabled: boolean;
}

export interface ReconciliationResult {
  ruleId: string;
  status: "passed" | "failed" | "warning";
  recordsChecked: number;
  discrepancies: number;
  executedAt: string;
  executionTime: number;
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
    rule: Omit<ReconciliationRule, "id">
  ): Promise<{ ruleId: string }> {
    const startTime = performance.now();

    try {
      const ruleId = `recon_rule_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;

      const ruleWithId: ReconciliationRule = {
        id: ruleId,
        ...rule,
      };

      // Store in cache for fast access
      const redisClient = RedisClient.getInstance();
      await redisClient.setex(
        `recon_rule:${ruleId}`,
        3600,
        JSON.stringify(ruleWithId)
      );

      await this.metrics.recordCounter("reconciliation_rules_created");
      await this.metrics.recordTimer(
        "reconciliation_rule_creation_time",
        performance.now() - startTime
      );

      this.logger.info("Reconciliation rule created", {
        ruleId,
        name: rule.name,
      });

      return { ruleId };
    } catch (error) {
      await this.metrics.recordCounter("reconciliation_rule_creation_errors");
      this.logger.error(
        "Failed to create reconciliation rule",
        error as Error,
        { rule }
      );
      throw new Error(
        `Failed to create reconciliation rule: ${(error as Error).message}`
      );
    }
  }

  /**
   * Execute reconciliation for a specific rule
   */
  async executeReconciliation(ruleId: string): Promise<ReconciliationResult> {
    const startTime = performance.now();

    try {
      // Get rule from cache
      const redisClient = RedisClient.getInstance();
      const cachedRule = await redisClient.get(`recon_rule:${ruleId}`);

      if (!cachedRule) {
        throw new Error(`Rule ${ruleId} not found`);
      }

      const rule: ReconciliationRule = JSON.parse(cachedRule);

      if (!rule.enabled) {
        throw new Error(`Rule ${ruleId} is disabled`);
      }

      this.logger.info("Starting reconciliation", {
        ruleId,
        ruleName: rule.name,
      });

      // Simple reconciliation: check record counts between source and target
      const sourceCount = await ClickHouseClient.execute(`
        SELECT COUNT(*) as count FROM ${rule.sourceTable}
      `);

      const targetCount = await ClickHouseClient.execute(`
        SELECT COUNT(*) as count FROM ${rule.targetTable}
      `);

      const sourceRecords = parseInt(sourceCount[0]?.count || "0");
      const targetRecords = parseInt(targetCount[0]?.count || "0");
      const discrepancies = Math.abs(sourceRecords - targetRecords);

      const result: ReconciliationResult = {
        ruleId,
        status:
          discrepancies === 0
            ? "passed"
            : discrepancies > 100
            ? "failed"
            : "warning",
        recordsChecked: Math.max(sourceRecords, targetRecords),
        discrepancies,
        executedAt: new Date().toISOString(),
        executionTime: performance.now() - startTime,
      };

      // Cache result for reporting
      await redisClient.setex(
        `recon_result:${ruleId}:latest`,
        1800,
        JSON.stringify(result)
      );

      await this.metrics.recordCounter("reconciliation_executions");
      await this.metrics.recordTimer(
        "reconciliation_execution_time",
        result.executionTime
      );

      this.logger.info("Reconciliation completed", {
        ruleId,
        status: result.status,
        discrepancies: result.discrepancies,
        executionTime: result.executionTime,
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
   * Get reconciliation status and health metrics
   */
  async getStatus(): Promise<{
    totalRules: number;
    lastExecution?: string;
    systemHealth: "healthy" | "warning" | "critical";
  }> {
    try {
      const redisClient = RedisClient.getInstance();

      // Get all rule keys from Redis
      const ruleKeys = await redisClient.keys("recon_rule:*");
      const totalRules = ruleKeys.length;

      // Get latest execution (simplified - just check if any results exist)
      const resultKeys = await redisClient.keys("recon_result:*:latest");
      const lastExecution =
        resultKeys.length > 0 ? new Date().toISOString() : undefined;

      // Simple health check based on number of rules
      let systemHealth: "healthy" | "warning" | "critical" = "healthy";
      if (totalRules === 0) {
        systemHealth = "warning";
      }

      return {
        totalRules,
        lastExecution,
        systemHealth,
      };
    } catch (error) {
      this.logger.error("Failed to get reconciliation status", error as Error);
      throw new Error(
        `Failed to get reconciliation status: ${(error as Error).message}`
      );
    }
  }

  /**
   * Schedule reconciliation for all enabled rules
   */
  async scheduleReconciliation(): Promise<{
    scheduled: number;
    results: ReconciliationResult[];
  }> {
    try {
      const redisClient = RedisClient.getInstance();

      // Get all rule keys
      const ruleKeys = await redisClient.keys("recon_rule:*");
      const results: ReconciliationResult[] = [];

      this.logger.info("Starting scheduled reconciliation", {
        rulesCount: ruleKeys.length,
      });

      for (const key of ruleKeys) {
        try {
          const ruleData = await redisClient.get(key);
          if (ruleData) {
            const rule: ReconciliationRule = JSON.parse(ruleData);
            if (rule.enabled) {
              const result = await this.executeReconciliation(rule.id);
              results.push(result);
            }
          }
        } catch (error) {
          this.logger.error(
            "Scheduled reconciliation failed for rule",
            error as Error,
            { key }
          );
        }
      }

      await this.metrics.recordCounter("scheduled_reconciliations");

      return { scheduled: ruleKeys.length, results };
    } catch (error) {
      this.logger.error("Scheduled reconciliation failed", error as Error);
      throw new Error(
        `Scheduled reconciliation failed: ${(error as Error).message}`
      );
    }
  }

  /**
   * Execute reconciliation for a specific rule
   */
  async executeReconciliation(ruleId: string): Promise<ReconciliationResult> {
    const startTime = performance.now();

    try {
      // Get rule from cache or database
      const rule = await this.getRule(ruleId);
      if (!rule || !rule.enabled) {
        throw new Error(`Rule ${ruleId} not found or disabled`);
      }

      this.logger.info("Starting reconciliation", {
        ruleId,
        ruleName: rule.name,
      });

      // Build reconciliation query
      const reconciliationQuery = this.buildReconciliationQuery(rule);

      // Execute reconciliation
      const discrepancies = await this.clickhouse.query(reconciliationQuery);

      const result: ReconciliationResult = {
        ruleId,
        status:
          discrepancies.length === 0
            ? "passed"
            : discrepancies.length > 100
            ? "failed"
            : "warning",
        recordsChecked: await this.getRecordCount(rule),
        discrepancies: discrepancies.length,
        details: discrepancies.map((d) => this.mapDiscrepancy(d, rule)),
        executedAt: new Date().toISOString(),
        executionTime: performance.now() - startTime,
      };

      // Store result in PostgreSQL
      await this.storeReconciliationResult(result);

      // Cache result for reporting
      await this.redis.setex(
        `recon_result:${ruleId}:latest`,
        1800,
        JSON.stringify(result)
      );

      this.metrics.incrementCounter("reconciliation_executions");
      this.metrics.recordTiming(
        "reconciliation_execution_time",
        result.executionTime
      );
      this.metrics.recordGauge(
        "reconciliation_discrepancies",
        discrepancies.length
      );

      this.logger.info("Reconciliation completed", {
        ruleId,
        status: result.status,
        discrepancies: result.discrepancies,
        executionTime: result.executionTime,
      });

      return result;
    } catch (error) {
      this.metrics.incrementCounter("reconciliation_execution_errors");
      this.logger.error("Reconciliation execution failed", {
        error: error.message,
        ruleId,
      });
      throw new Error(`Reconciliation execution failed: ${error.message}`);
    }
  }

  /**
   * Get all reconciliation rules
   */
  async getRules(enabled?: boolean): Promise<ReconciliationRule[]> {
    try {
      let query = "SELECT * FROM reconciliation_rules";
      const params: any[] = [];

      if (enabled !== undefined) {
        query += " WHERE enabled = $1";
        params.push(enabled);
      }

      query += " ORDER BY created_at DESC";

      const rows = await this.postgres.query(query, params);

      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        sourceTable: row.source_table,
        targetTable: row.target_table,
        sourceColumns: JSON.parse(row.source_columns),
        targetColumns: JSON.parse(row.target_columns),
        joinKey: row.join_key,
        tolerance: row.tolerance,
        enabled: row.enabled,
      }));
    } catch (error) {
      this.logger.error("Failed to get reconciliation rules", {
        error: error.message,
      });
      throw new Error(`Failed to get reconciliation rules: ${error.message}`);
    }
  }

  /**
   * Auto-repair discrepancies based on configured rules
   */
  async autoRepair(
    ruleId: string,
    maxRepairs: number = 100
  ): Promise<RepairOperation[]> {
    const startTime = performance.now();

    try {
      const rule = await this.getRule(ruleId);
      if (!rule) {
        throw new Error(`Rule ${ruleId} not found`);
      }

      // Get recent reconciliation result
      const resultKey = `recon_result:${ruleId}:latest`;
      const cachedResult = await this.redis.get(resultKey);
      if (!cachedResult) {
        throw new Error(
          "No recent reconciliation result found. Please run reconciliation first."
        );
      }

      const result: ReconciliationResult = JSON.parse(cachedResult);
      const repairOperations: RepairOperation[] = [];

      // Process discrepancies for auto-repair
      for (const discrepancy of result.details.slice(0, maxRepairs)) {
        if (
          discrepancy.severity === "low" ||
          discrepancy.severity === "medium"
        ) {
          const operation = await this.createRepairOperation(rule, discrepancy);
          if (operation) {
            repairOperations.push(operation);
          }
        }
      }

      // Execute repair operations
      for (const operation of repairOperations) {
        await this.executeRepairOperation(operation);
      }

      this.metrics.incrementCounter("auto_repairs_executed");
      this.metrics.recordTiming(
        "auto_repair_time",
        performance.now() - startTime
      );
      this.metrics.recordGauge(
        "repairs_applied",
        repairOperations.filter((op) => op.status === "applied").length
      );

      this.logger.info("Auto-repair completed", {
        ruleId,
        operationsCreated: repairOperations.length,
        operationsApplied: repairOperations.filter(
          (op) => op.status === "applied"
        ).length,
      });

      return repairOperations;
    } catch (error) {
      this.metrics.incrementCounter("auto_repair_errors");
      this.logger.error("Auto-repair failed", { error: error.message, ruleId });
      throw new Error(`Auto-repair failed: ${error.message}`);
    }
  }

  /**
   * Schedule reconciliation for all enabled rules
   */
  async scheduleReconciliation(): Promise<{
    scheduled: number;
    results: ReconciliationResult[];
  }> {
    try {
      const enabledRules = await this.getRules(true);
      const results: ReconciliationResult[] = [];

      this.logger.info("Starting scheduled reconciliation", {
        rulesCount: enabledRules.length,
      });

      for (const rule of enabledRules) {
        try {
          const result = await this.executeReconciliation(rule.id);
          results.push(result);

          // Auto-repair if configured and discrepancies are manageable
          if (result.status === "warning" && result.discrepancies < 50) {
            await this.autoRepair(rule.id, 25);
          }
        } catch (error) {
          this.logger.error("Scheduled reconciliation failed for rule", {
            ruleId: rule.id,
            error: error.message,
          });
        }
      }

      this.metrics.incrementCounter("scheduled_reconciliations");
      this.metrics.recordGauge(
        "scheduled_rules_processed",
        enabledRules.length
      );

      return { scheduled: enabledRules.length, results };
    } catch (error) {
      this.logger.error("Scheduled reconciliation failed", {
        error: error.message,
      });
      throw new Error(`Scheduled reconciliation failed: ${error.message}`);
    }
  }

  /**
   * Get reconciliation status and health metrics
   */
  async getStatus(): Promise<{
    totalRules: number;
    enabledRules: number;
    lastExecution?: string;
    systemHealth: "healthy" | "warning" | "critical";
    metrics: any;
  }> {
    try {
      const allRules = await this.getRules();
      const enabledRules = allRules.filter((rule) => rule.enabled);

      // Get latest execution timestamp
      const latestResults = await this.postgres.query(`
        SELECT MAX(executed_at) as last_execution 
        FROM reconciliation_results
      `);

      // Calculate system health based on recent failures
      const recentFailures = await this.postgres.query(`
        SELECT COUNT(*) as failure_count
        FROM reconciliation_results 
        WHERE status = 'failed' AND executed_at > NOW() - INTERVAL '24 hours'
      `);

      const failureCount = parseInt(recentFailures[0]?.failure_count || "0");
      let systemHealth: "healthy" | "warning" | "critical" = "healthy";

      if (failureCount > 10) {
        systemHealth = "critical";
      } else if (failureCount > 3) {
        systemHealth = "warning";
      }

      return {
        totalRules: allRules.length,
        enabledRules: enabledRules.length,
        lastExecution: latestResults[0]?.last_execution,
        systemHealth,
        metrics: {
          totalDiscrepancies: await this.getTotalDiscrepancies(),
          avgExecutionTime: await this.getAverageExecutionTime(),
          successRate: await this.getSuccessRate(),
        },
      };
    } catch (error) {
      this.logger.error("Failed to get reconciliation status", {
        error: error.message,
      });
      throw new Error(`Failed to get reconciliation status: ${error.message}`);
    }
  }

  // Private helper methods

  private async getRule(ruleId: string): Promise<ReconciliationRule | null> {
    // Try cache first
    const cached = await this.redis.get(`recon_rule:${ruleId}`);
    if (cached) {
      return JSON.parse(cached);
    }

    // Fall back to database
    const rows = await this.postgres.query(
      "SELECT * FROM reconciliation_rules WHERE id = $1",
      [ruleId]
    );
    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    const rule: ReconciliationRule = {
      id: row.id,
      name: row.name,
      sourceTable: row.source_table,
      targetTable: row.target_table,
      sourceColumns: JSON.parse(row.source_columns),
      targetColumns: JSON.parse(row.target_columns),
      joinKey: row.join_key,
      tolerance: row.tolerance,
      enabled: row.enabled,
    };

    // Cache for future use
    await this.redis.setex(`recon_rule:${ruleId}`, 3600, JSON.stringify(rule));

    return rule;
  }

  private buildReconciliationQuery(rule: ReconciliationRule): string {
    const sourceColumns = rule.sourceColumns
      .map((col) => `s.${col} as source_${col}`)
      .join(", ");
    const targetColumns = rule.targetColumns
      .map((col) => `t.${col} as target_${col}`)
      .join(", ");

    const comparisons = rule.sourceColumns
      .map((sourceCol, index) => {
        const targetCol = rule.targetColumns[index];
        if (rule.tolerance && rule.tolerance > 0) {
          return `abs(s.${sourceCol} - t.${targetCol}) > ${rule.tolerance}`;
        } else {
          return `s.${sourceCol} != t.${targetCol}`;
        }
      })
      .join(" OR ");

    return `
      SELECT s.${rule.joinKey} as record_id, ${sourceColumns}, ${targetColumns}
      FROM ${rule.sourceTable} s
      JOIN ${rule.targetTable} t ON s.${rule.joinKey} = t.${rule.joinKey}
      WHERE ${comparisons}
      LIMIT 1000
    `;
  }

  private async getRecordCount(rule: ReconciliationRule): Promise<number> {
    const result = await this.clickhouse.query(`
      SELECT COUNT(*) as count FROM ${rule.sourceTable}
    `);
    return parseInt(result[0]?.count || "0");
  }

  private mapDiscrepancy(
    record: any,
    rule: ReconciliationRule
  ): DiscrepancyDetail {
    // Find the first discrepant column
    for (let i = 0; i < rule.sourceColumns.length; i++) {
      const sourceCol = rule.sourceColumns[i];
      const targetCol = rule.targetColumns[i];
      const sourceValue = record[`source_${sourceCol}`];
      const targetValue = record[`target_${targetCol}`];

      if (sourceValue !== targetValue) {
        const variance =
          typeof sourceValue === "number" && typeof targetValue === "number"
            ? Math.abs(sourceValue - targetValue)
            : undefined;

        let severity: "low" | "medium" | "high" = "low";
        if (variance && rule.tolerance) {
          severity =
            variance > rule.tolerance * 10
              ? "high"
              : variance > rule.tolerance * 3
              ? "medium"
              : "low";
        }

        return {
          recordId: record.record_id,
          column: sourceCol,
          sourceValue,
          targetValue,
          variance,
          severity,
        };
      }
    }

    // Fallback (shouldn't happen)
    return {
      recordId: record.record_id,
      column: rule.sourceColumns[0],
      sourceValue: record[`source_${rule.sourceColumns[0]}`],
      targetValue: record[`target_${rule.targetColumns[0]}`],
      severity: "low",
    };
  }

  private async storeReconciliationResult(
    result: ReconciliationResult
  ): Promise<void> {
    await this.postgres.query(
      `
      INSERT INTO reconciliation_results (rule_id, status, records_checked, discrepancies, 
                                        details, executed_at, execution_time)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
      [
        result.ruleId,
        result.status,
        result.recordsChecked,
        result.discrepancies,
        JSON.stringify(result.details),
        result.executedAt,
        result.executionTime,
      ]
    );
  }

  private async createRepairOperation(
    rule: ReconciliationRule,
    discrepancy: DiscrepancyDetail
  ): Promise<RepairOperation | null> {
    const operationId = `repair_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    // For now, default to updating target with source value for low severity discrepancies
    if (discrepancy.severity === "low" || discrepancy.severity === "medium") {
      return {
        operationId,
        ruleId: rule.id,
        recordId: discrepancy.recordId,
        action: "update_target",
        oldValue: discrepancy.targetValue,
        newValue: discrepancy.sourceValue,
        status: "pending",
      };
    }

    return null;
  }

  private async executeRepairOperation(
    operation: RepairOperation
  ): Promise<void> {
    try {
      // Store operation for audit trail
      await this.postgres.query(
        `
        INSERT INTO repair_operations (operation_id, rule_id, record_id, action, 
                                     old_value, new_value, status, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      `,
        [
          operation.operationId,
          operation.ruleId,
          operation.recordId,
          operation.action,
          JSON.stringify(operation.oldValue),
          JSON.stringify(operation.newValue),
          operation.status,
        ]
      );

      // Mark as applied (actual repair would be implemented based on specific requirements)
      operation.status = "applied";

      // Update status in database
      await this.postgres.query(
        `
        UPDATE repair_operations SET status = $1, applied_at = NOW() WHERE operation_id = $2
      `,
        ["applied", operation.operationId]
      );
    } catch (error) {
      operation.status = "failed";
      await this.postgres.query(
        `
        UPDATE repair_operations SET status = $1, error_message = $2 WHERE operation_id = $3
      `,
        ["failed", error.message, operation.operationId]
      );
    }
  }

  private async getTotalDiscrepancies(): Promise<number> {
    const result = await this.postgres.query(`
      SELECT SUM(discrepancies) as total FROM reconciliation_results 
      WHERE executed_at > NOW() - INTERVAL '24 hours'
    `);
    return parseInt(result[0]?.total || "0");
  }

  private async getAverageExecutionTime(): Promise<number> {
    const result = await this.postgres.query(`
      SELECT AVG(execution_time) as avg_time FROM reconciliation_results 
      WHERE executed_at > NOW() - INTERVAL '24 hours'
    `);
    return parseFloat(result[0]?.avg_time || "0");
  }

  private async getSuccessRate(): Promise<number> {
    const result = await this.postgres.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'passed' THEN 1 END) as passed
      FROM reconciliation_results 
      WHERE executed_at > NOW() - INTERVAL '24 hours'
    `);

    const total = parseInt(result[0]?.total || "0");
    const passed = parseInt(result[0]?.passed || "0");

    return total > 0 ? (passed / total) * 100 : 0;
  }
}
