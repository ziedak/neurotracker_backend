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
description: 'Review ,Analyse the code and think about improvements.'
---

## Summary

## This document defines how to analyze and improve the codebase for the Neuro Tracker system,

## Core Process

### 1. Quick Code Analysis Flow:

1. **Read Current Context**
   - Read `.memory-bank/context/current-work.json`
   - Check active tasks to avoid conflicts
   - Read `.memory-bank/core/patterns` for architectural patterns
   - Read `.memory-bank/modules/{area of concern}` for coding standards

2. **Analyze Code**
   - Identify areas for improvement
   - Look for code smells, performance issues, and potential refactoring opportunities

3. **Identify Areas for Improvement**
   - Look for code smells, performance issues, and potential refactoring opportunities

### 2. Thinking Process

- **Dual Role**: act as both a code reviewer and a developer
- **Critical Thinking**: Analyze and critic your own thoughts and suggestions - **Pragmatic**: identify potential biases and assumptions
- **Iterative Improvement**: Continuously refine your analysis and suggestions

**Follow this process precisely don't update the code, you are a reviewer and a developer.**
