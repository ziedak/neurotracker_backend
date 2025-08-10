# Continue Task Quick Reference

## Fast Task Continuation Commands

### 🚀 Quick Start

```bash
# User says: "continue task" or "what's next"

# 1. Read active task
.memory-bank/context/current-work.json

# 2. Load task directory
.memory-bank/tasks/YYYY-MM-DD-task-name/
├── action-plan.md          # Phases & objectives
├── checklist.md            # Detailed items
├── progress.json           # Real-time progress
└── implementation-summary.md # What's built
```

### 📊 Context Loading Checklist

- [ ] Active task name and status
- [ ] Completion percentage and current phase
- [ ] What's been built (files, components)
- [ ] Next unchecked checklist items
- [ ] Current blockers or dependencies
- [ ] Next milestone targets

### 🎯 Response Template

```markdown
## Current Task: [name] ([%] complete)

### Built So Far:

- [major accomplishments]

### Next Steps:

1. [immediate next action]
2. [following priority]
3. [milestone target]

### Ready to Continue:

[specific work to do next]
```

### ⚠️ For Enterprise Project (460+ files):

- Build on existing sophisticated telemetry
- Conservative enhancement approach
- Use proven patterns, don't replace systems
- Risk Level: LOW-MEDIUM when enhancing existing

### 🔄 Update After Work:

- [ ] Check off completed items in checklist.md
- [ ] Update percentages in progress.json
- [ ] Add to implementation-summary.md
- [ ] Sync current-work.json if major progress
