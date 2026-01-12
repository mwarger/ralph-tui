/**
 * ABOUTME: RightPanel component for the Ralph TUI.
 * Displays the current iteration details or selected task details.
 * Supports toggling between details view and output view with 'o' key.
 */

import type { ReactNode } from 'react';
import { colors, getTaskStatusColor, getTaskStatusIndicator } from '../theme.js';
import type { RightPanelProps, DetailsViewMode, IterationTimingInfo } from '../types.js';
import { formatElapsedTime } from '../theme.js';

/**
 * Format an ISO 8601 timestamp to a human-readable time string.
 * Returns time in HH:MM:SS format.
 */
function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * Display when no task is selected.
 * Shows helpful setup instructions for new users.
 */
function NoSelection(): ReactNode {
  return (
    <box
      style={{
        flexGrow: 1,
        flexDirection: 'column',
        padding: 2,
      }}
    >
      <box style={{ marginBottom: 1 }}>
        <text fg={colors.fg.primary}>Getting Started</text>
      </box>
      <box style={{ marginBottom: 2 }}>
        <text fg={colors.fg.secondary}>
          No tasks available. To start working with Ralph:
        </text>
      </box>
      <box style={{ flexDirection: 'column', gap: 1 }}>
        <text fg={colors.fg.muted}>
          <span fg={colors.accent.primary}>1.</span> Run{' '}
          <span fg={colors.fg.secondary}>ralph-tui setup</span> to configure your project
        </text>
        <text fg={colors.fg.muted}>
          <span fg={colors.accent.primary}>2.</span> Run{' '}
          <span fg={colors.fg.secondary}>ralph-tui run</span> to start execution
        </text>
        <text fg={colors.fg.muted}>
          <span fg={colors.accent.primary}>3.</span> Or run{' '}
          <span fg={colors.fg.secondary}>ralph-tui --help</span> for more options
        </text>
      </box>
      <box style={{ marginTop: 2 }}>
        <text fg={colors.fg.dim}>Press 'q' or Esc to quit</text>
      </box>
    </box>
  );
}

/**
 * Task metadata view - shows task title, ID, status, description, dependencies
 */
function TaskMetadataView({
  task,
}: {
  task: NonNullable<RightPanelProps['selectedTask']>;
}): ReactNode {
  const statusColor = getTaskStatusColor(task.status);
  const statusIndicator = getTaskStatusIndicator(task.status);

  return (
    <box style={{ flexDirection: 'column', padding: 1, flexGrow: 1 }}>
      {/* Task title and status */}
      <box style={{ marginBottom: 1 }}>
        <text>
          <span fg={statusColor}>{statusIndicator}</span>
          <span fg={colors.fg.primary}> {task.title}</span>
        </text>
      </box>

      {/* Task metadata */}
      <box style={{ flexDirection: 'row', gap: 2, marginBottom: 1 }}>
        <text fg={colors.fg.muted}>
          ID: <span fg={colors.fg.secondary}>{task.id}</span>
        </text>
        <text fg={colors.fg.muted}>
          Status: <span fg={statusColor}>{task.status}</span>
        </text>
        {task.iteration !== undefined && (
          <text fg={colors.fg.muted}>
            Iteration: <span fg={colors.accent.primary}>{task.iteration}</span>
          </text>
        )}
      </box>

      {/* Task description - full height scrollable */}
      <box
        title="Description"
        style={{
          flexGrow: 1,
          border: true,
          borderColor: colors.border.normal,
          backgroundColor: colors.bg.secondary,
        }}
      >
        <scrollbox style={{ flexGrow: 1, padding: 1 }}>
          {task.description ? (
            <text fg={colors.fg.secondary}>{task.description}</text>
          ) : (
            <text fg={colors.fg.muted}>No description</text>
          )}
        </scrollbox>
      </box>

      {/* Dependencies section */}
      {task.dependsOn && task.dependsOn.length > 0 && (
        <box
          title="Dependencies"
          style={{
            marginTop: 1,
            border: true,
            borderColor: colors.border.muted,
            padding: 1,
          }}
        >
          <text fg={colors.fg.secondary}>
            {task.dependsOn.join(', ')}
          </text>
        </box>
      )}

      {/* Blockers section (if blocked) */}
      {task.blockedByTasks && task.blockedByTasks.length > 0 && (
        <box
          title="Blocked By"
          style={{
            marginTop: 1,
            border: true,
            borderColor: colors.task.blocked,
            padding: 1,
          }}
        >
          {task.blockedByTasks.map((blocker) => (
            <text key={blocker.id} fg={colors.fg.secondary}>
              {blocker.id}: {blocker.title} ({blocker.status})
            </text>
          ))}
        </box>
      )}
    </box>
  );
}

/**
 * Timing summary component for the output view
 */
function TimingSummary({ timing }: { timing?: IterationTimingInfo }): ReactNode {
  if (!timing || (!timing.startedAt && !timing.isRunning)) {
    return null;
  }

  // Calculate duration for display
  let durationDisplay: string;
  if (timing.isRunning && timing.startedAt) {
    durationDisplay = 'Running...';
  } else if (timing.durationMs !== undefined) {
    const durationSeconds = Math.floor(timing.durationMs / 1000);
    durationDisplay = formatElapsedTime(durationSeconds);
  } else {
    durationDisplay = '—';
  }

  return (
    <box
      style={{
        marginBottom: 1,
        padding: 1,
        border: true,
        borderColor: colors.border.muted,
        backgroundColor: colors.bg.tertiary,
      }}
    >
      <box style={{ flexDirection: 'row', gap: 3 }}>
        <text fg={colors.fg.muted}>
          Started:{' '}
          <span fg={colors.fg.secondary}>
            {timing.startedAt ? formatTimestamp(timing.startedAt) : '—'}
          </span>
        </text>
        <text fg={colors.fg.muted}>
          Ended:{' '}
          <span fg={colors.fg.secondary}>
            {timing.endedAt ? formatTimestamp(timing.endedAt) : '—'}
          </span>
        </text>
        <text fg={colors.fg.muted}>
          Duration:{' '}
          <span fg={timing.isRunning ? colors.status.info : colors.accent.primary}>
            {durationDisplay}
          </span>
        </text>
      </box>
    </box>
  );
}

/**
 * Task output view - shows full-height scrollable iteration output
 */
function TaskOutputView({
  task,
  currentIteration,
  iterationOutput,
  iterationTiming,
}: {
  task: NonNullable<RightPanelProps['selectedTask']>;
  currentIteration: number;
  iterationOutput?: string;
  iterationTiming?: IterationTimingInfo;
}): ReactNode {
  const statusColor = getTaskStatusColor(task.status);
  const statusIndicator = getTaskStatusIndicator(task.status);

  return (
    <box style={{ flexDirection: 'column', padding: 1, flexGrow: 1 }}>
      {/* Compact task header */}
      <box style={{ marginBottom: 1 }}>
        <text>
          <span fg={statusColor}>{statusIndicator}</span>
          <span fg={colors.fg.primary}> {task.title}</span>
          <span fg={colors.fg.muted}> ({task.id})</span>
        </text>
      </box>

      {/* Timing summary - shows start/end/duration */}
      <TimingSummary timing={iterationTiming} />

      {/* Full-height iteration output */}
      <box
        title={
          currentIteration === -1
            ? 'Historical Output'
            : currentIteration > 0
              ? `Iteration ${currentIteration}`
              : 'Output'
        }
        style={{
          flexGrow: 1,
          border: true,
          borderColor: colors.border.normal,
          backgroundColor: colors.bg.secondary,
        }}
      >
        <scrollbox style={{ flexGrow: 1, padding: 1 }}>
          {iterationOutput !== undefined && iterationOutput.length > 0 ? (
            <text fg={colors.fg.secondary}>{iterationOutput}</text>
          ) : iterationOutput === '' ? (
            <text fg={colors.fg.muted}>No output captured</text>
          ) : currentIteration === 0 ? (
            <text fg={colors.fg.muted}>Task not yet executed</text>
          ) : (
            <text fg={colors.fg.muted}>Waiting for output...</text>
          )}
        </scrollbox>
      </box>
    </box>
  );
}

/**
 * Task details view - switches between metadata and output views
 */
function TaskDetails({
  task,
  currentIteration,
  iterationOutput,
  viewMode = 'details',
  iterationTiming,
}: {
  task: NonNullable<RightPanelProps['selectedTask']>;
  currentIteration: number;
  iterationOutput?: string;
  viewMode?: DetailsViewMode;
  iterationTiming?: IterationTimingInfo;
}): ReactNode {
  if (viewMode === 'output') {
    return (
      <TaskOutputView
        task={task}
        currentIteration={currentIteration}
        iterationOutput={iterationOutput}
        iterationTiming={iterationTiming}
      />
    );
  }

  return <TaskMetadataView task={task} />;
}

/**
 * RightPanel component showing task details or iteration output
 */
export function RightPanel({
  selectedTask,
  currentIteration,
  iterationOutput,
  viewMode = 'details',
  iterationTiming,
  subagentDetailLevel = 'off',
}: RightPanelProps): ReactNode {
  // Note: subagentDetailLevel is available for future subagent display implementation
  // - 'off': No tracing, show raw output only (current behavior)
  // - 'minimal': Show start/complete events only
  // - 'moderate': Show events + description + duration
  // - 'full': Show events + nested output + hierarchy panel
  void subagentDetailLevel; // Suppress unused variable warning until subagent UI is implemented
  // Build title with view mode indicator
  const modeIndicator = viewMode === 'details' ? '[Details]' : '[Output]';
  const title = `Details ${modeIndicator}`;

  return (
    <box
      title={title}
      style={{
        flexGrow: 2,
        flexShrink: 1,
        minWidth: 40,
        flexDirection: 'column',
        backgroundColor: colors.bg.primary,
        border: true,
        borderColor: colors.border.normal,
      }}
    >
      {selectedTask ? (
        <TaskDetails
          task={selectedTask}
          currentIteration={currentIteration}
          iterationOutput={iterationOutput}
          viewMode={viewMode}
          iterationTiming={iterationTiming}
        />
      ) : (
        <NoSelection />
      )}
    </box>
  );
}
