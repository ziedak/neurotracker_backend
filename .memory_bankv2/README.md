# Memory Bank v2 - Generic Framework

## Design Principles

1. **AI Context Efficiency**: Reduce AI context window usage by 80%+ while maintaining comprehension accuracy
2. **Smart Loading**: Load only necessary data based on operation type and context budget
3. **Progressive Disclosure**: Start minimal, expand with @load: directives when needed
4. **Structured Data**: Use JSON for faster AI parsing vs verbose markdown
5. **Generic Framework**: Adaptable to any project type with customizable constitutional principles
6. **Template-Based**: Use generic templates that can be customized for specific projects## File Structure

```
.memory_bankv2/
├── config/
│   ├── ai-refs.json             # Ultra-compressed constants for AI (generic)
│   ├── context-budget.json      # AI context window management
│   ├── context-loader.json      # Smart loading strategies
│   ├── references.json          # Project-specific references (use template)
│   └── schemas.json             # Data schemas for validation
├── tasks/
│   └── {task-id}/
│       ├── task-summary.json    # Ultra-minimal status (~150 tokens)
│       ├── core.json            # Essential task data (~400 tokens)
│       ├── progress.json        # Progress tracking (~200 tokens)
│       ├── human.md             # Auto-generated human summary
│       └── context.json         # Additional context (load on-demand)
├── constitutional/              # Governance framework (project-specific)
│   ├── articles.json            # Project constitutional articles (use template)
│   ├── compliance.json          # Compliance patterns and rules
│   └── validation.json          # Validation gates and checkpoints
├── templates/                   # Generic reusable templates
│   ├── task-summary.template.json  # Minimal context template
│   ├── core.template.json       # Core task template
│   ├── patterns.json            # Template patterns
│   ├── task-patterns.json       # Pre-defined task patterns
│   ├── constitution.template.md # Generic constitutional framework
│   ├── references.template.json # Configuration template
│   └── articles.template.json   # Constitutional articles template
└── workflows/
    ├── gates.json               # Phase gate definitions
    └── automation.json          # Workflow automation rules
```

## AI Context Optimization Techniques

1. **Smart Loading Profiles**: Emergency (80 tokens), Quick (150), Standard (600), Deep (1200)
2. **Progressive Disclosure**: Start minimal, expand with @load: directives
3. **Ultra-Compressed References**: Numeric lookups via ai-refs.json
4. **Context Budget Management**: Adaptive loading based on available context window
5. **Layered Information**: task-summary.json → core.json → context.json
6. **AI-Optimized Parsing**: Structured JSON vs verbose markdown

## Getting Started

### 1. Project Setup

Use the templates to customize Memory Bank v2 for your specific project:

```bash
# Copy templates to active configuration
cp templates/constitution.template.md constitutional/constitution.md
cp templates/references.template.json config/references.json
cp templates/articles.template.json constitutional/articles.json
```

### 2. Customize Constitutional Framework

Edit `constitutional/articles.json` to define your project's governance:

- Set project-specific code standards
- Define compliance requirements
- Configure validation gates

### 3. Configure References

Update `config/references.json` with your project specifics:

- Technology stack
- Project phases
- Team structure

## Template System

The template system provides generic frameworks that can be customized for any project type:

- **constitution.template.md**: Comprehensive governance framework
- **references.template.json**: Project configuration template
- **articles.template.json**: Constitutional articles template

This approach ensures the system remains generic while being adaptable to specific project needs.

- **v1 system usage**: ~60-80% of context window (inefficient)
- **v2 system usage**: ~5-15% of context window (optimized)
- **Emergency mode**: <1% context usage for critical status
- **Context freed**: 70%+ more space for actual task execution

This AI-optimized format maintains all essential information while dramatically reducing context usage, enabling AI assistants to work more efficiently with larger context budgets available for implementation tasks.
