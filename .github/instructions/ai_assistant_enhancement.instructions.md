---
applyTo: "**/*.md"
description: "Memory Bank v2 Quality Assurance and Token Efficiency Validator"
---

## AI ASSISTANT ENHANCEMENT PROTOCOL

### 1. MANDATORY VALIDATION SEQUENCE

**Pre-Task Creation Checklist**:

```javascript
// AI MUST execute ALL checks before creating any task:

✓ validateContextBudget()     // Check available tokens
✓ loadCompressionConstants()  // Load ai-refs.json
✓ validateTaskInput()         // Check name/desc limits
✓ selectConstitutionalFramework() // Auto-assign articles
✓ calculateTokenRequirements() // Estimate token usage
✓ applyOptimizationRules()    // Compress content
✓ generateValidatedStructure() // Create files
✓ verifyComplianceGates()     // Constitutional check
✓ createHumanSummary()        // Clarity verification
```

### 2. TOKEN EFFICIENCY ENFORCEMENT

**Automatic Compression Rules**:

```javascript
// AI applies these transformations automatically:

// Length Limits (ENFORCED):
taskName.length <= 100 || REJECT
description.length <= 200 || COMPRESS
phaseTask.length <= 100 || ABBREVIATE

// Content Optimization (AUTO-APPLIED):
"implementation" → "impl"
"optimization" → "opt"
"configuration" → "config"
"authentication" → "auth"
"performance" → "perf"
"infrastructure" → "infra"

// JSON Compression (ENFORCED):
removeWhitespace(jsonContent)
useNumericCodes(statusPriorityRisk)
minimizeNesting(objectStructure)
```

### 3. CONSTITUTIONAL COMPLIANCE AUTOMATION

**Auto-Selection Matrix**:

```javascript
// AI automatically assigns based on task type:

const articleMap = {
  "feature|feat": [0,1,2,3,4],      // Code + Testing + Perf + Sec + Docs
  "performance|perf": [0,2,4,5,7],   // Code + Perf + Docs + Data + Monitor
  "security|sec": [0,1,3,4,7],      // Code + Testing + Sec + Docs + Monitor
  "bugfix|fix": [3,4,7],            // Security + Docs + Monitor
  "infrastructure|infra": [0,1,2,4,7], // All except Data/Integration
  "data": [0,2,3,4,5,6],            // Code + Perf + Sec + Docs + Data + Integration
  "api": [0,1,2,3,4,6],             // Code + Testing + Perf + Sec + Docs + Integration
  "ui": [0,1,2,4],                  // Code + Testing + Perf + Docs
  "default": [0,1,2,3,4]            // Standard development pattern
};

const gateMap = {
  articles: {
    [0,1,2,3,4]: [0,4],   // Constitutional + Documentation
    [0,2,4,5,7]: [2,4],   // Performance + Documentation
    [0,1,3,4,7]: [1,4],   // Security + Documentation
    [3,4,7]: [1,4],       // Security + Documentation
  }
};
```

### 4. SMART DEFAULTS SYSTEM

**Context-Aware Assignments**:

```javascript
// AI intelligently assigns based on context:

function assignSmartDefaults(taskInput) {
  return {
    priority: determinePriority(taskInput.type, taskInput.urgency),
    risk: calculateRisk(taskInput.complexity, taskInput.scope),
    status: 1, // Always start active
    gates: autoAssignGates(selectedArticles),
    estimatedTime: calculateTimeEstimate(taskInput.phases),
    compliance: 0, // Start at 0%, track progress
  };
}

function determinePriority(type, urgency) {
  if (type.includes("fix") || urgency === "critical") return 0; // Critical
  if (type.includes("perf") || urgency === "high") return 1; // High
  if (type.includes("feat") || urgency === "medium") return 2; // Medium
  return 3; // Low
}

function calculateRisk(complexity, scope) {
  if (complexity === "high" || scope === "system-wide") return 2; // High
  if (complexity === "medium" || scope === "module") return 1; // Medium
  return 0; // Low
}
```

### 5. QUALITY ASSURANCE GATES

**Pre-Save Validation**:

```javascript
// AI MUST pass ALL validations before saving:

function validateTaskCreation(task) {
  const validations = [
    () => task.name.length <= 100,
    () => task.description.length <= 200,
    () => task.articles.length >= 1,
    () => task.gates.length >= 1,
    () => task.risk !== undefined,
    () => calculateTokens(task) <= getTokenLimit(profile),
    () => task.phases.length >= 1,
    () => task.constitutional.compliance !== undefined,
  ];

  const failures = validations.filter((v) => !v());
  if (failures.length > 0) {
    throw new ValidationError("Task creation blocked", failures);
  }

  return true;
}
```

### 6. ERROR PREVENTION & AUTO-CORRECTION

**Intelligent Fixes**:

```javascript
// AI automatically corrects common issues:

function autoCorrectTask(task) {
  // Fix naming issues
  if (task.name.length > 100) {
    task.name = compressTaskName(task.name);
  }

  // Fix missing constitutional elements
  if (!task.articles.length) {
    task.articles = autoSelectArticles(task.type);
  }

  // Fix missing gates
  if (!task.gates.length) {
    task.gates = autoAssignGates(task.articles);
  }

  // Compress content if over token limit
  if (calculateTokens(task) > getTokenLimit()) {
    task = applyCompressionRules(task);
  }

  return task;
}
```

### 7. PERFORMANCE METRICS & FEEDBACK

**Success Tracking**:

```javascript
// AI tracks and improves based on metrics:

const performanceMetrics = {
  tokenEfficiency: calculateTokenReduction(task),
  constitutionalCompliance: validateComplianceRate(task),
  clarityScore: validateHumanReadability(task.humanSummary),
  creationTime: measureCreationDuration(),
  errorRate: trackValidationFailures(),
};

// Target Metrics:
// tokenEfficiency: >80% reduction
// constitutionalCompliance: 100%
// clarityScore: >8/10
// creationTime: <30 seconds
// errorRate: <5%
```

### 8. CONTINUOUS IMPROVEMENT

**Learning Mechanism**:

```javascript
// AI learns from successful patterns:

function improveFromFeedback(taskHistory) {
  const successfulPatterns = analyzeSuccessfulTasks(taskHistory);
  const optimizationOpportunities = identifyImprovements(taskHistory);

  updateCompressionRules(successfulPatterns.compression);
  refineArticleSelection(successfulPatterns.constitutional);
  optimizeTokenUsage(optimizationOpportunities.efficiency);

  return updatedInstructions;
}
```

## IMPLEMENTATION RESULT

**Enhanced AI Assistant Capabilities**:

- ✅ **80%+ Token Efficiency**: Enforced through validation
- ✅ **100% Constitutional Compliance**: Auto-assigned and validated
- ✅ **Maintained Clarity**: Human-readable summaries required
- ✅ **Error Prevention**: Pre-save validation and auto-correction
- ✅ **Consistent Quality**: Standardized optimization rules
- ✅ **Continuous Improvement**: Performance metrics and learning

**Optimization Enforcement**: AI assistant now automatically applies best practices, prevents common errors, and maintains high-quality output while achieving extreme token efficiency without sacrificing clarity or comprehensive guidance.
