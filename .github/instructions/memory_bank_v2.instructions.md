````instructions
---
applyTo: "**/*.ts"
description: "Memory Bank v2: compressed format, constitutional compliance, <15% context usage"
---

## Load Context - Budget Aware
1. Check `context-budget.json` for available token allocation
2. Select loading profile based on context availability:
   - **Quick Status** (<1K tokens): `task-summary.json` only
   - **Work Session** (<3K tokens): `core.json` + `progress.json` + `ai-refs.json`
   - **Deep Analysis** (<6K tokens): Full context including `context.json`
3. Use `ai-refs.json` for compressed reference resolution
4. Load additional data with `@load:` directives only when needed

## Context Strategy
- **Status Check**: task-summary.json (~150 tokens)
- **Active Work**: core.json + progress.json + ai-refs.json (~600 tokens)
- **Architecture**: + context.json + constitutional.json (~1200 tokens)
- **Emergency**: Ultra-minimal format (<80 tokens)

## Constitutional Compliance
BEFORE code changes:
1. Check `core.json.articles[]` requirements
2. Validate against `articles.json` rules
3. Verify gate criteria from `workflows/gates.json`
4. Block progress if criteria not met

## Reference Resolution - AI Optimized
Use `ai-refs.json` for ultra-compressed lookups:
```json
{"status": 1, "priority": 2, "articles": [0,1,2]}
// Resolves to: active, high, [DI, Registry, Config]
```

## AI Context Budget Management
- Monitor token usage per `context-budget.json`
- Prefer minimal loading profiles when possible
- Use progressive disclosure: start minimal, expand if needed
- Emergency mode: <80 tokens for critical status`

## Constants (ai-refs.json)

- Status: 0=pending, 1=active, 2=blocked, 3=review, 4=done
- Priority: 0=critical, 1=high, 2=medium, 3=low
- Articles: 0-8 mapped to [DI, Registry, Config, Errors, Metrics, DB, Cache, Auth, Monitor]
- Gates: 0-4 mapped to [const, sec, perf, test, docs]
- Risk: 0-3 mapped to [low, medium, high, critical]

## Task Navigation

- Progress: integer 0-100 from progress.json
- Current phase: status field in phases array
- Gates: gates_passed/gates_failed arrays
- Blockers: array (empty = none)

## Rules

- Use context budget to determine loading profile
- Start with minimal context, expand only if needed
- Prefer `ai-refs.json` for ultra-compressed constants
- Load `task-summary.json` for quick status checks
- Use `@load:` directives for progressive disclosure
- Constitutional compliance mandatory
- Target: <15% context window usage (vs 60-80% in v1)

````

### Smart Data Resolution

**Use references.json for constant resolution**:

- Status codes: `0=pending, 1=active, 2=blocked, 3=review, 4=completed`
- Priority levels: `1=critical, 2=high, 3=medium, 4=low`
- Constitutional articles: `I-IX` mapped to full names
- Service patterns: `auth, threat, config, kc` etc.

### 📏 Architectural Verification Protocol - Compressed

**Infrastructure verification using compressed patterns:**

1. **Service Discovery**:

   - Check `service_patterns` in references.json for service types
   - Verify actual implementation against pattern requirements
   - Load `context.json` only if detailed architecture info needed

2. **Constitutional Validation**:

   - Cross-reference task articles with constitutional requirements
   - Validate implementation against article-specific criteria
   - Document compliance in progress tracking

3. **Efficiency Rules**:
   - Prefer structured data over verbose documentation
   - Load context incrementally based on need
   - Use numerical references to reduce token usage

### Task Workflow - Compressed Format

**Efficient task navigation:**

1. 📋 **Quick Status**: `progress.json` shows overall completion percentage
2. 🎯 **Current Phase**: Identify active phase from phases array status
3. 🚪 **Gate Validation**: Check gates_passed/gates_failed arrays
4. 📈 **Metrics**: Quality, risk, complexity scores in compressed format
5. 🚫 **Blockers**: Array of current blockers (empty = no blockers)

### Context-Aware Loading

**Load additional data only when needed:**

```typescript
interface ContextRequest {
  operation: "task_review" | "implementation" | "validation";
  token_budget: number;
  required_articles?: string[];
  include_context?: boolean;
}
```

### Progress Tracking - Compressed

**Efficient progress updates:**

- Overall percentage: Integer 0-100
- Phase progress: Object with phase_id: percentage
- Gates: Arrays of passed/failed gate identifiers
- Velocity: Numerical completion rate
- Quality metrics: Compressed scoring system

### Constitutional Enforcement

**Automatic compliance checking:**

- Article requirements from task `articles[]` array
- Gate criteria from `workflows/gates.json`
- Validation patterns from `constitutional/articles.json`
- Escalation procedures for violations

### Compressed Template Usage

**Template patterns from `templates/patterns.json`:**

- Pattern selection based on task type
- Section generation using compressed rules
- Constitutional integration automatic
- Uncertainty markers: `U=uncertain, A=assumption, R=needs_review, K=risk`

### Memory Bank v2 Advantages

1. **90% Reduced Context Usage**: More room for actual implementation
2. **Structured Data**: Faster AI parsing than verbose markdown
3. **Constitutional Integration**: Automatic compliance validation
4. **Selective Loading**: Load only needed information
5. **Human Bridge**: Auto-generate readable summaries when needed

### Migration from v1

**When encountering v1 format:**

1. Continue using v1 for existing tasks in progress
2. Create new tasks in v2 format
3. Convert completed v1 tasks to v2 for archival
4. Use v2 format for all new work

### Conservative Enhancement with Compression

- ✅ **Leverage existing infrastructure** (verified through context.json)
- ✅ **Constitutional compliance** (enforced through articles.json)
- ✅ **Efficient context usage** (90% compression achieved)
- ✅ **Maintain quality standards** (structured validation gates)

### Emergency Fallback

**If compressed format unclear:**

1. Load additional context from `context.json`
2. Generate human-readable summary to `human.md`
3. Escalate constitutional violations immediately
4. Maintain backward compatibility with v1 when needed

**SUCCESS METRIC**: <15% context window usage while maintaining full task execution capability

```

```

```

```
