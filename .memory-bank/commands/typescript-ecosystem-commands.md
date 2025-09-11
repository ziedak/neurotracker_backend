# Custom Commands for TypeScript Ecosystem

## Command Infrastructure Design

### Overview

This document defines custom commands specifically designed for the TypeScript microservices ecosystem, integrating constitutional compliance, phase-gate validation, and workflow automation.

### Command Categories

#### 1. Constitutional Validation Commands

##### `mb:validate-constitution`

```yaml
command: mb:validate-constitution
description: "Validate constitutional compliance across the codebase"
parameters:
  - scope: "service" | "feature" | "all"
  - article: "specific article" | "all"
  - output-format: "json" | "markdown" | "summary"

execution_flow:
  1. Load constitutional framework
  2. Analyze target scope for compliance
  3. Generate validation report
  4. Identify violations and recommendations
  5. Output results in specified format

example_usage:
  - "mb:validate-constitution --scope=service --article=dependency-injection"
  - "mb:validate-constitution --scope=all --output-format=json"
```

##### `mb:audit-architecture`

```yaml
command: mb:audit-architecture
description: "Comprehensive architectural audit against Nine Articles"
parameters:
  - target: "service-name" | "all-services"
  - depth: "surface" | "deep" | "comprehensive"
  - report-format: "dashboard" | "detailed" | "executive"

execution_flow:
  1. Gather architectural artifacts
  2. Perform article-by-article analysis
  3. Identify architectural drift patterns
  4. Generate risk assessment
  5. Provide remediation recommendations

example_usage:
  - "mb:audit-architecture --target=auth-service --depth=comprehensive"
  - "mb:audit-architecture --target=all-services --report-format=dashboard"
```

#### 2. Task Management Commands

##### `mb:create-task`

```yaml
command: mb:create-task
description: "Create new task with constitutional compliance workflow"
parameters:
  - name: "task-name"
  - type: "feature" | "bugfix" | "enhancement" | "architectural"
  - priority: "low" | "medium" | "high" | "critical"
  - template: "feature" | "implementation" | "custom"

execution_flow:
  1. Initialize task structure
  2. Run constitutional pre-checks
  3. Generate appropriate templates
  4. Set up phase-gate workflow
  5. Create progress tracking
  6. Initialize constitutional compliance matrix

example_usage:
  - "mb:create-task --name=user-authentication --type=feature --priority=high"
  - "mb:create-task --name=cache-optimization --type=enhancement --template=implementation"
```

##### `mb:validate-task`

```yaml
command: mb:validate-task
description: "Validate task against current phase-gate requirements"
parameters:
  - task-id: "task identifier"
  - phase: "current" | "next" | "all"
  - fix-mode: "suggest" | "auto-fix" | "interactive"

execution_flow:
  1. Load task configuration
  2. Validate current phase requirements
  3. Check constitutional compliance
  4. Identify gate failures
  5. Provide remediation options

example_usage:
  - "mb:validate-task --task-id=user-auth-2025-09-09 --phase=current"
  - "mb:validate-task --task-id=user-auth-2025-09-09 --fix-mode=interactive"
```

#### 3. Quality Assurance Commands

##### `mb:run-quality-gates`

```yaml
command: mb:run-quality-gates
description: "Execute quality gates for current development phase"
parameters:
  - scope: "current-task" | "service" | "all"
  - gate-type: "constitutional" | "quality" | "security" | "all"
  - mode: "validate" | "enforce" | "report"

execution_flow:
  1. Identify applicable quality gates
  2. Execute gate validation logic
  3. Collect validation results
  4. Generate compliance report
  5. Enforce gate decisions (if enforce mode)

example_usage:
  - "mb:run-quality-gates --scope=current-task --gate-type=constitutional"
  - "mb:run-quality-gates --scope=service --mode=enforce"
```

##### `mb:check-uncertainty`

```yaml
command: mb:check-uncertainty
description: "Identify and manage uncertainty markers in documentation"
parameters:
  - scope: "task" | "service" | "documentation" | "all"
  - action: "identify" | "resolve" | "escalate"
  - urgency: "low" | "medium" | "high"

execution_flow:
  1. Scan for uncertainty markers
  2. Classify uncertainty types and impact
  3. Assign resolution priorities
  4. Generate resolution workflow
  5. Track uncertainty resolution progress

example_usage:
  - "mb:check-uncertainty --scope=task --action=identify"
  - "mb:check-uncertainty --scope=all --action=escalate --urgency=high"
```

#### 4. Infrastructure Commands

##### `mb:setup-service`

```yaml
command: mb:setup-service
description: "Set up new microservice with constitutional compliance"
parameters:
  - name: "service-name"
  - type: "api" | "worker" | "gateway" | "integration"
  - template: "minimal" | "standard" | "comprehensive"
  - articles: "article list to implement"

execution_flow:
  1. Generate service structure
  2. Configure constitutional compliance
  3. Set up dependency injection
  4. Initialize service registry integration
  5. Configure monitoring and telemetry
  6. Create constitutional validation tests

example_usage:
  - "mb:setup-service --name=payment-service --type=api --template=standard"
  - "mb:setup-service --name=notification-worker --type=worker --articles=i,ii,v,ix"
```

##### `mb:verify-integration`

```yaml
command: mb:verify-integration
description: "Verify service integration constitutional compliance"
parameters:
  - source: "source-service"
  - target: "target-service"
  - integration-type: "sync" | "async" | "event-driven"
  - depth: "surface" | "deep"

execution_flow:
  1. Analyze integration contracts
  2. Verify constitutional compliance
  3. Check service registry usage
  4. Validate error handling patterns
  5. Verify monitoring integration
  6. Generate integration report

example_usage:
  - "mb:verify-integration --source=user-service --target=auth-service --type=sync"
  - "mb:verify-integration --source=order-service --target=inventory-service --depth=deep"
```

### Command Implementation Architecture

#### Command Registry System

```typescript
interface CommandRegistry {
  registerCommand(command: Command): void;
  executeCommand(
    commandName: string,
    args: CommandArgs
  ): Promise<CommandResult>;
  listCommands(category?: string): Command[];
  getCommandHelp(commandName: string): CommandHelp;
}

interface Command {
  name: string;
  category: string;
  description: string;
  parameters: Parameter[];
  executor: CommandExecutor;
  validator: CommandValidator;
}

interface CommandExecutor {
  execute(args: CommandArgs, context: ExecutionContext): Promise<CommandResult>;
}
```

#### Constitutional Integration

```typescript
interface ConstitutionalCommandMixin {
  validateConstitutionalCompliance(
    context: ValidationContext
  ): ComplianceResult;
  enforceConstitutionalRequirements(
    requirements: ConstitutionalRequirement[]
  ): void;
  generateConstitutionalReport(scope: ValidationScope): ConstitutionalReport;
}
```

#### Phase-Gate Integration

```typescript
interface PhaseGateCommandMixin {
  validatePhaseGate(
    phase: string,
    criteria: GateCriteria[]
  ): GateValidationResult;
  advancePhase(currentPhase: string, nextPhase: string): PhaseTransitionResult;
  enforceGateRequirements(gate: PhaseGate): GateEnforcementResult;
}
```

### Automation Integration

#### CI/CD Pipeline Integration

```yaml
pipeline_commands:
  pre_commit:
    - mb:validate-constitution --scope=changed-files
    - mb:check-uncertainty --scope=task --action=identify

  pull_request:
    - mb:audit-architecture --target=affected-services
    - mb:run-quality-gates --scope=service --mode=enforce

  deployment:
    - mb:verify-integration --source=all --target=all
    - mb:validate-task --task-id=current --phase=deployment
```

#### Development Workflow Integration

```yaml
development_workflow:
  task_creation:
    - mb:create-task [parameters]
    - mb:validate-constitution --scope=task

  implementation:
    - mb:run-quality-gates --scope=current-task
    - mb:check-uncertainty --action=resolve

  completion:
    - mb:validate-task --phase=all
    - mb:audit-architecture --target=affected-services
```

### Command Extensions

#### Plugin Architecture

```typescript
interface CommandPlugin {
  name: string;
  version: string;
  commands: Command[];
  dependencies: string[];
  initialize(registry: CommandRegistry): void;
  cleanup(): void;
}

interface PluginManager {
  loadPlugin(plugin: CommandPlugin): void;
  unloadPlugin(pluginName: string): void;
  listPlugins(): PluginInfo[];
  updatePlugin(pluginName: string, version: string): void;
}
```

#### Custom Command Development

```yaml
custom_command_template:
  structure:
    - command definition (YAML)
    - executor implementation (TypeScript)
    - validator implementation (TypeScript)
    - documentation (Markdown)
    - tests (Jest)

  constitutional_integration:
    - compliance validation hooks
    - constitutional reporting
    - article-specific validation

  quality_requirements:
    - comprehensive test coverage
    - constitutional compliance
    - documentation completeness
    - error handling robustness
```

This command infrastructure provides comprehensive tooling for TypeScript ecosystem development while maintaining constitutional compliance and architectural integrity.
