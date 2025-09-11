# Memory Bank v2 Templates

This directory contains **generic template files** for creating tasks in the compressed Memory Bank v2 format.

## Template Files

- `task-summary.template.json` - Ultra-minimal status template (~150 tokens)
- `core.template.json` - Core task data structure template
- `progress.template.json` - Progress tracking template
- `context.template.json` - Context information template
- `human.template.md` - Human-readable summary template
- `task-patterns.json` - Pre-defined task patterns
- `patterns.json` - Pattern configuration and compression rules

## Template Usage

**These are GENERIC templates with placeholder values:**

- `{task-id}` - Replace with actual task identifier
- `{status-code}` - Replace with numeric status (0-4)
- `{percentage}` - Replace with actual progress percentage
- `{next-action}` - Replace with specific next action description
- `{risk-level}` - Replace with risk level (0-3)
- `{article-ids}` - Replace with constitutional article array
- `{phase-type}` - Replace with phase identifier
- `{file1}`, `{file2}` - Replace with actual file paths

## Example Usage

1. Copy template file
2. Replace ALL placeholder values with actual data
3. Use pattern from `task-patterns.json` for common scenarios
4. Reference `patterns.json` for compression rules
5. Generate human-readable summary using `human.template.md`

## Generic Task Example

See `/tasks/TEMPLATE-example-task/` for complete generic example with all placeholder values.

## Compression Features

- 90% size reduction vs Memory Bank v1
- AI context-optimized loading (150-1200 tokens)
- Reference-based deduplication
- Constitutional compliance integration
- Progressive disclosure with @load: directives

**Note**: Auth-specific examples in documentation are only for illustration - all templates are designed to be generic and reusable for any task type.
