/**
 * ABOUTME: Tests for the BaseAgentPlugin class.
 * Tests preflight functionality and other base plugin methods.
 */

import {
  describe,
  expect,
  test,
  beforeEach,
  afterEach,
} from 'bun:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Import the module to test internal functions via a workaround
// We'll test the public interface and behavior
import {
  BaseAgentPlugin,
  DEFAULT_ENV_EXCLUDE_PATTERNS,
  findCommandPath,
  getEnvExclusionReport,
  formatEnvExclusionReport,
} from './base.js';
import type {
  AgentPluginMeta,
  AgentFileContext,
  AgentExecuteOptions,
  AgentDetectResult,
  AgentExecutionStatus,
  AgentExecutionHandle,
  AgentExecutionResult,
} from './types.js';

/**
 * Concrete test implementation of BaseAgentPlugin for testing purposes.
 */
class TestAgentPlugin extends BaseAgentPlugin {
  readonly meta: AgentPluginMeta = {
    id: 'test-agent',
    name: 'Test Agent',
    description: 'A test agent for unit testing',
    version: '1.0.0',
    author: 'Test',
    defaultCommand: 'test-agent-cli',
    supportsStreaming: true,
    supportsInterrupt: true,
    supportsFileContext: false,
    supportsSubagentTracing: false,
  };

  // Allow tests to control detect result
  private mockDetectResult: AgentDetectResult = {
    available: true,
    version: '1.0.0',
    executablePath: '/usr/bin/test-agent',
  };

  // Allow tests to control execution behavior
  private mockExecutionOutput = 'PREFLIGHT_OK';
  private mockExecutionStatus: AgentExecutionStatus = 'completed';
  private mockExecutionError?: string;

  setMockDetectResult(result: AgentDetectResult): void {
    this.mockDetectResult = result;
  }

  setMockExecutionResult(
    status: 'completed' | 'failed' | 'timeout',
    output = 'PREFLIGHT_OK',
    error?: string
  ): void {
    this.mockExecutionStatus = status;
    this.mockExecutionOutput = output;
    this.mockExecutionError = error;
  }

  override async detect(): Promise<AgentDetectResult> {
    return this.mockDetectResult;
  }

  protected buildArgs(
    _prompt: string,
    _files?: AgentFileContext[],
    _options?: AgentExecuteOptions
  ): string[] {
    return ['run', '--prompt'];
  }

  // Override execute to provide controlled responses for testing
  override execute(
    _prompt: string,
    _files?: AgentFileContext[],
    options?: AgentExecuteOptions
  ): AgentExecutionHandle {
    const executionId = 'test-execution-' + Date.now();
    const startedAt = new Date();

    // Call onStdout with mock output if provided
    if (options?.onStdout && this.mockExecutionOutput) {
      setTimeout(() => {
        options.onStdout?.(this.mockExecutionOutput);
      }, 10);
    }

    const promise = new Promise<{
      executionId: string;
      status: AgentExecutionStatus;
      exitCode?: number;
      stdout: string;
      stderr: string;
      durationMs: number;
      error?: string;
      interrupted: boolean;
      startedAt: string;
      endedAt: string;
    }>((resolve) => {
      setTimeout(() => {
        resolve({
          executionId,
          status: this.mockExecutionStatus,
          exitCode: this.mockExecutionStatus === 'completed' ? 0 : 1,
          stdout: this.mockExecutionOutput,
          stderr: '',
          durationMs: 100,
          error: this.mockExecutionError,
          interrupted: false,
          startedAt: startedAt.toISOString(),
          endedAt: new Date().toISOString(),
        });
      }, 20);
    });

    return {
      executionId,
      promise,
      interrupt: () => true,
      isRunning: () => false,
    };
  }

  // Test accessor for protected method
  testGetPreflightSuggestion(): string {
    return this.getPreflightSuggestion();
  }
}

describe('BaseAgentPlugin', () => {
  let agent: TestAgentPlugin;

  beforeEach(() => {
    agent = new TestAgentPlugin();
  });

  describe('findCommandPath', () => {
    test('resolves explicit absolute command paths directly on the filesystem', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'ralph-find-cmd-'));
      const commandPath = join(tempDir, 'claude-test.bin');
      try {
        await writeFile(commandPath, '');
        const result = await findCommandPath(commandPath);

        expect(result.found).toBe(true);
        expect(result.path).toBe(commandPath);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    test('returns not found for missing explicit command paths', async () => {
      const result = await findCommandPath('/definitely/not/a/real/command');

      expect(result.found).toBe(false);
      expect(result.path).toBe('');
    });
  });

  afterEach(async () => {
    await agent.dispose();
  });

  describe('preflight', () => {
    test('returns success when detect passes and execution completes', async () => {
      agent.setMockDetectResult({
        available: true,
        version: '1.0.0',
        executablePath: '/usr/bin/test',
      });
      agent.setMockExecutionResult('completed', 'PREFLIGHT_OK');

      const result = await agent.preflight({ timeout: 5000 });

      expect(result.success).toBe(true);
      expect(result.durationMs).toBeGreaterThan(0);
      expect(result.error).toBeUndefined();
    });

    test('returns failure when detect fails', async () => {
      agent.setMockDetectResult({
        available: false,
        error: 'CLI not found in PATH',
      });

      const result = await agent.preflight();

      expect(result.success).toBe(false);
      expect(result.error).toContain('CLI not found');
      expect(result.suggestion).toContain('Test Agent');
    });

    test('returns failure when execution times out', async () => {
      agent.setMockDetectResult({ available: true });
      agent.setMockExecutionResult('timeout');

      const result = await agent.preflight({ timeout: 1000 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
    });

    test('returns failure when execution fails', async () => {
      agent.setMockDetectResult({ available: true });
      agent.setMockExecutionResult('failed', '', 'API key not configured');

      const result = await agent.preflight();

      expect(result.success).toBe(false);
      expect(result.error).toContain('API key not configured');
    });

    test('returns failure when no output is produced', async () => {
      agent.setMockDetectResult({ available: true });
      agent.setMockExecutionResult('completed', ''); // Empty output

      const result = await agent.preflight();

      expect(result.success).toBe(false);
      expect(result.error).toContain('did not produce any output');
    });

    test('includes duration in result', async () => {
      agent.setMockDetectResult({ available: true });
      agent.setMockExecutionResult('completed', 'OK');

      const result = await agent.preflight();

      expect(result.durationMs).toBeDefined();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    test('uses default timeout when not specified', async () => {
      agent.setMockDetectResult({ available: true });
      agent.setMockExecutionResult('completed', 'OK');

      // This should not throw and should use default 15 second timeout
      const result = await agent.preflight();
      expect(result.success).toBe(true);
    });

    test('includes suggestion on failure', async () => {
      agent.setMockDetectResult({ available: true });
      agent.setMockExecutionResult('failed');

      const result = await agent.preflight();

      expect(result.success).toBe(false);
      expect(result.suggestion).toBeDefined();
      expect(result.suggestion).toContain('Test Agent');
    });
  });

  describe('getPreflightSuggestion', () => {
    test('returns agent-specific suggestion', () => {
      const suggestion = agent.testGetPreflightSuggestion();

      expect(suggestion).toContain('Test Agent');
      expect(suggestion).toContain('configured');
    });
  });

  describe('initialize', () => {
    test('sets ready state to true', async () => {
      await expect(agent.isReady()).resolves.toBe(false);

      await agent.initialize({});

      await expect(agent.isReady()).resolves.toBe(true);
    });

    test('can be configured with custom command', async () => {
      await agent.initialize({ command: '/custom/path/agent' });

      // The command should be stored (implementation detail)
      await expect(agent.isReady()).resolves.toBe(true);
    });
  });

  describe('dispose', () => {
    test('sets ready state to false', async () => {
      await agent.initialize({});
      await expect(agent.isReady()).resolves.toBe(true);

      await agent.dispose();

      await expect(agent.isReady()).resolves.toBe(false);
    });
  });

  describe('getSetupQuestions', () => {
    test('returns command and timeout questions', () => {
      const questions = agent.getSetupQuestions();

      expect(questions.length).toBeGreaterThanOrEqual(2);

      const commandQuestion = questions.find((q) => q.id === 'command');
      expect(commandQuestion).toBeDefined();
      expect(commandQuestion?.type).toBe('path');

      const timeoutQuestion = questions.find((q) => q.id === 'timeout');
      expect(timeoutQuestion).toBeDefined();
    });
  });

  describe('validateSetup', () => {
    test('returns null for valid answers (accepts all by default)', async () => {
      const result = await agent.validateSetup({ command: '/path/to/agent' });
      expect(result).toBeNull();
    });
  });

  describe('validateModel', () => {
    test('returns null for any model (accepts all by default)', () => {
      const result = agent.validateModel('any-model-name');
      expect(result).toBeNull();
    });
  });
});

/**
 * Tests for BaseAgentPlugin execute lifecycle (onStdout, onEnd, onStart callbacks)
 * and envExclude functionality that require real process execution are located in
 * tests/plugins/agents/base-execute.test.ts. Those tests use Bun.spawn directly
 * to avoid mock pollution from test files that mock node:child_process, because
 * Bun's mock.restore() does not reliably restore builtin modules.
 *
 * See: https://github.com/oven-sh/bun/issues/7823
 */

describe('BaseAgentPlugin envExclude (unit tests)', () => {
  describe('getEnvExclusionReport', () => {
    test('reports blocked vars that match default patterns', () => {
      const testEnv: NodeJS.ProcessEnv = {
        ANTHROPIC_API_KEY: 'key1',
        OPENAI_API_KEY: 'key2',
        DB_SECRET: 'sec1',
        AWS_SECRET_KEY: 'sec2',
        SAFE_VAR: 'safe',
        HOME: '/home/user',
      };

      const report = getEnvExclusionReport(testEnv);

      expect(report.blocked).toContain('ANTHROPIC_API_KEY');
      expect(report.blocked).toContain('OPENAI_API_KEY');
      expect(report.blocked).toContain('DB_SECRET');
      expect(report.blocked).toContain('AWS_SECRET_KEY');
      expect(report.blocked).not.toContain('SAFE_VAR');
      expect(report.blocked).not.toContain('HOME');
      expect(report.allowed).toHaveLength(0);
    });

    test('reports allowed vars when passthrough is configured', () => {
      const testEnv: NodeJS.ProcessEnv = {
        ANTHROPIC_API_KEY: 'key1',
        OPENAI_API_KEY: 'key2',
        DB_SECRET: 'sec1',
      };

      const report = getEnvExclusionReport(testEnv, ['ANTHROPIC_API_KEY']);

      expect(report.blocked).toContain('OPENAI_API_KEY');
      expect(report.blocked).toContain('DB_SECRET');
      expect(report.blocked).not.toContain('ANTHROPIC_API_KEY');
      expect(report.allowed).toContain('ANTHROPIC_API_KEY');
    });

    test('supports glob patterns in passthrough', () => {
      const testEnv: NodeJS.ProcessEnv = {
        ANTHROPIC_API_KEY: 'key1',
        OPENAI_API_KEY: 'key2',
        MY_SECRET: 'sec1',
      };

      const report = getEnvExclusionReport(testEnv, ['*_API_KEY']);

      expect(report.allowed).toContain('ANTHROPIC_API_KEY');
      expect(report.allowed).toContain('OPENAI_API_KEY');
      expect(report.blocked).toContain('MY_SECRET');
    });

    test('includes additional exclude patterns in report', () => {
      const testEnv: NodeJS.ProcessEnv = {
        CUSTOM_VAR: 'val',
        ANTHROPIC_API_KEY: 'key1',
      };

      const report = getEnvExclusionReport(testEnv, [], ['CUSTOM_VAR']);

      expect(report.blocked).toContain('CUSTOM_VAR');
      expect(report.blocked).toContain('ANTHROPIC_API_KEY');
    });

    test('returns sorted arrays', () => {
      const testEnv: NodeJS.ProcessEnv = {
        ZEBRA_API_KEY: 'z',
        ALPHA_API_KEY: 'a',
        MY_SECRET: 'm',
      };

      const report = getEnvExclusionReport(testEnv);

      expect(report.blocked).toEqual(['ALPHA_API_KEY', 'MY_SECRET', 'ZEBRA_API_KEY']);
    });

    test('returns empty arrays when no matches', () => {
      const testEnv: NodeJS.ProcessEnv = {
        HOME: '/home/user',
        PATH: '/usr/bin',
      };

      const report = getEnvExclusionReport(testEnv);

      expect(report.blocked).toHaveLength(0);
      expect(report.allowed).toHaveLength(0);
    });
  });

  describe('formatEnvExclusionReport', () => {
    test('shows blocked vars', () => {
      const report = { blocked: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'], allowed: [] };
      const lines = formatEnvExclusionReport(report);

      expect(lines).toContain('Env filter:');
      expect(lines.some(l => l.includes('Blocked:') && l.includes('ANTHROPIC_API_KEY'))).toBe(true);
    });

    test('shows allowed vars', () => {
      const report = { blocked: ['OPENAI_API_KEY'], allowed: ['ANTHROPIC_API_KEY'] };
      const lines = formatEnvExclusionReport(report);

      expect(lines).toContain('Env filter:');
      expect(lines.some(l => l.includes('Passthrough:') && l.includes('ANTHROPIC_API_KEY'))).toBe(true);
      expect(lines.some(l => l.includes('Blocked:') && l.includes('OPENAI_API_KEY'))).toBe(true);
    });

    test('shows "no vars matched" when both arrays are empty', () => {
      const report = { blocked: [], allowed: [] };
      const lines = formatEnvExclusionReport(report);

      expect(lines.length).toBeGreaterThan(0);
      expect(lines.some(l => l.includes('no vars matched exclusion patterns'))).toBe(true);
      expect(lines.some(l => l.includes('*_API_KEY'))).toBe(true);
    });

    test('always returns non-empty array', () => {
      const emptyReport = { blocked: [], allowed: [] };
      const lines = formatEnvExclusionReport(emptyReport);
      expect(lines.length).toBeGreaterThan(0);
    });

    test('shows only blocked when no passthrough configured', () => {
      const report = { blocked: ['MY_SECRET'], allowed: [] };
      const lines = formatEnvExclusionReport(report);

      expect(lines.some(l => l.includes('Blocked:'))).toBe(true);
      expect(lines.some(l => l.includes('Passthrough:'))).toBe(false);
    });

    test('shows only passthrough when all blocked vars are allowed', () => {
      const report = { blocked: [], allowed: ['ANTHROPIC_API_KEY'] };
      const lines = formatEnvExclusionReport(report);

      expect(lines.some(l => l.includes('Passthrough:'))).toBe(true);
      expect(lines.some(l => l.includes('Blocked:'))).toBe(false);
    });
  });

  describe('BaseAgentPlugin.getExclusionReport', () => {
    test('returns report using agent passthrough config', async () => {
      const agent = new TestAgentPlugin();
      await agent.initialize({
        envPassthrough: ['TEST_API_KEY'],
      });

      const origApiKey = process.env.TEST_API_KEY;
      const origSecret = process.env.TEST_SECRET;
      process.env.TEST_API_KEY = 'val1';
      process.env.TEST_SECRET = 'val2';

      const report = agent.getExclusionReport();

      expect(report.allowed).toContain('TEST_API_KEY');
      expect(report.blocked).toContain('TEST_SECRET');

      if (origApiKey === undefined) {
        delete process.env.TEST_API_KEY;
      } else {
        process.env.TEST_API_KEY = origApiKey;
      }
      if (origSecret === undefined) {
        delete process.env.TEST_SECRET;
      } else {
        process.env.TEST_SECRET = origSecret;
      }

      await agent.dispose();
    });

    test('includes user envExclude in report', async () => {
      const agent = new TestAgentPlugin();
      await agent.initialize({
        envExclude: ['CUSTOM_BLOCK'],
      });

      const origCustom = process.env.CUSTOM_BLOCK;
      process.env.CUSTOM_BLOCK = 'blocked-val';

      const report = agent.getExclusionReport();

      expect(report.blocked).toContain('CUSTOM_BLOCK');

      if (origCustom === undefined) {
        delete process.env.CUSTOM_BLOCK;
      } else {
        process.env.CUSTOM_BLOCK = origCustom;
      }

      await agent.dispose();
    });
  });

  describe('DEFAULT_ENV_EXCLUDE_PATTERNS', () => {
    test('is exported and contains expected patterns', () => {
      expect(DEFAULT_ENV_EXCLUDE_PATTERNS).toContain('*_API_KEY');
      expect(DEFAULT_ENV_EXCLUDE_PATTERNS).toContain('*_SECRET_KEY');
      expect(DEFAULT_ENV_EXCLUDE_PATTERNS).toContain('*_SECRET');
      expect(DEFAULT_ENV_EXCLUDE_PATTERNS.length).toBeGreaterThanOrEqual(3);
    });
  });
});

/**
 * Test agent for verifying flag ordering. Overrides execute() to replicate the
 * exact flag-merge logic from BaseAgentPlugin.execute(), then spawns the process
 * via Bun.spawn to avoid mock pollution from tests that mock node:child_process.
 *
 * The flag-merge contract being tested:
 *   allArgs = [...defaultFlags, ...buildArgs(), ...(options.flags ?? [])]
 */
class FlagOrderTestPlugin extends BaseAgentPlugin {
  private modelFromBuildArgs?: string;
  private scriptPathForTest?: string;

  readonly meta: AgentPluginMeta = {
    id: 'flag-order-test',
    name: 'Flag Order Test',
    description: 'Test plugin for verifying flag ordering in execute()',
    version: '1.0.0',
    author: 'Test',
    defaultCommand: 'echo',
    supportsStreaming: true,
    supportsInterrupt: true,
    supportsFileContext: false,
    supportsSubagentTracing: false,
  };

  setScriptPath(path: string): void {
    this.scriptPathForTest = path;
  }

  setModel(model: string): void {
    this.modelFromBuildArgs = model;
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
    if (this.modelFromBuildArgs) {
      args.push('--model', this.modelFromBuildArgs);
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
    const executionId = 'flag-test-' + Date.now();
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

describe('BaseAgentPlugin flag ordering', () => {
  let agent: FlagOrderTestPlugin;
  let scriptPath: string;
  let tempDir: string;

  beforeEach(async () => {
    // Create a temp script that prints each positional argument on its own line.
    tempDir = await mkdtemp(join(tmpdir(), 'ralph-flag-test-'));
    scriptPath = join(tempDir, 'print-args.sh');
    await writeFile(scriptPath, '#!/bin/sh\nfor arg; do printf "%s\\n" "$arg"; done\n', { mode: 0o755 });

    agent = new FlagOrderTestPlugin();
    await agent.initialize({});
    agent.setScriptPath(scriptPath);
  });

  afterEach(async () => {
    await agent.dispose();
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  test('engine-injected flags come after buildArgs in the final argument list', async () => {
    agent.setModel('agent-model');

    let capturedStdout = '';
    const handle = agent.execute('test prompt', [], {
      flags: ['--model', 'engine-model'],
      timeout: 10000,
      onStdout: (text: string) => {
        capturedStdout += text;
      },
    });

    const result = await handle.promise;
    expect(result.status).toBe('completed');

    const args = parseArgs(capturedStdout);

    const agentModelIdx = args.indexOf('agent-model');
    const engineModelIdx = args.lastIndexOf('engine-model');

    expect(agentModelIdx).toBeGreaterThan(-1);
    expect(engineModelIdx).toBeGreaterThan(-1);
    // Engine-injected --model must come AFTER buildArgs --model
    expect(engineModelIdx).toBeGreaterThan(agentModelIdx);
  });

  test('defaultFlags come before buildArgs flags', async () => {
    agent = new FlagOrderTestPlugin();
    await agent.initialize({ defaultFlags: ['--default-flag'] });
    agent.setScriptPath(scriptPath);
    agent.setModel('agent-model');

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

    const defaultFlagIdx = args.indexOf('--default-flag');
    const modelIdx = args.indexOf('agent-model');

    expect(defaultFlagIdx).toBeGreaterThan(-1);
    expect(modelIdx).toBeGreaterThan(-1);
    expect(defaultFlagIdx).toBeLessThan(modelIdx);
  });

  test('full ordering is defaultFlags, buildArgs, engine flags', async () => {
    agent = new FlagOrderTestPlugin();
    await agent.initialize({ defaultFlags: ['--verbose'] });
    agent.setScriptPath(scriptPath);
    agent.setModel('agent-model');

    let capturedStdout = '';
    const handle = agent.execute('test prompt', [], {
      flags: ['--model', 'engine-model'],
      timeout: 10000,
      onStdout: (text: string) => {
        capturedStdout += text;
      },
    });

    const result = await handle.promise;
    expect(result.status).toBe('completed');

    const args = parseArgs(capturedStdout);

    const verboseIdx = args.indexOf('--verbose');
    const agentModelIdx = args.indexOf('agent-model');
    const engineModelIdx = args.lastIndexOf('engine-model');

    expect(verboseIdx).toBeGreaterThan(-1);
    expect(agentModelIdx).toBeGreaterThan(-1);
    expect(engineModelIdx).toBeGreaterThan(-1);

    // Order: defaultFlags < buildArgs < engine flags
    expect(verboseIdx).toBeLessThan(agentModelIdx);
    expect(agentModelIdx).toBeLessThan(engineModelIdx);
  });
});
