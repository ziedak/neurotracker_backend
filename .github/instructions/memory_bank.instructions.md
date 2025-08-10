---
applyTo: '**/*.ts'
description: 'A senior TypeScript developer assistant operating under strict mode, enforcing scalable, production-grade code with modern best practices.'
---

## 🧠 Memory Bank System - Task-Focused Navigation

### MANDATORY: Read Memory Bank Context First

1. 🎯 **Always start** by reading `.memory-bank/context/current-work.json` for active task context
2. 🏗️ **Check project architecture** from `.memory-bank/core/architecture.json` (460+ files, dual DI system)
3. 📍 **Navigate large codebase** using `.memory-bank/navigation/file-map-optimized.json`
4. 🏃 **Active task details** from current task directory in `.memory-bank/tasks/YYYY-MM-DD-task-name/`

### Smart Pattern Loading

**Core Patterns**: Always load `.memory-bank/core/patterns/*` for universal strategies
**Module Patterns**: Auto-load `.memory-bank/modules/{serviceName}/patterns/*` based on task file paths
**Rule**: Extract service name from file paths → load corresponding module patterns

### 🔍 CRITICAL: Architectural Verification Protocol - ENHANCED

**BEFORE creating or updating any patterns, MUST verify actual implementation:**

1. **Service Architecture Discovery**:
   - Read `src/core/ServiceRegistry.ts` to understand DI system
   - Verify actual dependency injection patterns (NOT assumptions)
   - Check for existing service infrastructure (PoolService, CacheService, etc.)
   - **EXAMPLE VERIFIED**: CacheService at `src/services/cache/cacheService.ts` with enterprise-grade features

2. **Infrastructure Assessment**:
   - Search for existing services: `**/*Pool*.ts`, `**/*Cache*.ts`, `**/*Service*.ts`
   - Read service interfaces and implementations
   - Understand actual patterns before creating new ones
   - **VERIFY**: Service registration patterns in `src/main.ts`

3. **Pattern Validation Requirements**:
   - Patterns MUST align with actual codebase architecture
   - Leverage existing infrastructure, don't duplicate
   - Validate against successful implementations
   - Document architectural compliance
   - **RECORD**: Infrastructure verification details in patterns

4. **Infrastructure Verification Checklist**:
   - [ ] Read actual service implementations (not just interfaces)
   - [ ] Verify service registration and dependency patterns
   - [ ] Check existing capabilities before creating new ones
   - [ ] Document verified infrastructure in pattern metadata
   - [ ] Test assumptions against actual codebase

**NEVER assume architecture - always verify first!**

**SUCCESS EXAMPLE**: CacheService verification (2025-07-29) revealed enterprise-grade infrastructure with LRU, TTL, cleanup intervals, and service registry integration - enabling observer strategy caching implementation.

### Continuous Improvement Protocol - ENHANCED

**After every task completion:**

1. Record discoveries in `.memory-bank/improvement/discovery-log.json`
2. Update patterns based on learnings and verified infrastructure
3. Enhance instructions/prompts with new architectural insights
4. Track pattern effectiveness and validation success
5. **NEW**: Document infrastructure verifications and their impact

**Reinforcement Learning**: Pattern quality improves through architectural validation and discovery recording.

### Task-Focused Workflow

- 📋 **Current Task**: Check `/context/current-work.json` for active work
- 📁 **Task Directory**: Navigate to specific task folder for detailed context
- 📊 **Progress Tracking**: Update living documents as work progresses
- 🎯 **Action Plans**: Follow structured phases in `action-plan.md`
- ✅ **Checklists**: Mark items complete in `checklist.md`
- 📈 **Metrics**: Update `progress.json` with completion status

### Project Context (Critical Knowledge) - VERIFIED 2025-07-29

- **Scale**: 460+ TypeScript files - enterprise-grade complexity
- **Architecture**: Custom ServiceRegistry DI system + tsyringe dual DI (verified in src/core/ServiceRegistry.ts)
- **Services**: Existing PoolService, CacheService infrastructure with enterprise features - leverage, don't duplicate
- **CacheService**: Verified enterprise-grade with LRU, TTL, cleanup intervals, BaseCache abstraction
- **Performance**: Sophisticated telemetry already built - enhance don't replace
- **Risk Level**: LOW-MEDIUM when building on existing systems
- **Verification Status**: Infrastructure analysis completed - ready for performance optimization

### Living Document Principles

- �� **Update immediately** when completing tasks
- �� **Track progress** in real-time using JSON metrics
- 🚫 **Document blockers** and solutions as they arise
- 📚 **Learn and improve** templates based on experience

### On "update memory bank" or new task:

1. Create new task directory: `tasks/YYYY-MM-DD-task-name/`
2. Copy templates from `/templates/` and customize
3. Update `/context/current-work.json` with new active task
4. Begin living document workflow

### Conservative Enhancement Approach

- ✅ **Build upon existing sophisticated infrastructure**
- ✅ **Leverage comprehensive telemetry systems already in place**
- ✅ **Enhance proven patterns rather than creating new complexity**
