---
mode: "agent"
tools:
  [
    "extensions",
    "codebase",
    "usages",
    "vscodeAPI",
    "think",
    "problems",
    "changes",
    "testFailure",
    "terminalSelection",
    "terminalLastCommand",
    "openSimpleBrowser",
    "fetch",
    "findTestFiles",
    "searchResults",
    "githubRepo",
    "runCommands",
    "runTasks",
    "editFiles",
    "runNotebooks",
    "search",
    "new",
  ]
description: "Create Memory Bank v2 tasks with ENFORCED optimization and validation - Generic framework"
---

# Create Memory Bank v2 Task - Enforced Optimization

## MANDATORY VALIDATION SEQUENCE

### 1. Pre-Creation Validation (REQUIRED)

```javascript
// Execute BEFORE any task creation:
✓ Check .memory_bankv2/config/context-budget.json
✓ Load .memory_bankv2/config/ai-refs.json
✓ Validate .memory_bankv2/config/validation-rules.json
✓ Select appropriate token profile
```

### 2. Token Budget Enforcement

- **Emergency**: <80 tokens (summary only)
- **Quick**: <150 tokens (summary only)
- **Standard**: <600 tokens (summary + core + progress)
- **Deep**: <1200 tokens (full context)

**AI MUST NOT EXCEED ALLOCATED TOKENS**

## ENFORCED CREATION PROTOCOL

### Step 1: Budget Validation (MANDATORY)

```bash
# AI MUST execute first:
budget=$(cat .memory_bankv2/config/context-budget.json | jq '.available')
if [ "$budget" -lt 600 ]; then profile="emergency"; else profile="standard"; fi
```

### Step 2: Compressed File Generation (ENFORCED LIMITS)

**task-summary.json** (MAX 150 tokens - ENFORCED):

```json
{
  "id": "task-name",
  "s": 1,
  "p": 2,
  "prog": 0,
  "art": [0, 1, 2],
  "gates": [0, 4],
  "r": 1
}
```

- **Validation**: Length check, required fields, token count
- **Auto-compression**: Remove spaces, use numeric codes only

**core.json** (MAX 400 tokens - ENFORCED):

```json
{
  "task": "name",
  "created": "YYYY-MM-DD",
  "desc": "<200 chars",
  "objectives": ["obj1", "obj2"],
  "phases": [{ "name": "phase1", "tasks": ["<100 chars"], "prog": 0 }],
  "constitutional": { "articles": [0, 1, 2], "gates": [0, 4], "compliance": 0 }
}
```

- **Validation**: Character limits enforced, compression required
- **Auto-optimization**: Abbreviate where possible, numeric references

**progress.json** (MAX 200 tokens - ENFORCED):

```json
{
  "overall": 0,
  "phases": { "phase1": 0 },
  "milestones": [],
  "blockers": [],
  "time": { "est": "4h", "actual": "0h" }
}
```

### Step 3: Constitutional Compliance (MANDATORY)

**Auto-Selection Rules**:

```json
{
  "development": [0, 1, 2, 3, 4], // Always include quality + testing
  "performance": [0, 2, 4, 5, 7], // Always include monitoring
  "bugfix": [3, 4, 7], // Security + docs + monitoring
  "infrastructure": [0, 1, 2, 4, 7] // Quality + performance + monitoring
}
```

**Gate Assignment (REQUIRED)**:

- Performance tasks → gates [2,4] (perf validation + docs)
- Security tasks → gates [1,4] (sec validation + docs)
- General tasks → gates [0,4] (constitutional + docs)

### Step 4: Quality Assurance (ENFORCED)

**Pre-Save Validation**:

```javascript
// AI MUST validate before saving:
if (taskName.length > 100) REJECT("Name too long");
if (description.length > 200) COMPRESS("Description exceeds limit");
if (articles.length < 1) BLOCK("Missing constitutional articles");
if (gates.length < 1) BLOCK("Missing phase gates");
if (tokenCount > limit) OPTIMIZE("Exceeds token budget");
```

## OPTIMIZED TASK TYPES & VALIDATION

**Enforced Format**: `{action}-{component}-{objective}` (≤100 chars, validated)

**Auto-Optimized Types**:

- `feat-{name}` → Development pattern [0,1,2,3,4]
- `perf-{comp}` → Performance pattern [0,2,4,5,7]
- `fix-{issue}` → Bugfix pattern [3,4,7]
- `refact-{mod}` → Development pattern [0,1,2,3,4]
- `setup-{tool}` → Infrastructure pattern [0,1,2,4,7]

**Smart Defaults (Auto-Applied)**:

- Priority: 2 (medium) unless critical/high specified
- Risk: 1 (medium) for modifications, 0 (low) for new features
- Gates: Auto-assigned based on article selection
- Status: 1 (active) for new tasks

## ENFORCEMENT EXAMPLES

### ✅ CORRECT Creation:

```
Input: create task: perf-database-queries
Auto-Applied:
- Type: performance → articles [0,2,4,5,7], gates [2,4]
- Priority: 1 (high for performance)
- Risk: 1 (medium)
- Token validation: All files under limits
Result: ✅ Task created successfully
```

### ❌ REJECTED Creation:

```
Input: create task: optimize-the-entire-database-connection-pooling-system-for-maximum-performance-enhancement
Rejection: Task name exceeds 100 characters
Auto-Fix: Compress to "perf-db-connection-pooling"
```

## AI ASSISTANT IMPROVEMENT MECHANISMS

### 1. Automatic Compression

```javascript
// AI applies these optimizations automatically:
longNames → abbreviations (implementation → impl)
verbose → compressed (optimization → opt)
spaces → removed in JSON
arrays → preferred over objects
```

### 2. Smart Validation

```javascript
// AI validates and auto-corrects:
if (tokenCount > limit) {
  autoCompress();
}
if (articles.length === 0) {
  autoAssign(taskType);
}
if (gates.length === 0) {
  autoAssign(articles);
}
if (risk === undefined) {
  autoAssign(taskComplexity);
}
```

### 3. Context Awareness

```javascript
// AI adapts to available resources:
if (contextBudget < 600) {
  useEmergencyMode();
}
if (contextBudget < 1200) {
  useQuickMode();
} else {
  useStandardMode();
}
```

### 4. Quality Gates

```javascript
// AI enforces before saving:
validateTokenLimits() || BLOCK;
validateConstitutional() || BLOCK;
validateStructure() || BLOCK;
generateHumanSummary() || WARN;
```

## COMMAND OPTIMIZATION

**Enhanced Command Processing**:

```
create task: {action}-{component}-{objective}
// Auto-processing:
✓ Validate length ≤100 chars
✓ Auto-select type pattern
✓ Apply constitutional articles
✓ Assign phase gates
✓ Set smart defaults
✓ Compress for token efficiency
✓ Generate human summary
```

**Success Validation**:

```
✓ Token budget: <600 (standard profile)
✓ Constitutional: ≥1 article, ≥1 gate
✓ Structure: All required fields
✓ Clarity: human.md generated
✓ Efficiency: >80% token reduction achieved
```

---

**ENFORCED RESULT**: Memory Bank v2 task with guaranteed <600 tokens, constitutional compliance, and maintained clarity through systematic optimization and validation.

```

```
