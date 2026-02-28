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

/** Files/patterns to exclude when copying .beads/ directory */
const BEADS_EXCLUDE_PATTERNS = [
  /\.db$/,
  /\.db-shm$/,
  /\.db-wal$/,
  /\.lock$/,
  /\.tmp$/,
  /^last-touched$/,
];

/**
 * Check if a filename matches any of the beads exclusion patterns.
 */
function isBeadsExcluded(filename: string): boolean {
  return BEADS_EXCLUDE_PATTERNS.some((pattern) => pattern.test(filename));
}

/**
 * Copy the .beads/ directory from source to target, excluding git-ignored files
 * (database files, lock files, temporary files).
 */
function copyBeadsDir(cwd: string, worktreePath: string): void {
  const sourceDir = path.join(cwd, '.beads');
  const targetDir = path.join(worktreePath, '.beads');

  if (!fs.existsSync(sourceDir)) {
    return;
  }

  fs.mkdirSync(targetDir, { recursive: true });

  const entries = fs.readdirSync(sourceDir);
  for (const entry of entries) {
    if (isBeadsExcluded(entry)) {
      continue;
    }

    const sourcePath = path.join(sourceDir, entry);
    const targetPath = path.join(targetDir, entry);
    const stat = fs.statSync(sourcePath);

    if (stat.isFile()) {
      fs.copyFileSync(sourcePath, targetPath);
    } else if (stat.isDirectory()) {
      // Recursively copy subdirectories (unlikely for .beads/ but handle gracefully)
      fs.cpSync(sourcePath, targetPath, { recursive: true });
    }
  }
}

/**
 * Run `br sync --flush-only` or `bd sync --flush-only` in the main repo to
 * ensure the JSONL export is up to date with the SQLite database.
 * Returns true on success, false on failure (caller should log warning).
 */
function syncBeadsTracker(cwd: string, command: string): boolean {
  try {
    execFileSync(command, ['sync', '--flush-only'], {
      cwd,
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy tracker data files from the main repo into the worktree.
 *
 * Handles three tracker types:
 * - beads-rust: runs `br sync --flush-only`, then copies .beads/ (excluding db/lock/tmp files)
 * - beads / beads-bv: runs `bd sync --flush-only`, then copies .beads/ (excluding db/lock/tmp files)
 * - json: copies the prd.json file (or configured PRD path) if it exists
 *
 * @param cwd - The main project working directory
 * @param worktreePath - The worktree path to copy into
 * @param trackerPlugin - The tracker plugin ID (e.g., 'beads-rust', 'beads', 'json')
 * @param prdPath - Optional PRD file path for json tracker
 */
export function copyTrackerData(
  cwd: string,
  worktreePath: string,
  trackerPlugin: string,
  prdPath?: string,
): void {
  if (trackerPlugin === 'beads-rust') {
    // Sync DB to JSONL before copying
    if (!syncBeadsTracker(cwd, 'br')) {
      console.warn('Warning: br sync --flush-only failed; worktree will use existing .beads/ from HEAD');
    }
    copyBeadsDir(cwd, worktreePath);
  } else if (trackerPlugin === 'beads' || trackerPlugin === 'beads-bv') {
    // Sync DB to JSONL before copying
    if (!syncBeadsTracker(cwd, 'bd')) {
      console.warn('Warning: bd sync --flush-only failed; worktree will use existing .beads/ from HEAD');
    }
    copyBeadsDir(cwd, worktreePath);
  } else if (trackerPlugin === 'json') {
    // Copy the PRD JSON file
    const prdFile = prdPath || 'prd.json';
    const sourcePrd = path.resolve(cwd, prdFile);
    if (fs.existsSync(sourcePrd)) {
      const targetPrd = path.join(worktreePath, path.relative(cwd, sourcePrd));
      const targetPrdDir = path.dirname(targetPrd);
      fs.mkdirSync(targetPrdDir, { recursive: true });
      fs.copyFileSync(sourcePrd, targetPrd);
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

/** Result of merging a session worktree back to the original branch */
export interface MergeResult {
  /** Whether the merge was successful */
  success: boolean;
  /** Human-readable message describing what happened */
  message: string;
}

/**
 * Merge the session worktree branch back into the original branch.
 *
 * On success: switches to the original branch, merges (ff or commit),
 * removes the worktree directory, and deletes the session branch.
 *
 * On failure (conflicts): preserves the worktree and branch so the user
 * can resolve manually.
 *
 * @param cwd - The main project working directory (NOT the worktree)
 * @param worktreePath - Absolute path to the session worktree
 * @param branchName - The session branch name (e.g., "ralph-session/my-feature")
 * @returns MergeResult indicating success/failure with a message
 */
export async function mergeSessionWorktree(
  cwd: string,
  worktreePath: string,
  branchName: string,
): Promise<MergeResult> {
  // Determine the original branch to switch back to
  let originalBranch: string;
  try {
    // HEAD of the main repo should still be on the original branch
    originalBranch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  } catch {
    return {
      success: false,
      message: `Failed to determine original branch. Worktree preserved at: ${worktreePath} (branch: ${branchName})`,
    };
  }

  // If the original branch IS the session branch (shouldn't happen, but guard), bail
  if (originalBranch === branchName) {
    return {
      success: false,
      message: `Original branch is the session branch (${branchName}). Worktree preserved at: ${worktreePath}`,
    };
  }

  // Try fast-forward merge first
  try {
    git(cwd, ['merge', '--ff-only', branchName]);
    console.log(`Merged ${branchName} into ${originalBranch} (fast-forward)`);
  } catch {
    // Fast-forward not possible, try regular merge
    try {
      git(cwd, ['merge', '--no-edit', branchName]);
      console.log(`Merged ${branchName} into ${originalBranch} (merge commit)`);
    } catch {
      // Merge failed — abort and preserve worktree
      try {
        git(cwd, ['merge', '--abort']);
      } catch {
        // merge --abort may fail if no merge in progress
      }

      return {
        success: false,
        message: [
          'Auto-merge failed due to conflicts.',
          `  Worktree: ${worktreePath}`,
          `  Branch:   ${branchName}`,
          'Resolve manually with:',
          `  cd ${cwd}`,
          `  git merge ${branchName}`,
        ].join('\n'),
      };
    }
  }

  // Merge succeeded — clean up worktree and branch
  await removeSessionWorktree(cwd, worktreePath, branchName);

  return {
    success: true,
    message: `Successfully merged ${branchName} into ${originalBranch}`,
  };
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
