---
applyTo: "**/*.ts"
description: "Memory Bank v2 Enhanced: with mandatory validation, constitutional compliance, and optimization enforcement"
---

## Task Creation Protocol - Enhanced

### MANDATORY PRE-CREATION VALIDATION

**STEP 1: Context Budget Verification**

```bash
# REQUIRED: Check context budget BEFORE creating task
cat .memory_bankv2/config/context-budget.json
```

- Verify available token allocation
- Select appropriate loading profile
- Document budget decision in task creation

**STEP 2: Constitutional Article Validation**

```bash
# REQUIRED: Validate constitutional requirements
cat .memory_bankv2/constitutional/articles.json
cat .memory_bankv2/workflows/gates.json
```

- Verify article selection matches task type
- Confirm gate criteria are achievable
- Document compliance requirements

**STEP 3: Dependency Analysis**

```bash
# REQUIRED: Check existing systems
find . -name "*.ts" -path "*/apps/*" -exec grep -l "ClickHouse\|performance\|monitoring" {} \;
```

- Identify dependent systems/modules
- Verify integration points exist
- Document architectural dependencies

### ENHANCED CREATION WORKFLOW

#### Phase 1: Validation & Planning

1. **Context Budget Check**: Document token allocation strategy
2. **Constitutional Mapping**: Map task requirements to specific articles
3. **Dependency Verification**: Confirm integration capabilities
4. **Risk Assessment**: Validate risk level against project impact

#### Phase 2: Enhanced File Generation

**task-summary.json** (Enhanced - 150 tokens):

```json
{
  "id": "task-name",
  "s": 1,
  "p": 1,
  "prog": 0,
  "art": [0, 2, 4, 5, 7],
  "gates": [2, 4],
  "r": 1,
  "budget": "standard", // NEW: Context budget used
  "deps": ["system1", "system2"] // NEW: Dependencies
}
```

**core.json** (Enhanced - 450 tokens):

```json
{
  "task": "task-name",
  "created": "YYYY-MM-DD",
  "desc": "Brief description",
  "objectives": ["obj1", "obj2"],
  "phases": [...],
  "constitutional": {
    "articles": [0,2,4,5,7],
    "gates": [2,4],
    "compliance": 0,
    "criteria": { // NEW: Specific gate criteria
      "perf": "95th percentile < 50ms",
      "docs": "API documentation complete"
    }
  },
  "dependencies": { // NEW: System dependencies
    "systems": ["clickhouse", "monitoring"],
    "apis": ["@libs/database", "@libs/monitoring"],
    "validation": "confirmed"
  },
  "metrics": { // NEW: Success metrics
    "performance": "throughput increase >20%",
    "quality": "test coverage >90%",
    "monitoring": "alert accuracy >95%"
  }
}
```

### CONSTITUTIONAL ENFORCEMENT

**Automatic Compliance Validation**:

```typescript
interface ConstitutionalValidation {
  articlesMandatory: number[]; // Required articles for task type
  gatesCriteria: Record<string, string>; // Specific success criteria
  blockers: string[]; // Constitutional violations that block progress
  escalation: "warn" | "block" | "review"; // Violation response
}
```

**Task Type → Constitutional Mapping**:

```json
{
  "performance": {
    "mandatoryArticles": [0, 2, 4, 7], // Code Quality, Performance, Documentation, Monitoring
    "recommendedGates": [2, 4], // Performance, Documentation
    "criteria": {
      "perf": "Response time improvement measurable",
      "docs": "Performance impact documented"
    }
  },
  "feature": {
    "mandatoryArticles": [0, 1, 2, 3, 4], // Full development lifecycle
    "recommendedGates": [0, 1, 3, 4], // Constitutional, Security, Testing, Documentation
    "criteria": {
      "const": "Design review completed",
      "sec": "Security assessment completed",
      "test": "Test coverage >90%",
      "docs": "User documentation complete"
    }
  }
}
```

### OPTIMIZATION ENFORCEMENT

**Context Budget Management**:

- Emergency: <80 tokens - Status only
- Quick: <150 tokens - Summary only
- Standard: <600 tokens - Summary + Core + Progress
- Deep: <1200 tokens - Full context

**Quality Gates**:

1. **Token Efficiency**: Must stay within budget profile
2. **Constitutional Compliance**: All articles must have validation criteria
3. **Dependency Verification**: All system dependencies must be confirmed
4. **Metrics Definition**: Success criteria must be measurable

### ENHANCED VALIDATION RULES

**Blocking Validations** (Prevent task creation):

- Missing constitutional articles for task type
- Undefined gate criteria
- Unconfirmed system dependencies
- Token usage exceeding profile budget

**Warning Validations** (Flag for review):

- High risk level without justification
- Complex phases without breakdown
- Missing performance metrics
- No monitoring integration plan

**Auto-Enhancement** (Automatically improve):

- Generate missing gate criteria
- Suggest dependency checks
- Recommend monitoring integration
- Optimize token usage

### USAGE PROTOCOL

```bash
# Enhanced task creation command
create task: {action}-{component}-{objective}
budget: {emergency|quick|standard|deep}
validation: {strict|standard|permissive}
constitutional: {enforce|warn|skip}
dependencies: ["system1", "system2"]
metrics: {"performance": "criteria", "quality": "criteria"}
```

**Example Enhanced Creation**:

```bash
create task: perf-clickhouse-batch-monitoring
budget: standard
validation: strict
constitutional: enforce
dependencies: ["clickhouse", "@libs/monitoring", "@libs/database"]
metrics: {
  "performance": "batch throughput increase >20%",
  "quality": "monitoring accuracy >95%",
  "reliability": "zero data loss during optimization"
}
```

### SUCCESS METRICS

- **Token Efficiency**: <15% context window usage maintained
- **Constitutional Compliance**: 100% articles validated before creation
- **Quality Assurance**: All gate criteria defined and measurable
- **Dependency Management**: All integrations confirmed before implementation
- **Performance Tracking**: All tasks have measurable success criteria

### ESCALATION PROCEDURES

**Constitutional Violations**:

1. **Immediate Block**: Missing mandatory articles
2. **Review Required**: High risk without justification
3. **Auto-Enhancement**: Generate missing criteria

**Performance Issues**:

1. **Budget Exceeded**: Recommend profile upgrade or compression
2. **Slow Creation**: Optimize validation workflow
3. **Validation Failures**: Enhanced dependency checking

This enhanced protocol ensures Memory Bank v2 tasks are created with maximum efficiency, constitutional compliance, and built-in quality assurance.
