---
mode: 'agent'
tools:
  [
    'changes',
    'codebase',
    'editFiles',
    'extensions',
    'fetch',
    'findTestFiles',
    'githubRepo',
    'new',
    'openSimpleBrowser',
    'problems',
    'runCommands',
    'runNotebooks',
    'runTasks',
    'runTests',
    'search',
    'searchResults',
    'terminalLastCommand',
    'terminalSelection',
    'testFailure',
    'usages',
    'vscodeAPI',
  ]
description: 'Review , optimize the code and fix bugs.'
---

# Continue Active Memory Bank Task

## Summary

This document defines how GitHub Copilot should understand and continue active tasks using the task-focused Memory Bank system. It provides a systematic approach to resume work on existing tasks with full context.

---

## Core Principle

**Copilot MUST read comprehensive task context before continuing any work.**

### Mandatory Reading Sequence:

1. Read `.memory-bank/context/current-work.json` (identify active task)
2. Read active task directory: `.memory-bank/tasks/YYYY-MM-DD-task-name/`
3. Read all files in task directory for complete context
4. Understand current progress and next steps
5. Continue implementation with full awareness

---

## Step-by-Step Continue Process

### 1. Identify Active Task

**Read**: `.memory-bank/context/current-work.json`

Extract:

- Current task name and directory
- Task status and completion percentage
- Major accomplishments to date
- Next immediate actions
- Priority and timeline

### 2. Load Complete Task Context

**Read Task Directory**: `.memory-bank/tasks/YYYY-MM-DD-task-name/`

**Required Files**:

- `action-plan.md` - Overall objectives and phases
- `checklist.md` - Detailed actionable items with completion status
- `progress.json` - Real-time progress metrics and milestones
- `implementation-summary.md` - What has been built (if exists)
- Any task-specific context files

### 3. Understand Implementation State

**Analyze What's Been Built**:

- Read completed checklist items
- Review progress percentages by phase
- Identify which milestones are complete
- Understand what code/files have been created
- Note any blockers or challenges

**Assess Current Code State**:

- Check if files mentioned in progress actually exist
- Verify implementation matches documented progress
- Identify any gaps between documentation and reality

### 4. Determine Next Steps

**From Task Documentation**:

- Review unchecked items in checklist.md
- Identify current phase and next phase objectives
- Check for any noted blockers or dependencies
- Review success criteria and validation requirements

**From Progress Tracking**:

- Identify next milestone targets
- Check time estimates vs. actual time spent
- Review any updated priorities or scope changes

---

## Context Loading Template

### When User Says: "continue task" or "what's next"

**Execute This Sequence**:

```typescript
// 1. Load active task context
const currentWork = await readFile('.memory-bank/context/current-work.json');
const activeTask = currentWork.active_tasks.current_task;

// 2. Load task directory
const taskDir = `.memory-bank/tasks/${activeTask.directory}`;
const actionPlan = await readFile(`${taskDir}/action-plan.md`);
const checklist = await readFile(`${taskDir}/checklist.md`);
const progress = await readFile(`${taskDir}/progress.json`);

// 3. Check for implementation summary
const implementationSummary = await readFile(`${taskDir}/implementation-summary.md`);

// 4. Analyze progress state and continue work
```

### Context Summary Template

After reading all task files, provide:

```markdown
## Current Task: [Task Name]

**Status**: [status] ([completion]% complete)
**Phase**: [current phase]
**Priority**: [priority]

### What's Been Built

- [List major accomplishments from progress]
- [Note any code files created]
- [Highlight completed milestones]

### Current State

- **Last Completed**: [most recent checklist item]
- **Current Phase Progress**: [phase completion %]
- **Time Spent**: [actual vs estimated]
- **Blockers**: [any current blockers]

### Next Steps

1. [Next unchecked checklist item]
2. [Following priority items]
3. [Next milestone target]

### Files to Work On

- [Specific files that need creation/modification]
- [Dependencies that need to be addressed]
```

---

## Task Continuation Strategies

### High-Completion Tasks (>60%)

**Focus On**:

- Completing current phase
- Validation and testing
- Documentation updates
- Deployment preparation

**Common Next Steps**:

- Execute testing frameworks
- Validate integration points
- Complete rollout procedures
- Document final results

### Mid-Progress Tasks (20-60%)

**Focus On**:

- Core implementation work
- Meeting phase objectives
- Addressing technical dependencies
- Regular progress updates

**Common Next Steps**:

- Build remaining core components
- Integrate with existing systems
- Create testing infrastructure
- Update progress documentation

### Early-Stage Tasks (<20%)

**Focus On**:

- Foundational setup
- Research and planning validation
- Initial implementation
- Establishing patterns

**Common Next Steps**:

- Complete baseline analysis
- Create initial components
- Set up testing frameworks
- Validate approach with stakeholders

---

## Conservative Enhancement Context

### For This Enterprise Project (460+ Files):

**Always Remember**:

- Sophisticated telemetry infrastructure exists
- Dual DI architecture (ServiceRegistry + tsyringe)
- Conservative enhancement approach preferred
- Risk Level: LOW-MEDIUM when building on existing systems

**Task Continuation Principles**:

- Build upon existing proven patterns
- Enhance rather than replace sophisticated systems
- Use comprehensive telemetry for validation
- Maintain backward compatibility
- Test incrementally with existing infrastructure

---

## Progress Synchronization

### After Continuing Work:

**Update Progress in Real-Time**:

- Check off completed items in `checklist.md`
- Update percentages in `progress.json`
- Add accomplishments to implementation summary
- Note any new blockers or discoveries
- Update time tracking

**Sync with Memory Bank**:

- Update `current-work.json` if major progress made
- Document significant discoveries or changes
- Record discoveries in `.memory-bank/improvement/discovery-log.json`
- Update navigation map in `.memory-bank/navigation`
- Update next immediate actions if priorities change
- Update patterns based on learnings and verified infrastructure in `.memory-bank/patterns/`
- Enhance instructions/prompts with new architectural insights in `.github/prompts/`
- Track pattern effectiveness and validation success
- **NEW**: Document infrastructure verifications and their impact

---

## Common Task Types & Continuation Patterns

### Performance Optimization Tasks

- **Focus**: Baseline measurement → Implementation → Validation → Rollout
- **Key Files**: Telemetry integration, feature flags, testing frameworks
- **Validation**: Performance metrics, rollback procedures, gradual deployment

### Feature Implementation Tasks

- **Focus**: Requirements → Core development → Integration → Testing
- **Key Files**: Service implementations, integration points, test suites
- **Validation**: Functionality, compatibility, performance impact

### Refactoring Tasks

- **Focus**: Analysis → Planning → Safe migration → Validation
- **Key Files**: Migration scripts, compatibility layers, test coverage
- **Validation**: No breaking changes, performance maintained, full test coverage

### Research Tasks

- **Focus**: Investigation → Documentation → Proof of concept → Recommendations
- **Key Files**: Research notes, prototypes, comparison documents
- **Validation**: Comprehensive analysis, actionable recommendations, stakeholder buy-in

---

## Error Handling

### If Task Context Is Incomplete:

1. **Missing Files**: Note which required files are missing and create them
2. **Outdated Progress**: Update progress.json to match actual implementation state
3. **Unclear Next Steps**: Review action-plan.md and ask for clarification
4. **Code-Documentation Mismatch**: Audit actual codebase vs. documented progress

### If Multiple Active Tasks:

1. **Prioritize**: Focus on highest priority task from current-work.json
2. **Clarify**: Ask user which task to continue if priorities are unclear
3. **Context Switch**: Provide full context summary when switching between tasks

---

## Command Usage

### Continue Current Task:

```
"continue task"
"what's next"
"resume current work"
```

### Continue Specific Task:

```
"continue task: [task-name]"
"resume: [task-name]"
```

### Get Task Status:

```
"task status"
"current progress"
"what have we built"
```

---

## Integration with Living Documents

### Real-Time Updates Required:

- Update progress.json with completion percentages
- Check off items in checklist.md as completed
- Document blockers and solutions immediately
- Track time spent vs. estimates
- Update implementation summaries with new accomplishments

### Session Handoff:

- Provide clear summary of what was accomplished
- Update next immediate actions in current-work.json
- Document any changes in approach or priorities
- Note any new dependencies or blockers discovered

---

**Use this process to ensure seamless task continuation with full context awareness and maintain the living document workflow integrity.**

```

```
