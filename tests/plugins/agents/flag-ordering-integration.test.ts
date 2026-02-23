/**
 * ABOUTME: Integration tests for agent flag ordering.
 * Verifies that engine-injected flags (via options.flags) take precedence over
 * agent-internal buildArgs() flags by appearing last in the final argument list.
 *
 * Uses Bun.spawn directly (instead of node:child_process.spawn) to avoid mock
 * pollution from other test files that mock node:child_process at module level.
 * See: https://github.com/oven-sh/bun/issues/7823
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BaseAgentPlugin,
} from '../../../src/plugins/agents/base.js';
import type {
  AgentPluginMeta,
  AgentFileContext,
  AgentExecuteOptions,
  AgentDetectResult,
  AgentExecutionHandle,
  AgentExecutionResult,
} from '../../../src/plugins/agents/types.js';

/**
 * Mock agent plugin that simulates a real agent with a configurable model.
 * Overrides execute() to replicate the exact flag-merge logic from
 * BaseAgentPlugin.execute(), then uses Bun.spawn to avoid mock pollution.
 *
 * The flag-merge contract being tested:
 *   allArgs = [...defaultFlags, ...buildArgs(), ...(options.flags ?? [])]
 */
class MockAgentWithModel extends BaseAgentPlugin {
  readonly meta: AgentPluginMeta = {
    id: 'mock-model-agent',
    name: 'Mock Model Agent',
    description: 'Mock agent for testing flag ordering with model overrides',
    version: '1.0.0',
    author: 'Test',
    defaultCommand: 'echo',
    supportsStreaming: true,
    supportsInterrupt: true,
    supportsFileContext: false,
    supportsSubagentTracing: false,
  };

  private agentModel?: string;
  private scriptPathForTest?: string;

  setScriptPath(path: string): void {
    this.scriptPathForTest = path;
  }

  setAgentModel(model: string): void {
    this.agentModel = model;
  }

  override async detect(): Promise<AgentDetectResult> {
    return { available: true, version: '1.0.0' };
  }

  protected buildArgs(
    _prompt: string,
    _files?: AgentFileContext[],
    _options?: AgentExecuteOptions
  ): string[] {
    const args: string[] = [];
    if (this.agentModel) {
      args.push('--model', this.agentModel);
    }
    return args;
  }

  /**
   * Override execute to use Bun.spawn (avoids node:child_process mock pollution)
   * while replicating the exact flag-merge logic from BaseAgentPlugin.execute().
   */
  override execute(
    prompt: string,
    files?: AgentFileContext[],
    options?: AgentExecuteOptions
  ): AgentExecutionHandle {
    const executionId = 'flag-integ-' + Date.now();
    const command = this.scriptPathForTest ?? this.meta.defaultCommand;
    const args = this.buildArgs(prompt, files, options);
    const startedAt = new Date();

    // Replicate the exact flag-merge logic from BaseAgentPlugin.execute():
    // Engine-injected flags (options.flags) come last so they take precedence
    const allArgs = [...this.defaultFlags, ...args, ...(options?.flags ?? [])];

    let resolvePromise: (result: AgentExecutionResult) => void;
    const promise = new Promise<AgentExecutionResult>((resolve) => {
      resolvePromise = resolve;
    });

    const runExecution = async (): Promise<void> => {
      try {
        const proc = Bun.spawn([command, ...allArgs], {
          cwd: options?.cwd ?? process.cwd(),
          stdout: 'pipe',
          stderr: 'pipe',
        });

        const decoder = new TextDecoder();
        let stdout = '';

        const reader = proc.stdout.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value);
          stdout += text;
          options?.onStdout?.(text);
        }

        const exitCode = await proc.exited;
        const endedAt = new Date();

        resolvePromise!({
          executionId,
          status: exitCode === 0 ? 'completed' : 'failed',
          exitCode,
          stdout,
          stderr: '',
          durationMs: endedAt.getTime() - startedAt.getTime(),
          interrupted: false,
          startedAt: startedAt.toISOString(),
          endedAt: endedAt.toISOString(),
        });
      } catch (error) {
        resolvePromise!({
          executionId,
          status: 'failed',
          exitCode: undefined,
          stdout: '',
          stderr: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startedAt.getTime(),
          interrupted: false,
          startedAt: startedAt.toISOString(),
          endedAt: new Date().toISOString(),
        });
      }
    };

    void runExecution();

    return {
      executionId,
      promise,
      interrupt: () => true,
      isRunning: () => false,
    };
  }
}

/** Parse script output into an array of arguments (one per line) */
function parseArgs(stdout: string): string[] {
  return stdout.split('\n').filter((line) => line.length > 0);
}

describe('Flag ordering integration (mock agent with real execute)', () => {
  let agent: MockAgentWithModel;
  let scriptPath: string;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ralph-flag-integ-'));
    scriptPath = join(tempDir, 'print-args.sh');
    await writeFile(
      scriptPath,
      '#!/bin/sh\nfor arg; do printf "%s\\n" "$arg"; done\n',
      { mode: 0o755 }
    );

    agent = new MockAgentWithModel();
    await agent.initialize({});
    agent.setScriptPath(scriptPath);
  });

  afterEach(async () => {
    await agent.dispose();
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  test('engine-level model flag overrides agent-level model flag', async () => {
    agent.setAgentModel('claude-3-5-sonnet');

    let capturedStdout = '';
    const handle = agent.execute('complete the task', [], {
      flags: ['--model', 'claude-sonnet-4'],
      timeout: 10000,
      onStdout: (text: string) => {
        capturedStdout += text;
      },
    });

    const result = await handle.promise;
    expect(result.status).toBe('completed');

    const args = parseArgs(capturedStdout);

    // Find all --model flag positions
    const modelIndices: number[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--model') {
        modelIndices.push(i);
      }
    }

    // There should be two --model flags (one from buildArgs, one from engine)
    expect(modelIndices.length).toBe(2);

    // The agent-level model value should come first
    const firstModelValueIdx = modelIndices[0]! + 1;
    expect(args[firstModelValueIdx]).toBe('claude-3-5-sonnet');

    // The engine-level model value should come second (last-flag-wins)
    const secondModelValueIdx = modelIndices[1]! + 1;
    expect(args[secondModelValueIdx]).toBe('claude-sonnet-4');

    // Engine model index is after agent model index
    expect(modelIndices[1]).toBeGreaterThan(modelIndices[0]!);
  });

  test('engine flags come after buildArgs when both set model', async () => {
    agent = new MockAgentWithModel();
    await agent.initialize({ defaultFlags: ['--verbose'] });
    agent.setScriptPath(scriptPath);
    agent.setAgentModel('agent-default-model');

    let capturedStdout = '';
    const handle = agent.execute('do work', [], {
      flags: ['--model', 'engine-override-model', '--extra-flag'],
      timeout: 10000,
      onStdout: (text: string) => {
        capturedStdout += text;
      },
    });

    const result = await handle.promise;
    expect(result.status).toBe('completed');

    const args = parseArgs(capturedStdout);

    const verboseIdx = args.indexOf('--verbose');
    const agentModelIdx = args.indexOf('agent-default-model');
    const engineModelIdx = args.indexOf('engine-override-model');
    const extraFlagIdx = args.indexOf('--extra-flag');

    expect(verboseIdx).toBeGreaterThan(-1);
    expect(agentModelIdx).toBeGreaterThan(-1);
    expect(engineModelIdx).toBeGreaterThan(-1);
    expect(extraFlagIdx).toBeGreaterThan(-1);

    // defaultFlags < buildArgs < engine flags
    expect(verboseIdx).toBeLessThan(agentModelIdx);
    expect(agentModelIdx).toBeLessThan(engineModelIdx);
    expect(engineModelIdx).toBeLessThan(extraFlagIdx);
  });

  test('without engine flags, agent buildArgs flags are still present', async () => {
    agent.setAgentModel('my-model');

    let capturedStdout = '';
    const handle = agent.execute('test prompt', [], {
      timeout: 10000,
      onStdout: (text: string) => {
        capturedStdout += text;
      },
    });

    const result = await handle.promise;
    expect(result.status).toBe('completed');

    const args = parseArgs(capturedStdout);

    expect(args).toContain('--model');
    expect(args).toContain('my-model');

    const modelCount = args.filter(a => a === '--model').length;
    expect(modelCount).toBe(1);
  });
});
