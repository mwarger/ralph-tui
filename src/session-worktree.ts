/**
 * ABOUTME: Session-level git worktree creation for isolated execution.
 * When --worktree is active, creates a single git worktree before the
 * execution engine starts so all task execution happens in an isolated
 * copy of the repo.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Result of session worktree creation */
export interface SessionWorktreeResult {
  /** Absolute path to the created worktree */
  worktreePath: string;
  /** Branch name used for the worktree */
  branchName: string;
}

/** Default minimum free disk space (500 MB) before creating a worktree */
const DEFAULT_MIN_FREE_DISK_SPACE = 500 * 1024 * 1024;

/**
 * Derive the session worktree name from available context.
 *
 * Priority:
 * 1. Explicit custom name (user passed --worktree <name>)
 * 2. Epic ID (e.g. "my-epic-123")
 * 3. PRD filename without extension (e.g. "auth-feature")
 * 4. Session short ID (first 8 chars of UUID)
 */
export function deriveSessionName(options: {
  customName?: string;
  epicId?: string;
  prdPath?: string;
  sessionId: string;
}): string {
  if (options.customName) {
    return sanitizeBranchSegment(options.customName);
  }
  if (options.epicId) {
    return sanitizeBranchSegment(options.epicId);
  }
  if (options.prdPath) {
    const basename = path.basename(options.prdPath, path.extname(options.prdPath));
    return sanitizeBranchSegment(basename);
  }
  // Fallback: first 8 chars of session UUID
  return options.sessionId.slice(0, 8);
}

/**
 * Sanitize a string into a valid git branch name segment.
 * Removes/replaces invalid characters.
 */
function sanitizeBranchSegment(input: string): string {
  let sanitized = input;

  // Replace spaces and invalid characters with dashes
  sanitized = sanitized.replace(/[\s~^:?*\[\\@{]/g, '-');

  // Remove control characters
  sanitized = sanitized.replace(/\p{Cc}/gu, '');

  // Collapse multiple slashes and dashes
  sanitized = sanitized.replace(/\/+/g, '/').replace(/-+/g, '-');

  // Remove consecutive dots
  sanitized = sanitized.replace(/\.{2,}/g, '.');

  // Strip leading/trailing slashes, dots, and dashes
  sanitized = sanitized.replace(/^[./-]+|[./-]+$/g, '');

  // Don't end with .lock
  if (sanitized.endsWith('.lock')) {
    sanitized = sanitized.slice(0, -5);
  }

  // If sanitization resulted in empty string, use a hash fallback
  if (!sanitized) {
    sanitized = Buffer.from(input).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'session';
  }

  return sanitized;
}

/**
 * Compute the worktree base directory as a sibling of the project.
 *
 * Worktrees must live outside the project directory to prevent
 * Claude CLI's project detection from walking up and finding the parent's
 * .git directory.
 *
 * Uses: {parent}/.ralph-worktrees/{basename}/
 */
function getWorktreeBaseDir(cwd: string): string {
  const parentDir = path.dirname(cwd);
  const projectName = path.basename(cwd);
  return path.join(parentDir, '.ralph-worktrees', projectName);
}

/**
 * Copy ralph-tui configuration into a worktree.
 */
function copyConfig(cwd: string, worktreePath: string): void {
  const configDir = path.join(cwd, '.ralph-tui');
  const targetDir = path.join(worktreePath, '.ralph-tui');

  // Copy config.toml if it exists
  const configFile = path.join(configDir, 'config.toml');
  if (fs.existsSync(configFile)) {
    fs.mkdirSync(targetDir, { recursive: true });
    fs.copyFileSync(configFile, path.join(targetDir, 'config.toml'));
  }

  // Also copy config.yaml / config.yml if they exist
  for (const ext of ['yaml', 'yml']) {
    const yamlConfig = path.join(configDir, `config.${ext}`);
    if (fs.existsSync(yamlConfig)) {
      fs.mkdirSync(targetDir, { recursive: true });
      fs.copyFileSync(yamlConfig, path.join(targetDir, `config.${ext}`));
    }
  }
}

/**
 * Check if there is enough disk space to create a worktree.
 * Uses fs.statfs first, falls back to `df` for APFS and similar.
 */
async function checkDiskSpace(cwd: string): Promise<void> {
  const minimumRequired = DEFAULT_MIN_FREE_DISK_SPACE;

  try {
    let available: number | null = null;

    // Try statfs first
    try {
      const stats = await fs.promises.statfs(cwd);
      const value = Number(stats.bavail) * Number(stats.bsize);
      if (Number.isFinite(value) && value > 0) {
        available = value;
      }
    } catch {
      // Fall through to df
    }

    // Fall back to df
    if (available === null) {
      try {
        const output = execFileSync('df', ['-k', cwd], { encoding: 'utf-8' });
        const lines = output.trim().split('\n').filter((l) => l.trim().length > 0);
        if (lines.length >= 2) {
          const header = lines[0]?.toLowerCase() ?? '';
          const cols = header.trim().split(/\s+/).map((v) => v.replace('%', '').trim());
          const availIdx = cols.findIndex((c) => c === 'avail' || c === 'available');
          if (availIdx >= 0) {
            const dataLine = lines.at(-1) ?? '';
            const values = dataLine.trim().split(/\s+/);
            const kb = Number.parseInt(values[availIdx] ?? '', 10);
            if (Number.isFinite(kb) && kb >= 0) {
              available = kb * 1024;
            }
          }
        }
      } catch {
        // Best effort
      }
    }

    if (available === null) {
      return; // Can't determine disk space, proceed optimistically
    }

    if (available < minimumRequired) {
      const availMB = Math.round(available / (1024 * 1024));
      const reqMB = Math.round(minimumRequired / (1024 * 1024));
      throw new Error(
        `Insufficient disk space for worktree: ${availMB}MB available, ${reqMB}MB required`
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('Insufficient disk space')) {
      throw err;
    }
    // Other errors: best-effort, don't block
  }
}

/**
 * Execute a git command in the given directory.
 */
function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf-8',
    timeout: 30000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/**
 * Create a session worktree for isolated execution.
 *
 * Creates a git worktree with branch `ralph-session/{name}` as a sibling
 * directory, copies config, and returns the worktree path for use as the
 * execution engine's cwd.
 *
 * @param cwd - The project's working directory
 * @param sessionName - Derived session name (from deriveSessionName)
 * @returns The worktree path and branch name
 * @throws If worktree creation fails or disk space is insufficient
 */
export async function createSessionWorktree(
  cwd: string,
  sessionName: string,
): Promise<SessionWorktreeResult> {
  // Check disk space before creating
  await checkDiskSpace(cwd);

  const branchName = `ralph-session/${sessionName}`;
  const baseDir = getWorktreeBaseDir(cwd);
  const worktreePath = path.join(baseDir, sessionName);

  // Ensure parent directory exists
  fs.mkdirSync(baseDir, { recursive: true });

  // Clean up stale worktree at this path if it exists
  if (fs.existsSync(worktreePath)) {
    try {
      git(cwd, ['worktree', 'remove', '--force', worktreePath]);
    } catch {
      fs.rmSync(worktreePath, { recursive: true, force: true });
      git(cwd, ['worktree', 'prune']);
    }
  }

  // Clean up stale branch if it exists
  try {
    git(cwd, ['branch', '-D', branchName]);
  } catch {
    // Branch may not exist
  }

  // Create the worktree with a new branch from HEAD
  git(cwd, ['worktree', 'add', '-b', branchName, worktreePath, 'HEAD']);

  // Copy ralph-tui config into the worktree
  copyConfig(cwd, worktreePath);

  return { worktreePath, branchName };
}

/**
 * Remove a session worktree and its branch.
 * Best-effort cleanup — does not throw on failure.
 */
export async function removeSessionWorktree(
  cwd: string,
  worktreePath: string,
  branchName: string,
): Promise<void> {
  // Force remove the worktree
  try {
    git(cwd, ['worktree', 'remove', '--force', worktreePath]);
  } catch {
    if (fs.existsSync(worktreePath)) {
      fs.rmSync(worktreePath, { recursive: true, force: true });
    }
    try {
      git(cwd, ['worktree', 'prune']);
    } catch {
      // Best effort
    }
  }

  // Delete the branch
  try {
    git(cwd, ['branch', '-D', branchName]);
  } catch {
    // Branch may already be deleted
  }

  // Remove worktree directories if empty
  try {
    const baseDir = getWorktreeBaseDir(cwd);
    const entries = fs.readdirSync(baseDir);
    if (entries.length === 0) {
      fs.rmdirSync(baseDir);
      const parentDir = path.dirname(baseDir);
      const parentEntries = fs.readdirSync(parentDir);
      if (parentEntries.length === 0) {
        fs.rmdirSync(parentDir);
      }
    }
  } catch {
    // Directory may not exist or not be empty
  }
}
