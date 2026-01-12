/**
 * ABOUTME: Claude Code agent plugin for the claude CLI.
 * Integrates with Anthropic's Claude Code CLI for AI-assisted coding.
 * Supports: print mode execution, model selection, file context, timeout, graceful interruption.
 */

import { spawn } from 'node:child_process';
import { BaseAgentPlugin } from '../base.js';
import type {
  AgentPluginMeta,
  AgentPluginFactory,
  AgentFileContext,
  AgentExecuteOptions,
  AgentSetupQuestion,
  AgentDetectResult,
} from '../types.js';

/**
 * Claude Code agent plugin implementation.
 * Uses the `claude` CLI to execute AI coding tasks.
 *
 * Key features:
 * - Auto-detects claude binary using `which`
 * - Executes in print mode (-p) for non-interactive use
 * - Supports --dangerously-skip-permissions for autonomous operation
 * - Configurable model selection via --model flag
 * - Timeout handling with graceful SIGINT before SIGTERM
 * - Streaming stdout/stderr capture
 */
export class ClaudeAgentPlugin extends BaseAgentPlugin {
  readonly meta: AgentPluginMeta = {
    id: 'claude',
    name: 'Claude Code',
    description: 'Anthropic Claude Code CLI for AI-assisted coding',
    version: '1.0.0',
    author: 'Anthropic',
    defaultCommand: 'claude',
    supportsStreaming: true,
    supportsInterrupt: true,
    supportsFileContext: true,
  };

  /** Print mode: text, json, or stream-json */
  private printMode: 'text' | 'json' | 'stream' = 'text';

  /** Model to use (e.g., 'sonnet', 'opus', 'haiku') */
  private model?: string;

  /** Skip permission prompts for autonomous operation */
  private skipPermissions = true;

  /** Timeout in milliseconds (0 = no timeout) */
  protected override defaultTimeout = 0;

  override async initialize(config: Record<string, unknown>): Promise<void> {
    await super.initialize(config);

    if (
      typeof config.printMode === 'string' &&
      ['text', 'json', 'stream'].includes(config.printMode)
    ) {
      this.printMode = config.printMode as 'text' | 'json' | 'stream';
    }

    if (typeof config.model === 'string' && config.model.length > 0) {
      this.model = config.model;
    }

    if (typeof config.skipPermissions === 'boolean') {
      this.skipPermissions = config.skipPermissions;
    }

    if (typeof config.timeout === 'number' && config.timeout > 0) {
      this.defaultTimeout = config.timeout;
    }
  }

  /**
   * Detect claude CLI availability using `which` command.
   * Falls back to testing direct execution if `which` is not available.
   */
  override async detect(): Promise<AgentDetectResult> {
    const command = this.commandPath ?? this.meta.defaultCommand;

    // First, try to find the binary using `which`
    const whichResult = await this.runWhich(command);

    if (!whichResult.found) {
      return {
        available: false,
        error: `Claude CLI not found in PATH. Install with: npm install -g @anthropic-ai/claude-code`,
      };
    }

    // Verify the binary works by running --version
    const versionResult = await this.runVersion(whichResult.path);

    if (!versionResult.success) {
      return {
        available: false,
        executablePath: whichResult.path,
        error: versionResult.error,
      };
    }

    return {
      available: true,
      version: versionResult.version,
      executablePath: whichResult.path,
    };
  }

  /**
   * Run `which` command to find binary path
   */
  private runWhich(command: string): Promise<{ found: boolean; path: string }> {
    return new Promise((resolve) => {
      const proc = spawn('which', [command], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.on('error', () => {
        resolve({ found: false, path: '' });
      });

      proc.on('close', (code) => {
        if (code === 0 && stdout.trim()) {
          resolve({ found: true, path: stdout.trim() });
        } else {
          resolve({ found: false, path: '' });
        }
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        proc.kill();
        resolve({ found: false, path: '' });
      }, 5000);
    });
  }

  /**
   * Run --version to verify binary and extract version number
   */
  private runVersion(
    command: string
  ): Promise<{ success: boolean; version?: string; error?: string }> {
    return new Promise((resolve) => {
      const proc = spawn(command, ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        resolve({
          success: false,
          error: `Failed to execute: ${error.message}`,
        });
      });

      proc.on('close', (code) => {
        if (code === 0) {
          // Extract version from output (e.g., "claude 1.0.5")
          const versionMatch = stdout.match(/(\d+\.\d+\.\d+)/);
          resolve({
            success: true,
            version: versionMatch?.[1],
          });
        } else {
          resolve({
            success: false,
            error: stderr || `Exited with code ${code}`,
          });
        }
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        proc.kill();
        resolve({ success: false, error: 'Timeout waiting for --version' });
      }, 5000);
    });
  }

  override getSetupQuestions(): AgentSetupQuestion[] {
    const baseQuestions = super.getSetupQuestions();
    return [
      ...baseQuestions,
      {
        id: 'printMode',
        prompt: 'Output mode:',
        type: 'select',
        choices: [
          {
            value: 'text',
            label: 'Text',
            description: 'Plain text output (default)',
          },
          { value: 'json', label: 'JSON', description: 'Structured JSON output' },
          {
            value: 'stream',
            label: 'Stream',
            description: 'Streaming JSON for real-time feedback',
          },
        ],
        default: 'text',
        required: false,
        help: 'How Claude should output its responses',
      },
      {
        id: 'model',
        prompt: 'Model to use:',
        type: 'select',
        choices: [
          { value: '', label: 'Default', description: 'Use configured default model' },
          { value: 'sonnet', label: 'Sonnet', description: 'Claude Sonnet - balanced' },
          { value: 'opus', label: 'Opus', description: 'Claude Opus - most capable' },
          { value: 'haiku', label: 'Haiku', description: 'Claude Haiku - fastest' },
        ],
        default: '',
        required: false,
        help: 'Claude model variant to use for this agent',
      },
      {
        id: 'skipPermissions',
        prompt: 'Skip permission prompts?',
        type: 'boolean',
        default: true,
        required: false,
        help: 'Enable --dangerously-skip-permissions for autonomous operation',
      },
    ];
  }

  protected buildArgs(
    _prompt: string,
    files?: AgentFileContext[],
    _options?: AgentExecuteOptions
  ): string[] {
    const args: string[] = [];

    // Add print mode flag for non-interactive output
    args.push('--print');

    // Add output format based on printMode setting
    if (this.printMode === 'json') {
      args.push('--output-format', 'json');
    } else if (this.printMode === 'stream') {
      args.push('--output-format', 'stream-json');
    }

    // Add model if specified (from config or passed in options)
    const modelToUse = this.model;
    if (modelToUse) {
      args.push('--model', modelToUse);
    }

    // Skip permission prompts for autonomous operation
    if (this.skipPermissions) {
      args.push('--dangerously-skip-permissions');
    }

    // Add file context if provided
    // Claude Code supports --add-dir for directory context
    if (files && files.length > 0) {
      const directories = new Set<string>();

      for (const file of files) {
        // Extract directory from file path for --add-dir
        const lastSlash = file.path.lastIndexOf('/');
        if (lastSlash > 0) {
          directories.add(file.path.substring(0, lastSlash));
        }
      }

      // Add unique directories
      for (const dir of directories) {
        args.push('--add-dir', dir);
      }
    }

    // NOTE: Prompt is NOT added here - it's passed via stdin to avoid
    // shell interpretation of special characters (markdown bullets, etc.)

    return args;
  }

  /**
   * Provide the prompt via stdin instead of command args.
   * This avoids shell interpretation issues with special characters in prompts.
   */
  protected override getStdinInput(
    prompt: string,
    _files?: AgentFileContext[],
    _options?: AgentExecuteOptions
  ): string {
    return prompt;
  }

  override async validateSetup(
    answers: Record<string, unknown>
  ): Promise<string | null> {
    // Validate print mode
    const printMode = answers.printMode;
    if (
      printMode !== undefined &&
      printMode !== '' &&
      !['text', 'json', 'stream'].includes(String(printMode))
    ) {
      return 'Invalid print mode. Must be one of: text, json, stream';
    }

    // Validate model if provided
    const model = answers.model;
    if (
      model !== undefined &&
      model !== '' &&
      !['sonnet', 'opus', 'haiku'].includes(String(model))
    ) {
      return 'Invalid model. Must be one of: sonnet, opus, haiku (or leave empty for default)';
    }

    return null;
  }
}

/**
 * Factory function for the Claude Code agent plugin.
 */
const createClaudeAgent: AgentPluginFactory = () => new ClaudeAgentPlugin();

export default createClaudeAgent;
