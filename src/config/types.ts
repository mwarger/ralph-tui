/**
 * ABOUTME: Type definitions for Ralph TUI configuration.
 * Defines the structure of configuration files and runtime options.
 */

import type { AgentPluginConfig } from '../plugins/agents/types.js';
import type { TrackerPluginConfig } from '../plugins/trackers/types.js';
import type { ErrorHandlingConfig, ErrorHandlingStrategy } from '../engine/types.js';

/**
 * Subagent tracing detail level controls how much subagent information is displayed.
 * - 'off': No tracing, use raw output (current default behavior)
 * - 'minimal': Show start/complete events only
 * - 'moderate': Show events + description + duration
 * - 'full': Show events + nested output + hierarchy panel
 */
export type SubagentDetailLevel = 'off' | 'minimal' | 'moderate' | 'full';

/**
 * Runtime options that can be passed via CLI flags
 */
export interface RuntimeOptions {
  /** Override agent plugin */
  agent?: string;

  /** Override model for the agent */
  model?: string;

  /** Override tracker plugin */
  tracker?: string;

  /** Epic ID for beads-based trackers */
  epicId?: string;

  /** PRD file path for json tracker */
  prdPath?: string;

  /** Maximum iterations to run */
  iterations?: number;

  /** Delay between iterations in milliseconds */
  iterationDelay?: number;

  /** Working directory for execution */
  cwd?: string;

  /** Whether to resume existing session */
  resume?: boolean;

  /** Force start even if lock exists */
  force?: boolean;

  /** Run in headless mode (no TUI) */
  headless?: boolean;

  /** Error handling strategy override */
  onError?: ErrorHandlingStrategy;

  /** Maximum retries for error handling */
  maxRetries?: number;

  /** Custom prompt file path (overrides config and defaults) */
  promptPath?: string;

  /** Output directory for iteration logs (overrides config) */
  outputDir?: string;
}

/**
 * Stored configuration (from YAML config file)
 */
export interface StoredConfig {
  /** Default agent to use */
  defaultAgent?: string;

  /** Default tracker to use */
  defaultTracker?: string;

  /** Default maximum iterations */
  maxIterations?: number;

  /** Default iteration delay in milliseconds */
  iterationDelay?: number;

  /** Configured agent plugins */
  agents?: AgentPluginConfig[];

  /** Configured tracker plugins */
  trackers?: TrackerPluginConfig[];

  /** Output directory for iteration logs */
  outputDir?: string;

  /** Error handling configuration */
  errorHandling?: Partial<ErrorHandlingConfig>;

  /** Shorthand: agent plugin name */
  agent?: string;

  /** Shorthand: tracker plugin name */
  tracker?: string;

  /** Shorthand: agent-specific options */
  agentOptions?: Record<string, unknown>;

  /** Shorthand: tracker-specific options */
  trackerOptions?: Record<string, unknown>;

  /** Whether to auto-commit after successful tasks */
  autoCommit?: boolean;

  /** Custom prompt template path (relative to cwd or absolute) */
  prompt_template?: string;

  /** Subagent tracing detail level for controlling display verbosity */
  subagentTracingDetail?: SubagentDetailLevel;
}

/**
 * Merged runtime configuration (stored config + CLI options)
 */
export interface RalphConfig {
  /** Active agent configuration */
  agent: AgentPluginConfig;

  /** Active tracker configuration */
  tracker: TrackerPluginConfig;

  /** Maximum iterations (0 = unlimited) */
  maxIterations: number;

  /** Delay between iterations in milliseconds */
  iterationDelay: number;

  /** Working directory */
  cwd: string;

  /** Output directory for iteration logs */
  outputDir: string;

  /** Epic ID (for beads trackers) */
  epicId?: string;

  /** PRD path (for json tracker) */
  prdPath?: string;

  /** Model override for agent */
  model?: string;

  /** Whether to show TUI */
  showTui: boolean;

  /** Error handling configuration */
  errorHandling: ErrorHandlingConfig;

  /** Custom prompt template path (resolved) */
  promptTemplate?: string;
}

/**
 * Validation result for configuration
 */
export interface ConfigValidationResult {
  /** Whether the configuration is valid */
  valid: boolean;

  /** Error messages if invalid */
  errors: string[];

  /** Warning messages (non-fatal) */
  warnings: string[];
}

/**
 * Default error handling configuration
 */
export const DEFAULT_ERROR_HANDLING: ErrorHandlingConfig = {
  strategy: 'skip',
  maxRetries: 3,
  retryDelayMs: 5000,
  continueOnNonZeroExit: false,
};

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: Omit<RalphConfig, 'agent' | 'tracker'> = {
  maxIterations: 10,
  iterationDelay: 1000,
  cwd: process.cwd(),
  outputDir: '.ralph-tui/iterations',
  showTui: true,
  errorHandling: DEFAULT_ERROR_HANDLING,
};
