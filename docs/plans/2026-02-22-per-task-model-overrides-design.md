# Design: Per-Task Model Overrides

**Date:** 2026-02-22
**Status:** Approved
**Evolved from:** `FEATURE-per-label-model-overrides.md` (original feature request)

## Problem

Ralph-tui applies a single model to all tasks in a session. Not all tasks are equal: implementation tasks work well with faster/cheaper models (Sonnet), but review and audit tasks benefit from stronger reasoning (Opus). The only workaround is running separate sessions with different `--model` flags, which breaks autonomous multi-phase execution.

## Design Decision

The original feature request proposed a `modelOverrides` config mapping labels to models in ralph-tui's config. During intake, we decided instead to put the model on the **task itself** — the task author knows what model their task needs, and this doesn't belong in ralph-tui config.

## Architecture

### Core: TrackerTask.model field

Add an optional `model` field to `TrackerTask`:

```typescript
export interface TrackerTask {
  // ... existing fields ...
  model?: string;  // Optional per-task model override
}
```

### Engine: Model Resolution

New method on the Engine class resolves the model per-task with this precedence:

1. **Task-level model** (highest priority) — from `task.model`
2. **CLI `--model`** — from `RalphConfig.model`
3. **Agent config default** — from `agentOptions.model` / agent `buildArgs()`

```typescript
private resolveModelForTask(task: TrackerTask): { model: string | undefined; source: string } {
  // 1. Task-level model (highest priority)
  if (task.model) {
    const validationError = this.agent!.validateModel(task.model);
    if (validationError) {
      // Warn and fall back — don't fail the task
      this.logger.warn(
        `Task "${task.title}" requests model "${task.model}" but it's invalid: ${validationError}. Falling back.`
      );
    } else {
      return { model: task.model, source: 'task' };
    }
  }
  // 2. CLI --model
  if (this.config.model) {
    return { model: this.config.model, source: 'cli' };
  }
  // 3. No override — agent uses its own default via buildArgs()
  return { model: undefined, source: 'agent-default' };
}
```

Flag injection at `engine/index.ts:964` becomes:

```typescript
const { model: resolvedModel, source: modelSource } = this.resolveModelForTask(task);
if (resolvedModel) {
  flags.push('--model', resolvedModel);
}
this.logger.info(`Task "${task.title}" using model: ${resolvedModel ?? 'agent default'} (source: ${modelSource})`);
```

### Flag Ordering Fix

**Bug:** In `base.ts:522`, the argument order is `[...defaultFlags, ...flags, ...buildArgs()]`. Since `buildArgs()` comes last, the agent's internal `--model` (from `buildArgs()`) silently overrides the engine's `--model` (from `flags`). Last flag wins for most CLIs.

**Fix:** Change to `[...defaultFlags, ...buildArgs(), ...flags]` so engine-injected flags always win. The engine is the orchestrator — its overrides must take precedence.

This is a correctness fix that affects all engine-injected flags, not just model. It's the right semantic regardless of this feature.

## Tracker Plugin Changes

Each built-in tracker passes through the `model` field from its native format.

### JSON tracker
PRD JSON user stories get an optional `model` field in the schema. The mapper passes it through:
```typescript
model: story.model,
```

### beads-rust tracker
Read from bead metadata:
```typescript
model: typeof task.metadata?.model === 'string' ? task.metadata.model : undefined,
```

### beads tracker
Read from bead metadata:
```typescript
model: typeof bead.metadata?.model === 'string' ? bead.metadata.model : undefined,
```

### beads-bv tracker
Read from record metadata:
```typescript
model: typeof rec.metadata?.model === 'string' ? rec.metadata.model : undefined,
```

All changes are additive and backward-compatible.

## PRD Generator Updates

The PRD generator (`src/prd/`) is updated to support specifying model per user story.

- **Schema:** `UserStory` type gains optional `model?: string`
- **Wizard:** After story creation, optionally ask "Specify model overrides for any stories?" (default: no). If yes, let user pick stories and assign model names.
- **Output:** Include `model` in generated JSON for stories that have one.

Example output:
```json
{
  "stories": [
    { "title": "Implement login form", "labels": ["phase:impl"] },
    { "title": "Review auth flow", "labels": ["phase:review"], "model": "opus" }
  ]
}
```

## TUI and Log Observability

### TUI display
Show the resolved model next to each task when it differs from the session default. Add `model?: string` to `TaskItem` in `src/tui/types.ts`.

### Structured logs
Log the resolved model and its source (task, cli, config, agent-default) when each task starts. This aids debugging of model selection.

## Validation Behavior

When a task specifies a model that's invalid for the active agent plugin:
- **Warn** with a descriptive message (task title, requested model, validation error)
- **Fall back** to the next precedence level (CLI model, then agent default)
- **Do not fail** the task — the task still runs with a valid model

## Scope

| Component | Change |
|-----------|--------|
| `TrackerTask` type | Add optional `model` field |
| Engine `runIteration` | Add `resolveModelForTask()`, update flag injection |
| `base.ts` agent execution | Fix flag ordering (`buildArgs` before `flags`) |
| JSON tracker plugin | Pass through `model` from PRD JSON |
| beads tracker plugin | Read `model` from bead metadata |
| beads-rust tracker plugin | Read `model` from bead metadata |
| beads-bv tracker plugin | Read `model` from record metadata |
| PRD generator types | Add `model` to UserStory |
| PRD wizard | Optional model-per-story step |
| PRD JSON output | Include `model` field |
| TUI types | Add `model` to TaskItem |
| TUI display | Show per-task model when different from default |
| Structured logs | Log model source with each task |

## Out of Scope

- Config-level `modelOverrides` mapping (original feature doc approach — replaced by task-level model)
- Model switching mid-task (model is fixed for the duration of a task)
- Agent plugin changes (plugins don't need to know about per-task models — the engine handles it via flags)
