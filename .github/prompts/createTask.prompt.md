---
mode: "agent"
tools:
  [
    "changes",
    "codebase",
    "editFiles",
    "extensions",
    "fetch",
    "findTestFiles",
    "githubRepo",
    "new",
    "openSimpleBrowser",
    "problems",
    "runCommands",
    "runNotebooks",
    "runTasks",
    "runTests",
    "search",
    "searchResults",
    "terminalLastCommand",
    "terminalSelection",
    "testFailure",
    "usages",
    "vscodeAPI",
  ]
description: "Review , optimize the code and fix bugs."
---

# Create New Memory Bank Task

## Summary

This document defines how to create and initialize new task directories in the task-focused Memory Bank system.

---

## Core Process

### Quick Task Creation Flow:

1. **Read Current Context**

   - Read `.memory-bank/context/current-work.json`
   - Check active tasks to avoid conflicts

2. **Create Task Directory**

   - Format: `.memory-bank/tasks/YYYY-MM-DD-task-name/`
   - Use kebab-case for task names

3. **Initialize Task Files**
   - Copy from templates and customize
   - Update `current-work.json` with new task
   - Set initial progress tracking

---

## Task Directory Structure

```
.memory-bank/tasks/YYYY-MM-DD-task-name/
├── action-plan.md          # High-level phases and objectives
├── checklist.md            # Detailed actionable items
├── progress.json           # Real-time progress tracking
├── workflow-diagram.md     # Visual workflow representation
└── [task-specific files]   # Context docs, notes, etc.
```

---

## Step-by-Step Creation Process

### 1. Create Task Directory

```bash
TASK_DATE=$(date +%Y-%m-%d)
TASK_NAME="your-task-name"
mkdir -p ".memory-bank/tasks/${TASK_DATE}-${TASK_NAME}"
```

### 2. Initialize from Templates

Copy and customize templates:

**action-plan.md** (from `.memory-bank/templates/task-template.md`):

- Define task objectives and success criteria
- Break into logical phases
- Identify dependencies and risks
- Set time estimates

**checklist.md**:

- Create detailed, actionable items
- Group by phase or component
- Include validation steps
- Add acceptance criteria

**progress.json** (from `.memory-bank/templates/progress-template.json`):

- Initialize completion percentages
- Set up milestone tracking
- Configure time tracking
- Define blocker categories

### 3. Update Active Context

Update `.memory-bank/context/current-work.json`:

- Add new task to active tasks array
- Set priority and status
- Link to task directory
- Update last modified timestamp

---

## Template Customization

### Action Plan Template Structure:

```markdown
# Task: [Task Name]

Date: YYYY-MM-DD
Status: Active

## Objective

[Clear, measurable goal]

## Success Criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Phases

### Phase 1: [Name]

**Objective**: [Phase goal]
**Timeline**: [Estimate]
**Dependencies**: [List]

### Phase 2: [Name]

[Continue pattern]

## Risk Assessment

- **Risk**: [Description] | **Mitigation**: [Strategy]

## Resources

- [Links, docs, references]
```

### Progress JSON Template Structure:

```json
{
  "task": "task-name",
  "created": "YYYY-MM-DD",
  "status": "active",
  "progress": {
    "overall": 0,
    "phases": {
      "phase1": 0,
      "phase2": 0
    }
  },
  "milestones": [],
  "blockers": [],
  "timeTracking": {
    "estimated": "4h",
    "actual": "0h"
  }
}
```

---

## Task Types & Naming Conventions

### Common Task Types:

- `feature-[name]` - New feature development
- `refactor-[component]` - Code refactoring
- `bug-[issue]` - Bug investigation/fix
- `optimize-[system]` - Performance optimization
- `cleanup-[area]` - Code cleanup/maintenance
- `research-[topic]` - Investigation/research
- `setup-[tool]` - Infrastructure/tooling

### Naming Rules:

- Use kebab-case: `memory-bank-cleanup`
- Be specific: `optimize-event-listener-performance`
- Include scope: `refactor-di-container-integration`
- Avoid abbreviations: `implement-intersection-observer` not `impl-io`

---

## Integration with Living Document Workflow

### Real-Time Updates:

- Update `progress.json` as work progresses
- Check off items in `checklist.md`
- Document blockers and solutions immediately
- Track time spent vs. estimates

### Daily/Session Updates:

- Review all active tasks
- Update overall progress percentages
- Sync with `current-work.json`
- Document key discoveries or changes

---

## Task Lifecycle Management

### Active Task States:

- `planning` - Initial setup and planning
- `active` - Currently being worked on
- `blocked` - Waiting on dependencies
- `review` - Ready for validation
- `complete` - Finished and validated

### Completion Process:

1. Mark all checklist items complete
2. Set progress to 100%
3. Update status to "complete"
4. Archive or move to completed tasks
5. Update `current-work.json`

---

## Conservative Project Approach

**Remember for this enterprise-grade project:**

- 460+ TypeScript files - plan carefully
- Dual DI architecture - leverage existing patterns
- Sophisticated telemetry - build upon existing systems
- Risk Level: LOW-MEDIUM when enhancing existing infrastructure

### Task Planning Guidelines:

- Start with existing patterns and enhance
- Avoid creating new complexity layers
- Use comprehensive telemetry for insights
- Test incrementally with existing infrastructure

---

## Command Usage

### Create New Task:

```
"create new task: [task-name]"
```

### Example:

```
"create new task: optimize-event-listener-memory"
```

This will:

1. Create `.memory-bank/tasks/2025-01-27-optimize-event-listener-memory/`
2. Initialize from templates
3. Update current-work.json
4. Set up progress tracking

---

Ask me clarifying questions if needed before proceeding until you are 95% confident you can complete the task successfully.
what would a top 0,1% developer do in this situation?
reframe this in a way that changes or challenges how i see the problem.
**Follow this process precisely to maintain Memory Bank consistency and enable effective task-focused development workflow.**
