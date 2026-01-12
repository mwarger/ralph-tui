# PRD: Subagent Tracing

## Introduction

Add visibility into subagent execution within ralph-tui. When Claude Code (or other agents) spawn subagents via the Task tool, ralph-tui currently treats the agent as a black box with no insight into internal operations. This feature enables observability into subagent activity, helping users understand what the agent is doing and debug issues when subagents fail.

Currently, ralph-tui captures raw stdout/stderr and streams it to the TUI. With subagent tracing, we'll parse structured output from agents that support it, detect subagent lifecycle events, and display a hierarchical view of agent activity.

## Goals

- Provide real-time visibility into subagent spawning, execution, and completion
- Enable debugging by surfacing subagent failures and their context
- Display subagent hierarchy in both a dedicated panel and collapsible output sections
- Persist full subagent trace data to iteration logs for post-hoc analysis
- Support configurable detail levels (minimal to full)
- Use plugin-based architecture so each agent declares its tracing capabilities

## User Stories

### US-001: Agent plugin declares tracing capabilities
**Description:** As a plugin developer, I want to declare whether my agent supports structured output so ralph-tui knows when subagent tracing is available.

**Acceptance Criteria:**
- [ ] Add `supportsSubagentTracing: boolean` to `AgentPluginMeta` interface
- [ ] Add optional `structuredOutputFormat?: 'json' | 'jsonl'` to meta
- [ ] Claude plugin declares `supportsSubagentTracing: true`
- [ ] OpenCode plugin declares `supportsSubagentTracing: false` (initially)
- [ ] npm run typecheck passes

### US-002: Enable JSON output mode for Claude agent
**Description:** As a user, I want ralph-tui to automatically use Claude Code's `--output-format json` when subagent tracing is enabled so structured events are captured.

**Acceptance Criteria:**
- [ ] Add `--output-format json` to Claude agent's buildArgs() when tracing enabled
- [ ] Parse JSONL output stream instead of raw text
- [ ] Fall back gracefully if JSON parsing fails (show raw output)
- [ ] Add `subagentTracing: boolean` to agent execute options
- [ ] npm run typecheck passes

### US-003: Parse subagent lifecycle events
**Description:** As a developer, I need to parse Claude Code's JSON output to detect when subagents are spawned, running, and completed.

**Acceptance Criteria:**
- [ ] Create `SubagentEvent` type with: id, type (spawn|progress|complete|error), timestamp, agentType, description, parentId
- [ ] Create `SubagentTraceParser` class that processes JSONL stream
- [ ] Detect Task tool invocations as subagent spawn events
- [ ] Track subagent completion with exit status and duration
- [ ] Build parent-child hierarchy from nested Task calls
- [ ] Emit events via callback for real-time updates
- [ ] npm run typecheck passes

### US-004: Add subagent state tracking to engine
**Description:** As the engine, I need to maintain state about active and completed subagents during an iteration.

**Acceptance Criteria:**
- [ ] Create `SubagentState` interface: id, type, description, status, startedAt, completedAt, parentId, children[]
- [ ] Add `subagents: Map<string, SubagentState>` to iteration state
- [ ] Update state as parser emits events
- [ ] Calculate duration and nesting depth
- [ ] Expose `getSubagentTree()` method for TUI
- [ ] npm run typecheck passes

### US-005: Create SubagentTreePanel TUI component
**Description:** As a user, I want to see a dedicated panel showing the subagent hierarchy so I can understand what the agent is working on.

**Acceptance Criteria:**
- [ ] Create `SubagentTreePanel` component showing tree structure
- [ ] Display: agent type, description (truncated), status icon, duration
- [ ] Status icons: spinner (running), checkmark (complete), X (failed)
- [ ] Indent nested subagents to show hierarchy
- [ ] Highlight currently active subagent
- [ ] Auto-scroll to show newest activity
- [ ] npm run typecheck passes
- [ ] Verify in browser/TUI manually

### US-006: Add collapsible subagent sections in output panel
**Description:** As a user, I want subagent activity shown inline in the output with collapsible sections so I can see context without switching panels.

**Acceptance Criteria:**
- [ ] Insert subagent start marker in output: `[Subagent: type] description`
- [ ] Insert subagent end marker with status and duration
- [ ] Make sections collapsible (toggle with Enter key when focused)
- [ ] Collapsed sections show one-line summary
- [ ] Expanded sections show full subagent output
- [ ] Visually distinguish subagent output (different color/indent)
- [ ] npm run typecheck passes
- [ ] Verify in TUI manually

### US-007: Add detail level configuration
**Description:** As a user, I want to configure how much subagent detail is shown so I can balance information vs noise.

**Acceptance Criteria:**
- [ ] Add `subagentTracing.detailLevel` to config: 'off' | 'minimal' | 'moderate' | 'full'
- [ ] 'off': No tracing, use raw output (current behavior)
- [ ] 'minimal': Show start/complete events only
- [ ] 'moderate': Show events + description + duration
- [ ] 'full': Show events + nested output + hierarchy panel
- [ ] Add keyboard shortcut to cycle detail levels (e.g., 't')
- [ ] Persist preference to config file
- [ ] npm run typecheck passes

### US-008: Toggle subagent panel visibility
**Description:** As a user, I want to show/hide the subagent panel to maximize space for output when needed.

**Acceptance Criteria:**
- [ ] Add keyboard shortcut 'T' (shift+t) to toggle subagent panel
- [ ] Panel shows on right side, resizable
- [ ] Remember panel state in session
- [ ] When hidden, still track subagents (just don't display panel)
- [ ] Update help overlay to show new shortcuts
- [ ] npm run typecheck passes

### US-009: Persist subagent trace to iteration logs
**Description:** As a user, I want subagent trace data saved to iteration logs so I can analyze agent behavior after the fact.

**Acceptance Criteria:**
- [ ] Add `subagentTrace` section to iteration log format
- [ ] Include: full event timeline, hierarchy tree, aggregate stats
- [ ] Stats: total subagents, by type, total duration, failure count
- [ ] Maintain backward compatibility (logs without trace still readable)
- [ ] Update `loadIterationLog()` to parse trace section
- [ ] npm run typecheck passes

### US-010: Display subagent summary in iteration history
**Description:** As a user viewing past iterations, I want to see a summary of subagent activity so I understand what happened.

**Acceptance Criteria:**
- [ ] Show subagent count in iteration list: "5 subagents"
- [ ] Show failure indicator if any subagent failed
- [ ] In detail view, show expandable subagent tree
- [ ] Load trace data lazily (only when viewing details)
- [ ] npm run typecheck passes

## Functional Requirements

- FR-1: Agent plugins must declare `supportsSubagentTracing` capability in meta
- FR-2: When tracing enabled, Claude agent must use `--output-format json`
- FR-3: System must parse JSONL stream and extract subagent lifecycle events
- FR-4: System must build and maintain subagent hierarchy during execution
- FR-5: TUI must display subagent tree in dedicated panel (toggleable)
- FR-6: TUI must show collapsible subagent sections inline in output
- FR-7: User must be able to configure detail level (off/minimal/moderate/full)
- FR-8: Iteration logs must persist full subagent trace data
- FR-9: System must gracefully degrade when agent doesn't support tracing
- FR-10: Subagent panel must be toggleable via keyboard shortcut

## Non-Goals

- No modification of Claude Code or other agents (use existing capabilities)
- No filtering/searching within subagent traces (future enhancement)
- No subagent-level retry or intervention (out of scope)
- No real-time metrics/graphs of subagent performance
- No support for non-Task subagents (e.g., MCP tools) in v1

## Technical Considerations

### Claude Code JSON Output Format
Claude Code's `--output-format json` emits JSONL with events like:
```json
{"type": "tool_use", "tool": "Task", "input": {...}, "id": "..."}
{"type": "tool_result", "tool_use_id": "...", "output": "..."}
```

The parser needs to:
- Handle streaming JSONL (partial lines, buffering)
- Match tool_use to tool_result by ID
- Detect Task tool specifically for subagent tracking
- Extract subagent type and description from Task input

### State Management
Subagent state should be:
- Stored in engine iteration state
- Emitted via events for TUI updates
- Serialized to logs after iteration completes

### Performance
- Parse JSON incrementally (don't buffer entire output)
- Limit tree depth display to prevent UI issues with deep nesting
- Lazy load trace data when viewing historical iterations

### Existing Components to Reuse
- `RightPanel` - extend for subagent panel slot
- `IterationDetailView` - extend for trace display
- Iteration log persistence functions
- Config system for settings

## Success Metrics

- Users can see subagent activity in real-time during execution
- Subagent failures are immediately visible with context
- Detail level can be adjusted in <2 keystrokes
- Iteration logs contain queryable subagent trace data
- No performance regression when tracing disabled
- Graceful fallback for agents that don't support tracing

## Open Questions

1. Should we support filtering the subagent tree (e.g., show only failures)?
2. What's the maximum nesting depth we should display before collapsing?
3. Should subagent output be syntax-highlighted differently from main output?
4. Should we add subagent metrics to the progress dashboard (e.g., "3/5 subagents")?
5. How should we handle very long-running subagents (timeout indicators)?
