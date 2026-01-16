/**
 * ABOUTME: Wraps commands in sandbox isolation (bwrap on Linux, sandbox-exec on macOS).
 * Builds sandbox arguments based on config and agent requirements.
 */

import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { SandboxConfig } from './types.js';
import type { AgentSandboxRequirements } from '../plugins/agents/types.js';

export interface WrappedCommand {
  command: string;
  args: string[];
}

export interface SandboxWrapOptions {
  cwd?: string;
}

const LINUX_SYSTEM_DIRS = ['/usr', '/bin', '/lib', '/lib64', '/sbin', '/etc'];
const MACOS_SYSTEM_DIRS = [
  '/usr',
  '/bin',
  '/sbin',
  '/System',
  '/Library',
  '/Applications',
  '/private/var/db',
  '/private/etc',
];

export class SandboxWrapper {
  private readonly config: SandboxConfig;
  private readonly requirements: AgentSandboxRequirements;

  constructor(config: SandboxConfig, requirements: AgentSandboxRequirements) {
    this.config = config;
    this.requirements = requirements;
  }

  wrapCommand(
    command: string,
    args: string[],
    options: SandboxWrapOptions = {}
  ): WrappedCommand {
    if (this.config.enabled === false || this.config.mode === 'off') {
      return { command, args };
    }

    const mode = this.config.mode ?? 'auto';

    if (mode === 'bwrap') {
      return this.wrapWithBwrap(command, args, options);
    }

    if (mode === 'sandbox-exec') {
      return this.wrapWithSandboxExec(command, args, options);
    }

    // 'auto' mode - this shouldn't happen at runtime since detectSandboxMode
    // resolves 'auto' to a concrete mode, but handle it defensively
    return { command, args };
  }

  wrapWithBwrap(
    command: string,
    args: string[],
    options: SandboxWrapOptions = {}
  ): WrappedCommand {
    const cwd = options.cwd ?? process.cwd();
    const workDir = resolve(cwd);
    const bwrapArgs: string[] = ['--die-with-parent', '--dev', '/dev', '--proc', '/proc'];

    if (this.config.network === false) {
      bwrapArgs.push('--unshare-net');
    }

    for (const dir of LINUX_SYSTEM_DIRS) {
      if (existsSync(dir)) {
        bwrapArgs.push('--ro-bind', dir, dir);
      }
    }

    const readWritePaths = new Set<string>([
      workDir,
      ...this.normalizePaths(this.config.allowPaths ?? [], workDir),
    ]);
    const readOnlyPaths = new Set<string>([
      ...this.normalizePaths(this.config.readOnlyPaths ?? [], workDir),
      ...this.normalizePaths(this.getRequirementPaths(), workDir),
    ]);

    for (const path of readWritePaths) {
      readOnlyPaths.delete(path);
    }

    for (const path of readWritePaths) {
      bwrapArgs.push('--bind', path, path);
    }

    for (const path of readOnlyPaths) {
      bwrapArgs.push('--ro-bind', path, path);
    }

    bwrapArgs.push('--chdir', workDir, '--', command, ...args);

    return { command: 'bwrap', args: bwrapArgs };
  }

  wrapWithSandboxExec(
    command: string,
    args: string[],
    options: SandboxWrapOptions = {}
  ): WrappedCommand {
    const cwd = options.cwd ?? process.cwd();
    const workDir = resolve(cwd);
    const profile = this.generateSeatbeltProfile(workDir);

    // Use -p to pass profile inline, avoiding temp file management
    return {
      command: 'sandbox-exec',
      args: ['-p', profile, command, ...args],
    };
  }

  private generateSeatbeltProfile(workDir: string): string {
    const lines: string[] = [
      '(version 1)',
      '(deny default)',
      '',
      '; Allow process execution and signals',
      '(allow process-exec)',
      '(allow process-fork)',
      '(allow signal)',
      '',
      '; Allow basic system operations',
      '(allow sysctl-read)',
      '(allow mach-lookup)',
      '(allow ipc-posix-shm)',
      '',
    ];

    // Network access
    if (this.config.network !== false) {
      lines.push('; Allow network access');
      lines.push('(allow network*)');
      lines.push('');
    }

    // System directories (read-only)
    lines.push('; System directories (read-only)');
    for (const dir of MACOS_SYSTEM_DIRS) {
      if (existsSync(dir)) {
        lines.push(`(allow file-read* (subpath "${dir}"))`);
      }
    }
    lines.push('');

    // Dev and tmp directories
    lines.push('; Device and temporary directories');
    lines.push('(allow file-read* file-write* (subpath "/dev"))');
    lines.push('(allow file-read* file-write* (subpath "/private/tmp"))');
    lines.push('(allow file-read* file-write* (subpath "/tmp"))');
    lines.push('(allow file-read* file-write* (subpath "/var/folders"))');
    lines.push('');

    // Working directory (read-write)
    lines.push('; Working directory (read-write)');
    lines.push(`(allow file-read* file-write* (subpath "${workDir}"))`);

    // Additional allowed paths (read-write)
    const allowPaths = this.normalizePaths(this.config.allowPaths ?? [], workDir);
    for (const path of allowPaths) {
      if (path !== workDir) {
        lines.push(`(allow file-read* file-write* (subpath "${path}"))`);
      }
    }
    lines.push('');

    // Read-only paths (from config and agent requirements)
    lines.push('; Read-only paths (auth, runtime, config)');
    const readOnlyPaths = new Set<string>([
      ...this.normalizePaths(this.config.readOnlyPaths ?? [], workDir),
      ...this.normalizePaths(this.getRequirementPaths(), workDir),
    ]);
    for (const path of readOnlyPaths) {
      if (existsSync(path)) {
        lines.push(`(allow file-read* (subpath "${path}"))`);
      }
    }

    return lines.join('\n');
  }

  private getRequirementPaths(): string[] {
    return [
      ...this.requirements.authPaths,
      ...this.requirements.binaryPaths,
      ...this.requirements.runtimePaths,
    ];
  }

  private normalizePaths(paths: string[], cwd: string): string[] {
    const resolved = paths
      .filter((path) => path.trim().length > 0)
      .map((path) => (isAbsolute(path) ? path : resolve(cwd, path)));
    return Array.from(new Set(resolved));
  }
}
