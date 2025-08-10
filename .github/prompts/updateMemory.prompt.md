# Memory Bank Update & Task Management

## Core Principle

**Copilot MUST read Memory Bank context at the start of EVERY task.**

### Mandatory Reading Checklist:

- [ ] Read `.memory-bank/context/current-work.json` (active task context)
- [ ] Read `.memory-bank/core/architecture.json` (project architecture)
- [ ] Read current task directory: `.memory-bank/tasks/YYYY-MM-DD-task-name/`
- [ ] Read `.memory-bank/navigation/file-map-optimized.json` (for large codebase navigation)
- [ ] Read `.memory-bank/modules/services-optimized.json` (service architecture)

### Smart Pattern Loading:

**Core Patterns**: Always load `.memory-bank/core/patterns/*`
**Module Patterns**: Auto-load based on task file paths → `.memory-bank/modules/{serviceName}/patterns/*`

### 🔍 Pattern Validation Protocol:

**BEFORE extracting or updating patterns:**

1. **Architectural Verification**: Read actual service implementations (ServiceRegistry.ts, etc.)
2. **Infrastructure Discovery**: Check existing services (PoolService, CacheService, etc.)
3. **Implementation Validation**: Verify patterns against actual codebase, not assumptions
4. **Effectiveness Tracking**: Record pattern success/failure rates

### 🔄 Continuous Improvement Protocol:

**After every task completion:**

1. Record discoveries in `.memory-bank/improvement/discovery-log.json`
2. Update patterns based on learnings in `.memory-bank/improvement/reinforcement-actions.json`
3. Enhance instruction/prompt files with architectural insights
4. Evolve Two-Tier Pattern Architecture based on real-world validation

---

## Task Management Commands

### Update Memory Bank

**Command**: "update memory bank"
**Actions**:

- Review active tasks in `/tasks/` directories
- Update progress metrics and `current-work.json`
- Update core knowledge if architectural discoveries
- Extract universal patterns → Core patterns
- Document module-specific patterns
- Archive completed tasks

### Create New Task

**Command**: "create new task: [task-name]"
**Actions**:

- Create `tasks/YYYY-MM-DD-task-name/` directory
- Copy templates and customize
- Update `current-work.json` with new active task

### Continue Active Task

**Command**: "continue active task"
**Actions**:

- Read current active task from `current-work.json`
- Load task context and continue work

---

## Critical Project Context

- **Scale**: 460+ TypeScript files - enterprise-grade complexity
- **Architecture**: Custom ServiceRegistry DI system (verified) - NOT tsyringe
- **Services**: Existing PoolService, CacheService - leverage existing infrastructure
- **Performance**: Sophisticated telemetry already built - enhance don't replace
- **Risk Level**: LOW-MEDIUM when building on existing systems

## Reinforcement Learning Integration

### Discovery Recording

**During task execution**: Record architectural discoveries, pattern effectiveness, and corrections needed

### Pattern Evolution

**Post-task analysis**: Update patterns based on real-world validation and implementation discoveries

### Instruction Enhancement

**Continuous improvement**: Update instruction/prompt files with architectural insights and validation protocols

## Conservative Enhancement Philosophy

- ✅ **Build upon existing sophisticated infrastructure**
- ✅ **Leverage comprehensive telemetry systems already in place**
- ✅ **Enhance proven patterns rather than creating new complexity**
