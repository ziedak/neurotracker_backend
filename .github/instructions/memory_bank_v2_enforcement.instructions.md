---
applyTo: "**"
description: "Memory Bank v2 AI Assistant Optimization Enforcement"
---

## MANDATORY PRE-TASK VALIDATION

### 1. Context Budget Check (REQUIRED)

```javascript
// AI MUST execute this check FIRST:
const budget = await checkContextBudget();
if (budget.available < 600) {
  useProfile = "emergency"; // <80 tokens
} else if (budget.available < 1200) {
  useProfile = "quick"; // <150 tokens
} else {
  useProfile = "standard"; // <600 tokens
}
```

### 2. Constitutional Compliance Validation (REQUIRED)

```javascript
// AI MUST validate BEFORE creating task:
const articles = selectArticles(taskType);
const gates = validateGates(articles);
if (!articles.length || !gates.length) {
  BLOCK_TASK_CREATION();
}
```

### 3. Token Efficiency Enforcement (REQUIRED)

```javascript
// AI MUST track tokens during creation:
const tokenCount = calculateTokens(jsonContent);
if (tokenCount > limits[fileType]) {
  COMPRESS_FURTHER() || BLOCK_CREATION();
}
```

## AI OPTIMIZATION RULES

### Rule 1: Always Check Budget First

- NEVER create task without reading `context-budget.json`
- ALWAYS select appropriate profile based on available tokens
- VALIDATE token limits before file creation

### Rule 2: Mandatory Compression

- USE numeric codes from `ai-refs.json` (status: 0-4, priority: 0-3, etc.)
- AVOID verbose descriptions (max 200 chars)
- COMPRESS JSON structure (remove whitespace in production files)

### Rule 3: Constitutional Integration

- ALWAYS select minimum 1 constitutional article
- ALWAYS assign minimum 1 phase gate
- VALIDATE constitutional compliance before proceeding

### Rule 4: Progressive Disclosure

- START with task-summary.json (150 tokens max)
- ADD core.json only if needed (400 tokens max)
- LOAD context.json only on-demand (800 tokens max)

### Rule 5: Quality Gates

- GENERATE human.md for clarity verification
- VALIDATE all required fields present
- CHECK token usage against budget

## ENHANCED VALIDATION PROTOCOL

### Pre-Creation Checklist:

```
□ Context budget verified
□ AI refs loaded
□ Constitutional articles selected
□ Phase gates assigned
□ Token limits calculated
□ Risk level assessed
□ Validation rules checked
```

### Error Prevention:

```
- Task name > 100 chars → REJECT
- Description > 200 chars → COMPRESS
- Missing constitutional articles → BLOCK
- No phase gates → REQUIRE SELECTION
- Token budget exceeded → OPTIMIZE
```

### Success Metrics:

```
- Token efficiency: >80% reduction vs traditional
- Context usage: <15% of available window
- Constitutional compliance: 100%
- Human readability: Maintained via human.md
```

## AI ASSISTANT ENHANCEMENT RULES

### 1. Smart Defaults

- Default to "development" pattern for unclear tasks
- Auto-select common articles [0,1,2,3,4] for general work
- Use medium priority (2) unless specified
- Set risk to low (0) for new features, medium (1) for modifications

### 2. Compression Intelligence

- Replace long phrases with tokens: "implementation" → "impl"
- Use arrays instead of objects where possible
- Leverage ai-refs.json for all constants
- Minimize nested structures

### 3. Context Awareness

- Monitor running token count during creation
- Adjust compression level based on available budget
- Use emergency mode (<80 tokens) when context is limited
- Provide expansion paths with @load: directives

### 4. Quality Assurance

- Always generate human.md for verification
- Validate JSON structure before saving
- Check constitutional compliance automatically
- Provide clear error messages for violations

## ENFORCEMENT MECHANISMS

### Automatic Validation:

1. Pre-task creation hooks validate all requirements
2. Token counting enforced at each file creation
3. Constitutional compliance checked before proceeding
4. Budget exhaustion triggers emergency mode

### Error Handling:

1. Token limit exceeded → Automatic compression
2. Missing constitutional articles → Block with suggestion
3. Invalid phase gates → Provide valid options
4. Budget insufficient → Switch to emergency profile

### Success Tracking:

1. Token efficiency metrics logged
2. Constitutional compliance rate tracked
3. Human readability scores monitored
4. AI assistant performance measured

## EXAMPLE ENFORCED CREATION

```javascript
// Enhanced AI Assistant Process:
1. checkContextBudget() → 600 tokens available
2. loadAIRefs() → Load compression constants
3. selectProfile("standard") → 600 token budget
4. validateTask(input) → Check name/desc limits
5. selectArticles(taskType) → Auto-assign [0,1,2,3,4]
6. assignGates(articles) → Auto-assign [0,4]
7. createCompressed() → Generate optimized JSON
8. validateTokens() → Verify under limits
9. generateHuman() → Create readable summary
10. saveTask() → Store compressed structure
```

**RESULT**: Enforced 80%+ token efficiency with maintained clarity and comprehensive guidance through systematic validation and optimization.
